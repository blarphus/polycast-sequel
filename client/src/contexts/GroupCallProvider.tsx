// ---------------------------------------------------------------------------
// contexts/GroupCallProvider.tsx -- App-level group-call session state.
//
// Owns the mesh peer connections (via useGroupCall), local media, outgoing
// transcription, mute/camera state, active-speaker tracking, and tab-close
// notifications for a group class call so the call survives in-app route
// navigation. pages/GroupCall.tsx and FloatingCallTile are thin views over
// useActiveGroupCall().
// ---------------------------------------------------------------------------

import React, {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useRef,
  useState,
} from 'react';
import socket from '../socket';
import { useGroupCall } from '../hooks/useGroupCall';
import type { CallStatus, Participant, PeerEntry } from '../hooks/useGroupCall';
import { useMediaToggles } from '../hooks/useMediaToggles';
import { leaveGroupCall } from '../api';
import { TranscriptionService } from '../transcription';
import { useAuth } from '../hooks/useAuth';
import { emitFallbackDiagnostic } from '../utils/fallbackDiagnostics';

export interface ActiveGroupCallValue {
  /** True while a group-call session exists (joining, connected, or errored). */
  active: boolean;
  /** The postId of the room this session belongs to (null when inactive). */
  postId: string | null;
  callStatus: CallStatus;
  remoteStreams: Map<string, MediaStream>;
  participants: Participant[];
  /** userId of whoever spoke most recently (cleared ~1.8s after they stop). */
  activeSpeakerId: string | null;
  streamReady: boolean;
  localStreamRef: React.MutableRefObject<MediaStream | null>;
  peersRef: React.MutableRefObject<Map<string, PeerEntry>>;
  isMuted: boolean;
  isCameraOff: boolean;
  toggleMute: () => void;
  toggleCamera: () => void;
  /** Join a room (leaving the current one first if it's a different room). */
  joinRoom: (postId: string) => void;
  /** Leave the current room and clear the session. */
  leaveRoom: () => void;
}

const GroupCallContext = createContext<ActiveGroupCallValue | null>(null);

export function useActiveGroupCall(): ActiveGroupCallValue {
  const value = useContext(GroupCallContext);
  if (!value) {
    throw new Error('useActiveGroupCall must be used within GroupCallProvider');
  }
  return value;
}

