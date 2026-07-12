// ---------------------------------------------------------------------------
// hooks/useGroupCall.ts — Mesh WebRTC peer connections for group calls
// ---------------------------------------------------------------------------

import { useEffect, useRef, useState, useCallback } from 'react';
import socket from '../socket';
import { createPeerConnection, closePeerConnection, addIceCandidate } from '../webrtc';
import { getIceServers, joinGroupCall, leaveGroupCall } from '../api';
import { emitFallbackDiagnostic } from '../utils/fallbackDiagnostics';
import type { FallbackDiagnostic } from '../utils/fallbackDiagnostics';
import type { GroupCallSignal, SocketEnvelope } from '../generated/apiContract';

export interface Participant {
  userId: string;
  displayName: string;
}

export interface PeerEntry {
  pc: RTCPeerConnection;
  stream: MediaStream | null;
}

export type CallStatus = 'idle' | 'joining' | 'connected' | 'error';

function socketEnvelope() {
  return { correlationId: crypto.randomUUID(), occurredAt: new Date().toISOString() };
}

interface GroupRoomEvent extends SocketEnvelope { roomId: string }
interface ExistingParticipantsEvent extends GroupRoomEvent { participants: Participant[] }
interface ParticipantJoinedEvent extends GroupRoomEvent { userId: string; displayName: string }
interface ParticipantLeftEvent extends GroupRoomEvent { userId: string }
interface GroupOfferEvent extends GroupCallSignal { offer: RTCSessionDescriptionInit }
interface GroupAnswerEvent extends GroupCallSignal { answer: RTCSessionDescriptionInit }
interface GroupIceEvent extends GroupCallSignal { candidate: RTCIceCandidateInit }

function hasValidSocketEnvelope(value: unknown): value is GroupRoomEvent {
  if (!value || typeof value !== 'object') return false;
  const candidate = value as Partial<GroupRoomEvent>;
  return typeof candidate.roomId === 'string' && candidate.roomId.length > 0
    && typeof candidate.correlationId === 'string' && candidate.correlationId.length > 0
    && typeof candidate.occurredAt === 'string' && Number.isFinite(Date.parse(candidate.occurredAt));
}

/**
 * Manages a mesh of RTCPeerConnections — one per remote participant.
 * The newer joiner always creates the offer to existing participants (avoids glare).
 *
 * `postId` may be null (no active room). When it changes to a different room,
 * the previous room is left automatically before the new one can be joined.
 */
