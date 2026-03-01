// ---------------------------------------------------------------------------
// hooks/useGroupCall.ts — Mesh WebRTC peer connections for group calls
// ---------------------------------------------------------------------------

import { useEffect, useRef, useState, useCallback } from 'react';
import socket from '../socket';
import { createPeerConnection, closePeerConnection, addIceCandidate } from '../webrtc';
import { getIceServers, joinGroupCall, leaveGroupCall } from '../api';

export interface Participant {
  userId: string;
  displayName: string;
}

interface PeerEntry {
  pc: RTCPeerConnection;
  stream: MediaStream | null;
}

export type CallStatus = 'idle' | 'joining' | 'connected' | 'error';

/**
 * Manages a mesh of RTCPeerConnections — one per remote participant.
 * The newer joiner always creates the offer to existing participants (avoids glare).
 */
export function useGroupCall(postId: string) {
  const peersRef = useRef<Map<string, PeerEntry>>(new Map());
  const localStreamRef = useRef<MediaStream | null>(null);
  const iceServersRef = useRef<RTCIceServer[]>([]);
  const [remoteStreams, setRemoteStreams] = useState<Map<string, MediaStream>>(new Map());
  const [participants, setParticipants] = useState<Participant[]>([]);
  const [callStatus, setCallStatus] = useState<CallStatus>('idle');
  const [streamReady, setStreamReady] = useState(false);
  const joinedRef = useRef(false);

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
          socket.emit('group:ice', { roomId: postId, targetUserId: remoteUserId, candidate });
        }
      },
      // onIceFailure
      () => {
        console.warn(`[group-call] ICE failed for peer ${remoteUserId}`);
      },
      iceServersRef.current,
    );

    entry.pc = pc;
    return entry;
  }, [postId, updateRemoteStream]);

  // Send an offer to a remote participant
  const sendOffer = useCallback(async (remoteUserId: string, entry: PeerEntry) => {
    const localStream = localStreamRef.current;
    if (!localStream) return;

    localStream.getTracks().forEach((track) => {
      entry.pc.addTrack(track, localStream);
    });

    const offer = await entry.pc.createOffer();
    await entry.pc.setLocalDescription(offer);
    socket.emit('group:offer', { roomId: postId, targetUserId: remoteUserId, offer });
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
    socket.emit('group:answer', { roomId: postId, targetUserId: fromUserId, answer });
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
    if (joinedRef.current) return;
    setCallStatus('joining');

    try {
      // 1. Acquire local media
      const stream = await navigator.mediaDevices.getUserMedia({
        video: { width: 640, height: 360 },
        audio: true,
      });
      localStreamRef.current = stream;
      setStreamReady(true);

      // 2. Fetch ICE servers
      try {
        const { iceServers } = await getIceServers();
        iceServersRef.current = iceServers;
      } catch (err) {
        console.warn('[group-call] Could not fetch ICE servers, using defaults:', err);
      }

      // 3. REST join (registers in DB, returns current participants)
      await joinGroupCall(postId);

      // 4. Socket join (joins room, gets existing participants)
      socket.emit('group:join', { roomId: postId });
      joinedRef.current = true;
      setCallStatus('connected');
    } catch (err) {
      console.error('[group-call] Join failed:', err);
      setCallStatus('error');
    }
  }, [postId]);

  // Leave the call
  const leave = useCallback(() => {
    if (!joinedRef.current) return;
    joinedRef.current = false;

    socket.emit('group:leave', { roomId: postId });
    leaveGroupCall(postId).catch((err) => console.error('[group-call] REST leave error:', err));

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
  }, [postId]);

  // Socket event listeners
  useEffect(() => {
    const onExistingParticipants = async ({ participants: existing }: { roomId: string; participants: Participant[] }) => {
      setParticipants(existing);

      // New joiner creates offers to all existing participants
      for (const p of existing) {
        const entry = createPeer(p.userId);
        peersRef.current.set(p.userId, entry);
        await sendOffer(p.userId, entry);
      }
    };

    const onParticipantJoined = ({ userId, displayName }: { roomId: string; userId: string; displayName: string }) => {
      setParticipants((prev) => {
        if (prev.some((p) => p.userId === userId)) return prev;
        return [...prev, { userId, displayName }];
      });
      // Wait for their offer — the new joiner sends offers, not us
    };

    const onParticipantLeft = ({ userId }: { roomId: string; userId: string }) => {
      setParticipants((prev) => prev.filter((p) => p.userId !== userId));
      const entry = peersRef.current.get(userId);
      if (entry) {
        closePeerConnection(entry.pc);
        peersRef.current.delete(userId);
      }
      removeRemoteStream(userId);
    };

    const onOffer = ({ fromUserId, offer }: { roomId: string; fromUserId: string; offer: RTCSessionDescriptionInit }) => {
      handleOffer(fromUserId, offer);
    };

    const onAnswer = ({ fromUserId, answer }: { roomId: string; fromUserId: string; answer: RTCSessionDescriptionInit }) => {
      handleAnswer(fromUserId, answer);
    };

    const onIce = ({ fromUserId, candidate }: { roomId: string; fromUserId: string; candidate: RTCIceCandidateInit }) => {
      handleIce(fromUserId, candidate);
    };

    socket.on('group:existing-participants', onExistingParticipants);
    socket.on('group:participant-joined', onParticipantJoined);
    socket.on('group:participant-left', onParticipantLeft);
    socket.on('group:offer', onOffer);
    socket.on('group:answer', onAnswer);
    socket.on('group:ice', onIce);

    return () => {
      socket.off('group:existing-participants', onExistingParticipants);
      socket.off('group:participant-joined', onParticipantJoined);
      socket.off('group:participant-left', onParticipantLeft);
      socket.off('group:offer', onOffer);
      socket.off('group:answer', onAnswer);
      socket.off('group:ice', onIce);
    };
  }, [createPeer, sendOffer, handleOffer, handleAnswer, handleIce, removeRemoteStream]);

  // Cleanup on unmount
  useEffect(() => {
    return () => {
      if (joinedRef.current) {
        socket.emit('group:leave', { roomId: postId });
        leaveGroupCall(postId).catch(() => {});
      }
      for (const [, entry] of peersRef.current) {
        closePeerConnection(entry.pc);
      }
      peersRef.current.clear();
      localStreamRef.current?.getTracks().forEach((t) => t.stop());
      localStreamRef.current = null;
    };
  }, [postId]);

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