export function GroupCallProvider({ children }: { children: React.ReactNode }) {
  const { user } = useAuth();
  const [activePostId, setActivePostId] = useState<string | null>(null);
  const activePostIdRef = useRef<string | null>(null);

  const {
    localStreamRef,
    remoteStreams,
    participants,
    callStatus,
    streamReady,
    join,
    leave,
    peersRef,
  } = useGroupCall(activePostId);

  const { isMuted, isCameraOff, toggleMute, toggleCamera, reset: resetToggles } = useMediaToggles(localStreamRef);

  const transcriptionRef = useRef<TranscriptionService | null>(null);
  const [activeSpeakerId, setActiveSpeakerId] = useState<string | null>(null);
  const activeSpeakerTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const handleToggleMute = useCallback(() => {
    toggleMute();
    const audioTrack = localStreamRef.current?.getAudioTracks()[0];
    transcriptionRef.current?.setMuted(audioTrack ? !audioTrack.enabled : false);
  }, [toggleMute, localStreamRef]);

  // Join whenever a target room is set. useGroupCall's own cleanup leaves the
  // previous room first when activePostId changes (its effects run before
  // this one, since the hook is called earlier in this component).
  useEffect(() => {
    if (activePostId) void join();
  }, [activePostId, join]);

  const joinRoom = useCallback((postId: string) => {
    if (activePostIdRef.current === postId) {
      // Same room: no-op if already joined; retries after an error/idle state.
      void join();
    } else {
      activePostIdRef.current = postId;
      setActivePostId(postId);
    }
  }, [join]);

  const leaveRoom = useCallback(() => {
    transcriptionRef.current?.stop();
    transcriptionRef.current = null;
    leave();
    resetToggles();
    activePostIdRef.current = null;
    setActivePostId(null);
  }, [leave, resetToggles]);

  // Authentication owns the socket lifetime, so logout must also own the
  // active call teardown. This runs before/alongside socket disconnection and
  // guarantees local camera/microphone tracks are never retained by the app.
  useEffect(() => {
    if (!user && activePostIdRef.current) leaveRoom();
  }, [user, leaveRoom]);

  // Outgoing transcription: stream the local mic to the room while connected.
  useEffect(() => {
    if (callStatus !== 'connected' || !activePostId || !localStreamRef.current) return undefined;
    if (transcriptionRef.current) return undefined;

    const service = new TranscriptionService(activePostId);
    transcriptionRef.current = service;
    service.start(localStreamRef.current);

    return () => {
      if (transcriptionRef.current === service) {
        service.stop();
        transcriptionRef.current = null;
      }
    };
  }, [callStatus, activePostId, localStreamRef]);

  // Track the active speaker from transcript events (used by the page grid
  // highlight and by the floating tile to pick which video to show).
  useEffect(() => {
    if (!activePostId) return undefined;

    const onTranscript = ({ text, userId, roomId }: { text: string; userId: string; roomId?: string | null }) => {
      if (roomId !== activePostId) return;
      if (!text) return;
      setActiveSpeakerId(userId);
      if (activeSpeakerTimerRef.current) clearTimeout(activeSpeakerTimerRef.current);
      activeSpeakerTimerRef.current = setTimeout(() => setActiveSpeakerId(null), 1800);
    };

    socket.on('transcript', onTranscript);
    return () => {
      socket.off('transcript', onTranscript);
      if (activeSpeakerTimerRef.current) clearTimeout(activeSpeakerTimerRef.current);
      setActiveSpeakerId(null);
    };
  }, [activePostId]);

  // Mirror the live-session state into a ref for the unload handlers.
  const liveRoomRef = useRef<string | null>(null);
  useEffect(() => {
    liveRoomRef.current =
      activePostId && (callStatus === 'joining' || callStatus === 'connected')
        ? activePostId
        : null;
  }, [activePostId, callStatus]);

  // Notify the server when the tab actually closes during a live group call.
  // (In-app navigation no longer leaves the call -- the session lives here.)
  useEffect(() => {
    const onBeforeUnload = (e: BeforeUnloadEvent) => {
      if (!liveRoomRef.current) return;
      e.preventDefault();
      e.returnValue = '';
    };

    const onPageHide = () => {
      const roomId = liveRoomRef.current;
      if (!roomId) return;
      socket.emit('group:leave', { roomId });
      leaveGroupCall(roomId).catch((error) => emitFallbackDiagnostic({
        code: 'group_call_pagehide_leave_failed',
        severity: 'warning',
        title: 'Group call close confirmation failed',
        message: `This tab closed its local connection to room ${roomId}, but the server confirmation request failed. Socket disconnect cleanup will make a second bounded cleanup attempt.`,
        detail: error instanceof Error ? error.message : String(error),
      }, { source: 'web.group-call', operation: 'pagehide-leave' }));
    };

    window.addEventListener('beforeunload', onBeforeUnload);
    window.addEventListener('pagehide', onPageHide);

    return () => {
      window.removeEventListener('beforeunload', onBeforeUnload);
      window.removeEventListener('pagehide', onPageHide);
    };
  }, []);

  // Provider unmount (app teardown): stop transcription. useGroupCall's own
  // unmount cleanup handles the peers, local media, and leave notifications.
  useEffect(() => {
    return () => {
      transcriptionRef.current?.stop();
      transcriptionRef.current = null;
    };
  }, []);

  const value: ActiveGroupCallValue = {
    active: activePostId !== null,
    postId: activePostId,
    callStatus,
    remoteStreams,
    participants,
    activeSpeakerId,
    streamReady,
    localStreamRef,
    peersRef,
    isMuted,
    isCameraOff,
    toggleMute: handleToggleMute,
    toggleCamera,
    joinRoom,
    leaveRoom,
  };

  return <GroupCallContext.Provider value={value}>{children}</GroupCallContext.Provider>;
}