export function useGroupCall(postId: string | null) {
  const peersRef = useRef<Map<string, PeerEntry>>(new Map());
  const localStreamRef = useRef<MediaStream | null>(null);
  const iceServersRef = useRef<RTCIceServer[]>([]);
  const [remoteStreams, setRemoteStreams] = useState<Map<string, MediaStream>>(new Map());
  const [participants, setParticipants] = useState<Participant[]>([]);
  const [callStatus, setCallStatus] = useState<CallStatus>('idle');
  const [streamReady, setStreamReady] = useState(false);
  const joinedRef = useRef(false);
  const joiningRef = useRef(false);
  const joinAttemptRef = useRef(0);
  /** The room actually joined (used by leave, which must survive postId changes). */
  const joinedPostIdRef = useRef<string | null>(null);

  const reportDiagnostic = useCallback((title: string, message: string, error?: unknown) => {
    emitFallbackDiagnostic({
        code: 'group_call_degraded',
        severity: 'error',
        title,
        message,
        detail: error instanceof Error ? error.message : String(error || ''),
      }, { source: 'web.group-call', operation: 'realtime-signaling' });
  }, []);

  // Helpers to update remote streams state
  const updateRemoteStream = useCallback((userId: string, stream: MediaStream) => {
    setRemoteStreams((prev) => new Map(prev).set(userId, stream));
  }, []);

  const removeRemoteStream = useCallback((userId: string) => {
    setRemoteStreams((prev) => {
      const next = new Map(prev);
      next.delete(userId);
      return next;
    });
  }, []);

  // Create a peer connection for a remote participant
  const createPeer = useCallback((remoteUserId: string): PeerEntry => {
    const entry: PeerEntry = { pc: null as unknown as RTCPeerConnection, stream: null };

    const pc = createPeerConnection(
      // onTrack
      (event) => {
        const [remoteStream] = event.streams;
        if (remoteStream) {
          entry.stream = remoteStream;
          updateRemoteStream(remoteUserId, remoteStream);
        }
      },
      // onIceCandidate
      (candidate) => {
        if (candidate) {
          socket.emit('group:ice', { roomId: postId, targetUserId: remoteUserId, candidate, ...socketEnvelope() });
        }
      },
      // onIceFailure
      () => {
        reportDiagnostic(
          'Group call network path failed',
          `The direct media path to participant ${remoteUserId} failed. Polycast will keep the room open so you can leave and rejoin.`,
        );
      },
      iceServersRef.current,
    );

    entry.pc = pc;
    return entry;
  }, [postId, reportDiagnostic, updateRemoteStream]);

  // Send an offer to a remote participant
  const sendOffer = useCallback(async (remoteUserId: string, entry: PeerEntry) => {
    const localStream = localStreamRef.current;
    if (!localStream) return;

    localStream.getTracks().forEach((track) => {
      entry.pc.addTrack(track, localStream);
    });

    const offer = await entry.pc.createOffer();
    await entry.pc.setLocalDescription(offer);
    socket.emit('group:offer', { roomId: postId, targetUserId: remoteUserId, offer, ...socketEnvelope() });
  }, [postId]);

  // Handle incoming offer and send answer
  const handleOffer = useCallback(async (fromUserId: string, offer: RTCSessionDescriptionInit) => {
    let entry = peersRef.current.get(fromUserId);
    if (!entry) {
      entry = createPeer(fromUserId);
      peersRef.current.set(fromUserId, entry);
    }

    const localStream = localStreamRef.current;
    if (!localStream) return;

    localStream.getTracks().forEach((track) => {
      entry!.pc.addTrack(track, localStream);
    });

    await entry.pc.setRemoteDescription(new RTCSessionDescription(offer));
    const answer = await entry.pc.createAnswer();
    await entry.pc.setLocalDescription(answer);
    socket.emit('group:answer', { roomId: postId, targetUserId: fromUserId, answer, ...socketEnvelope() });
  }, [postId, createPeer]);

  // Handle incoming answer
  const handleAnswer = useCallback(async (fromUserId: string, answer: RTCSessionDescriptionInit) => {
    const entry = peersRef.current.get(fromUserId);
    if (!entry) return;
    await entry.pc.setRemoteDescription(new RTCSessionDescription(answer));
  }, []);

  // Handle incoming ICE candidate
  const handleIce = useCallback(async (fromUserId: string, candidate: RTCIceCandidateInit) => {
    const entry = peersRef.current.get(fromUserId);
    if (!entry) return;
    await addIceCandidate(entry.pc, candidate);
  }, []);

  // Join the call
  const join = useCallback(async () => {
    if (!postId || joinedRef.current || joiningRef.current) return;
    const roomId = postId;
    const attempt = ++joinAttemptRef.current;
    joiningRef.current = true;
    setCallStatus('joining');

    try {
      // 1. Acquire local media
      const stream = await navigator.mediaDevices.getUserMedia({
        video: { width: 640, height: 360 },
        audio: true,
      });
      if (attempt !== joinAttemptRef.current) {
        stream.getTracks().forEach((track) => track.stop());
        return;
      }
      localStreamRef.current = stream;
      setStreamReady(true);

      // 2. Fetch ICE servers
      try {
        const { iceServers } = await getIceServers();
        if (attempt !== joinAttemptRef.current) {
          stream.getTracks().forEach((track) => track.stop());
          localStreamRef.current = null;
          setStreamReady(false);
          return;
        }
        iceServersRef.current = iceServers;
      } catch (err) {
        stream.getTracks().forEach((track) => track.stop());
        localStreamRef.current = null;
        setStreamReady(false);
        throw err;
      }

      // 3. REST join (registers in DB, returns current participants)
      await joinGroupCall(roomId);
      if (attempt !== joinAttemptRef.current) {
        stream.getTracks().forEach((track) => track.stop());
        void leaveGroupCall(roomId).catch((error) => reportDiagnostic(
          'Cancelled group call cleanup failed',
          `Polycast joined room ${roomId} after it was cancelled, and the server cleanup request failed. The server disconnect cleanup will still run when the socket closes.`,
          error,
        ));
        return;
      }

      // 4. Socket join (joins room, gets existing participants)
      socket.emit('group:join', { roomId, ...socketEnvelope() });
      joinedRef.current = true;
      joinedPostIdRef.current = roomId;
      setCallStatus('connected');
    } catch (err) {
      reportDiagnostic(
        'Group call join failed',
        `Polycast could not finish joining room ${roomId}. Camera and microphone access have been released; retrying the room is safe.`,
        err,
      );
      // Don't leak the camera/mic if we grabbed them but never joined.
      if (!joinedRef.current) {
        localStreamRef.current?.getTracks().forEach((track) => track.stop());
        localStreamRef.current = null;
        setStreamReady(false);
      }
      setCallStatus('error');
    } finally {
      if (attempt === joinAttemptRef.current) joiningRef.current = false;
    }
  }, [postId, reportDiagnostic]);

  // Leave the call. Stable (no deps) so the room-change cleanup below can use
  // it without re-running on unrelated renders; the joined room lives in a ref.
  const leave = useCallback(() => {
    // Invalidate an in-flight join even if it has not reached the socket yet.
    joinAttemptRef.current += 1;
    joiningRef.current = false;
    const wasJoined = joinedRef.current;
    joinedRef.current = false;
    const roomId = joinedPostIdRef.current;
    joinedPostIdRef.current = null;

    if (wasJoined && roomId) {
      socket.emit('group:leave', { roomId, ...socketEnvelope() });
      leaveGroupCall(roomId).catch((error) => reportDiagnostic(
        'Group call leave confirmation failed',
        `Polycast closed local media for room ${roomId}, but the server confirmation failed. Socket disconnect cleanup remains active.`,
        error,
      ));
    }

    // Close all peer connections
    for (const [, entry] of peersRef.current) {
      closePeerConnection(entry.pc);
    }
    peersRef.current.clear();
    setRemoteStreams(new Map());
    setParticipants([]);

    // Stop local tracks
    localStreamRef.current?.getTracks().forEach((t) => t.stop());
    localStreamRef.current = null;
    setStreamReady(false);
    setCallStatus('idle');
  }, [reportDiagnostic]);

  // Socket event listeners
  useEffect(() => {
    const validateEvent = <T extends GroupRoomEvent>(payload: unknown, eventName: string): T | null => {
      if (hasValidSocketEnvelope(payload)) return payload as T;
      reportDiagnostic(
        'Group call event rejected',
        `${eventName} did not match the generated realtime contract and was ignored.`,
        `requiredFields=roomId,correlationId,occurredAt`,
      );
      return null;
    };
    const isCurrentRoom = (roomId: string, eventName: string) => {
      if (roomId === joinedPostIdRef.current) return true;
      reportDiagnostic(
        'Stale group call event ignored',
        `${eventName} targeted room ${roomId || '(missing)'}, while the active room is ${joinedPostIdRef.current || '(none)'}. The event was rejected to prevent cross-room state changes.`,
      );
      return false;
    };

    const onExistingParticipants = (payload: unknown) => {
      const data = validateEvent<ExistingParticipantsEvent>(payload, 'group:existing-participants');
      if (!data || !Array.isArray(data.participants)) return;
      const { roomId, participants: existing } = data;
      if (!isCurrentRoom(roomId, 'group:existing-participants')) return;
      setParticipants(existing);

      // New joiner creates offers to all existing participants
      void (async () => {
        for (const p of existing) {
          const entry = createPeer(p.userId);
          peersRef.current.set(p.userId, entry);
          await sendOffer(p.userId, entry);
        }
      })().catch((error) => reportDiagnostic(
        'Group call participant setup failed',
        'Polycast could not connect to one or more participants. Leave and rejoin the room.',
        error,
      ));
    };

    const onParticipantJoined = (payload: unknown) => {
      const data = validateEvent<ParticipantJoinedEvent>(payload, 'group:participant-joined');
      if (!data || typeof data.userId !== 'string' || typeof data.displayName !== 'string') return;
      const { roomId, userId, displayName } = data;
      if (!isCurrentRoom(roomId, 'group:participant-joined')) return;
      setParticipants((prev) => {
        if (prev.some((p) => p.userId === userId)) return prev;
        return [...prev, { userId, displayName }];
      });
      // Wait for their offer — the new joiner sends offers, not us
    };

    const onParticipantLeft = (payload: unknown) => {
      const data = validateEvent<ParticipantLeftEvent>(payload, 'group:participant-left');
      if (!data || typeof data.userId !== 'string') return;
      const { roomId, userId } = data;
      if (!isCurrentRoom(roomId, 'group:participant-left')) return;
      setParticipants((prev) => prev.filter((p) => p.userId !== userId));
      const entry = peersRef.current.get(userId);
      if (entry) {
        closePeerConnection(entry.pc);
        peersRef.current.delete(userId);
      }
      removeRemoteStream(userId);
    };

    const onOffer = (payload: unknown) => {
      const data = validateEvent<GroupOfferEvent>(payload, 'group:offer');
      if (!data || typeof data.fromUserId !== 'string' || !data.offer) return;
      const { roomId, fromUserId, offer } = data;
      if (!isCurrentRoom(roomId, 'group:offer')) return;
      void handleOffer(fromUserId, offer).catch((error) => reportDiagnostic(
        'Group call offer failed',
        'Polycast could not accept a participant connection.',
        error,
      ));
    };

    const onAnswer = (payload: unknown) => {
      const data = validateEvent<GroupAnswerEvent>(payload, 'group:answer');
      if (!data || typeof data.fromUserId !== 'string' || !data.answer) return;
      const { roomId, fromUserId, answer } = data;
      if (!isCurrentRoom(roomId, 'group:answer')) return;
      void handleAnswer(fromUserId, answer).catch((error) => reportDiagnostic(
        'Group call answer failed',
        'Polycast could not finish a participant connection.',
        error,
      ));
    };

    const onIce = (payload: unknown) => {
      const data = validateEvent<GroupIceEvent>(payload, 'group:ice');
      if (!data || typeof data.fromUserId !== 'string' || !data.candidate) return;
      const { roomId, fromUserId, candidate } = data;
      if (!isCurrentRoom(roomId, 'group:ice')) return;
      void handleIce(fromUserId, candidate).catch((error) => reportDiagnostic(
        'Group call network candidate failed',
        'A participant network path could not be added.',
        error,
      ));
    };

    const onServerDiagnostic = (diagnostic: FallbackDiagnostic) => {
      emitFallbackDiagnostic(diagnostic, {
        source: 'server.group-call',
        operation: diagnostic.operation || 'realtime-signaling',
      });
    };

    socket.on('group:existing-participants', onExistingParticipants);
    socket.on('group:participant-joined', onParticipantJoined);
    socket.on('group:participant-left', onParticipantLeft);
    socket.on('group:offer', onOffer);
    socket.on('group:answer', onAnswer);
    socket.on('group:ice', onIce);
    socket.on('group:diagnostic', onServerDiagnostic);

    return () => {
      socket.off('group:existing-participants', onExistingParticipants);
      socket.off('group:participant-joined', onParticipantJoined);
      socket.off('group:participant-left', onParticipantLeft);
      socket.off('group:offer', onOffer);
      socket.off('group:answer', onAnswer);
      socket.off('group:ice', onIce);
      socket.off('group:diagnostic', onServerDiagnostic);
    };
  }, [createPeer, sendOffer, handleOffer, handleAnswer, handleIce, removeRemoteStream, reportDiagnostic]);

  // Socket.IO does not retain room membership across a transport reconnect.
  // Rejoin the signaling room without repeating media acquisition or the REST
  // participant mutation; the server room handler returns the fresh peer set.
  useEffect(() => {
    const onConnect = () => {
      const roomId = joinedPostIdRef.current;
      if (!joinedRef.current || !roomId) return;
      socket.emit('group:join', { roomId, ...socketEnvelope() });
      emitFallbackDiagnostic({
        code: 'group_call_socket_rejoined',
        severity: 'warning',
        title: 'Group call signaling restored',
        message: `The realtime connection was interrupted and Polycast rejoined room ${roomId}. Existing media peers will be renegotiated.`,
        detail: `roomId=${roomId}`,
      }, { source: 'web.group-call', operation: 'socket-reconnect' });
    };
    socket.on('connect', onConnect);
    return () => {
      socket.off('connect', onConnect);
    };
  }, []);

  // Leave the current room when the target room changes (or on unmount).
  // The consumer (GroupCallProvider) joins the new room afterwards.
  useEffect(() => {
    return () => {
      leave();
    };
  }, [postId, leave]);

  return {
    localStreamRef,
    remoteStreams,
    participants,
    callStatus,
    streamReady,
    join,
    leave,
    peersRef,
  };
}
