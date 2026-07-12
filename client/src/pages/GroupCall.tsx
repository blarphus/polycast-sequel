import { createScopedRuntimeLogger } from '../utils/scopedRuntimeLogger';
const runtimeLog = createScopedRuntimeLogger('web.pages.groupcall');
// ---------------------------------------------------------------------------
// pages/GroupCall.tsx — Group video call page. Thin view over the app-level
// group-call session (contexts/GroupCallProvider.tsx): mounting joins the
// room if needed; unmounting does NOT leave, so the call survives navigation.
// ---------------------------------------------------------------------------

import '../styles/groupCall.css';
import { useEffect, useRef, useState, useCallback } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { useAuth } from '../hooks/useAuth';
import { useActiveGroupCall } from '../contexts/GroupCallProvider';
import CallControls, { PhoneOffIcon } from '../components/CallControls';
import { MutedSpeakerIcon } from '../components/icons';
import socket from '../socket';
import TranscriptPanel from '../components/TranscriptPanel';
import { useTranscriptEntries } from '../hooks/useTranscriptEntries';
import { useSavedWords } from '../hooks/useSavedWords';

export default function GroupCall() {
  const { postId } = useParams<{ postId: string }>();
  const navigate = useNavigate();
  const { user } = useAuth();

  const {
    localStreamRef,
    remoteStreams,
    participants,
    callStatus,
    activeSpeakerId,
    streamReady,
    isMuted,
    isCameraOff,
    toggleMute,
    toggleCamera,
    joinRoom,
    leaveRoom,
    peersRef,
  } = useActiveGroupCall();

  const [isScreenSharing, setIsScreenSharing] = useState(false);
  const [transcriptOpen, setTranscriptOpen] = useState(true);
  const screenStreamRef = useRef<MediaStream | null>(null);

  // Transcription display state (outgoing transcription lives in the provider)
  const [liveSubtitle, setLiveSubtitle] = useState<{ text: string; userId: string; lang?: string } | null>(null);
  const subtitleTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const { transcriptEntries, onTranscriptEntry } = useTranscriptEntries(user?.native_language);
  const { savedWordsSet, isWordSaved, isDefinitionSaved, addWord, addOptimistic, removeWord } = useSavedWords();

  // Local video ref
  const localVideoRef = useRef<HTMLVideoElement>(null);

  // Join on mount (leaves any other active group room first, inside the provider)
  useEffect(() => {
    joinRoom(postId!);
  }, [joinRoom, postId]);

  // Attach local stream to video element
  useEffect(() => {
    if (localVideoRef.current && localStreamRef.current) {
      localVideoRef.current.srcObject = localStreamRef.current;
    }
  }, [streamReady, localStreamRef]);

  // Transcript socket events (subtitle overlay + transcript panel entries)
  useEffect(() => {
    const onTranscript = ({ text, userId, lang, roomId }: { text: string; userId: string; lang?: string; roomId?: string | null }) => {
      if (roomId !== postId) return;
      if (!text) {
        setLiveSubtitle(null);
        return;
      }
      setLiveSubtitle({ text, userId, lang });
      if (subtitleTimerRef.current) clearTimeout(subtitleTimerRef.current);
      subtitleTimerRef.current = setTimeout(() => setLiveSubtitle(null), 5000);
    };

    socket.on('transcript', onTranscript);
    const onRoomTranscriptEntry = (entry: Parameters<typeof onTranscriptEntry>[0] & { roomId?: string | null }) => {
      if (entry.roomId !== postId) return;
      onTranscriptEntry(entry);
    };
    socket.on('transcript:entry', onRoomTranscriptEntry);

    return () => {
      socket.off('transcript', onTranscript);
      socket.off('transcript:entry', onRoomTranscriptEntry);
      if (subtitleTimerRef.current) clearTimeout(subtitleTimerRef.current);
    };
  }, [onTranscriptEntry, postId]);

  // Stop screen share: kill the presentation stream and put the camera track
  // back on every peer connection.
  const stopScreenShare = useCallback(() => {
    screenStreamRef.current?.getTracks().forEach((t) => t.stop());
    screenStreamRef.current = null;
    setIsScreenSharing(false);
    if (localVideoRef.current) localVideoRef.current.srcObject = localStreamRef.current;

    const cameraTrack = localStreamRef.current?.getVideoTracks()[0];
    if (cameraTrack) {
      for (const [, entry] of peersRef.current) {
        const sender = entry.pc.getSenders().find((s) => s.track?.kind === 'video');
        if (sender) {
          sender.replaceTrack(cameraTrack).catch((err) => {
            runtimeLog.error('[group-call] Failed to restore camera track after screen share:', err);
          });
        }
      }
    }
  }, [localStreamRef, peersRef]);

  // Leave and navigate back
  const handleLeave = useCallback(() => {
    if (screenStreamRef.current) stopScreenShare();
    leaveRoom();
    navigate(-1);
  }, [leaveRoom, navigate, stopScreenShare]);

  // Screen share — replace video track on all peer connections
  const toggleScreenShare = useCallback(async () => {
    if (isScreenSharing) {
      stopScreenShare();
    } else {
      try {
        const screenStream = await navigator.mediaDevices.getDisplayMedia({ video: true });
        screenStreamRef.current = screenStream;
        setIsScreenSharing(true);

        const screenTrack = screenStream.getVideoTracks()[0];
        if (localVideoRef.current) localVideoRef.current.srcObject = screenStream;

        // Replace video track on all PCs
        for (const [, entry] of peersRef.current) {
          const sender = entry.pc.getSenders().find((s) => s.track?.kind === 'video');
          if (sender) await sender.replaceTrack(screenTrack);
        }

        // Restore camera when user stops sharing via browser UI
        screenTrack.onended = () => {
          stopScreenShare();
        };
      } catch (err) {
        runtimeLog.error('[group-call] Screen share failed:', err);
      }
    }
  }, [isScreenSharing, peersRef, stopScreenShare]);

  // A participant can join after sharing starts; make sure their newly-created
  // sender receives the presentation track instead of the camera track.
  useEffect(() => {
    const screenTrack = screenStreamRef.current?.getVideoTracks()[0];
    if (!isScreenSharing || !screenTrack) return;
    for (const [, entry] of peersRef.current) {
      const sender = entry.pc.getSenders().find((candidate) => candidate.track?.kind === 'video');
      if (sender && sender.track !== screenTrack) {
        sender.replaceTrack(screenTrack).catch((err) => runtimeLog.error('[group-call] Failed to share with new participant:', err));
      }
    }
  }, [isScreenSharing, participants, peersRef]);

  // Page unmount: the call itself keeps going (provider owns it), but screen
  // share is a page-level feature — stop it and restore the camera track.
  useEffect(() => {
    const stopSharing = stopScreenShareRef;
    return () => {
      if (screenStreamRef.current) stopSharing.current();
    };
  }, []);
  const stopScreenShareRef = useRef(stopScreenShare);
  useEffect(() => {
    stopScreenShareRef.current = stopScreenShare;
  }, [stopScreenShare]);

  // Build participant list for display (remote + self)
  const totalParticipants = 1 + remoteStreams.size;
  const gridClass =
    totalParticipants <= 1 ? 'gc-grid--1' :
    totalParticipants === 2 ? 'gc-grid--2' :
    totalParticipants <= 4 ? 'gc-grid--4' :
    'gc-grid--many';

  // Get display name for a userId from participants list
  const getDisplayName = (userId: string) => {
    const p = participants.find((p) => p.userId === userId);
    return p?.displayName || 'Participant';
  };

  if (callStatus === 'error') {
    return (
      <div className="gc-page">
        <div className="gc-error">
          <p>Failed to join the call.</p>
          <button className="btn btn-secondary" onClick={() => navigate(-1)}>Go back</button>
        </div>
      </div>
    );
  }

  return (
    <div className={`gc-page${transcriptOpen ? ' transcript-open' : ''}`}>
      <div className="gc-stage">
        <div className="gc-topbar">
          <div><strong>Group conversation</strong><span>{totalParticipants} participant{totalParticipants === 1 ? '' : 's'}</span></div>
          <button type="button" onClick={() => setTranscriptOpen((open) => !open)}>{transcriptOpen ? 'Hide transcript' : 'Show transcript'}</button>
        </div>
      <div className={`gc-grid ${gridClass}`}>
        {/* Local video */}
        <div className={`gc-tile${activeSpeakerId === user?.id ? ' gc-tile--speaking' : ''}${isScreenSharing ? ' gc-tile--sharing' : ''}`}>
          <video
            ref={localVideoRef}
            autoPlay
            playsInline
            muted
            className="gc-video"
          />
          <div className="gc-tile-label">
            {user?.display_name || user?.username || 'You'}
            {isScreenSharing && <span className="gc-sharing-label">Presenting</span>}
            {isMuted && <span className="gc-mute-indicator" title="Muted"><MutedSpeakerIcon size={14} /></span>}
          </div>
        </div>

        {/* Remote videos */}
        {Array.from(remoteStreams.entries()).map(([userId, stream]) => (
          <RemoteVideoTile
            key={userId}
            stream={stream}
            displayName={getDisplayName(userId)}
            isSpeaking={activeSpeakerId === userId}
          />
        ))}

        {/* Waiting message when alone */}
        {remoteStreams.size === 0 && callStatus === 'connected' && (
          <div className="gc-tile gc-tile--waiting">
            <p>Waiting for others to join...</p>
          </div>
        )}
      </div>

      {/* Live subtitle overlay */}
      {liveSubtitle && liveSubtitle.text && (
        <div className="gc-subtitle">
          <span className="gc-subtitle-speaker">{liveSubtitle.userId === user?.id ? 'You' : getDisplayName(liveSubtitle.userId)}{liveSubtitle.lang ? ` · ${liveSubtitle.lang.toUpperCase()}` : ''}</span>
          <span className="gc-subtitle-text">{liveSubtitle.text}</span>
        </div>
      )}

      {/* Call controls */}
      <CallControls
        isMuted={isMuted}
        isCameraOff={isCameraOff}
        isScreenSharing={isScreenSharing}
        onToggleMute={toggleMute}
        onToggleCamera={toggleCamera}
        onToggleScreenShare={toggleScreenShare}
        primaryAction={{
          label: 'Leave',
          icon: <PhoneOffIcon />,
          onClick: handleLeave,
          variant: 'danger',
        }}
      />
      </div>
      {transcriptOpen && (
        <TranscriptPanel
          entries={transcriptEntries}
          nativeLang={user?.native_language ?? undefined}
          targetLang={user?.target_language ?? undefined}
          savedWords={savedWordsSet}
          isWordSaved={isWordSaved}
          isDefinitionSaved={isDefinitionSaved}
          onSaveWord={addWord}
          onRemoveWord={removeWord}
          onOptimisticSave={addOptimistic}
          title="Group transcript"
        />
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Remote video tile (avoids re-mounting <video> on every render)
// ---------------------------------------------------------------------------

function RemoteVideoTile({ stream, displayName, isSpeaking }: { stream: MediaStream; displayName: string; isSpeaking: boolean }) {
  const videoRef = useRef<HTMLVideoElement>(null);

  useEffect(() => {
    if (videoRef.current) {
      videoRef.current.srcObject = stream;
    }
  }, [stream]);

  const audioEnabled = stream.getAudioTracks().some((t) => t.enabled);

  return (
    <div className={`gc-tile${isSpeaking ? ' gc-tile--speaking' : ''}`}>
      <video
        ref={videoRef}
        autoPlay
        playsInline
        className="gc-video"
      />
      <div className="gc-tile-label">
        {displayName}
        {!audioEnabled && <span className="gc-mute-indicator" title="Muted"><MutedSpeakerIcon size={14} /></span>}
      </div>
    </div>
  );
}
