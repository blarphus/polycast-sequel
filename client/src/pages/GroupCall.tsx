// ---------------------------------------------------------------------------
// pages/GroupCall.tsx — Group video call page with mesh WebRTC
// ---------------------------------------------------------------------------

import { useEffect, useRef, useState, useCallback } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { useAuth } from '../hooks/useAuth';
import { useGroupCall } from '../hooks/useGroupCall';
import { useMediaToggles } from '../hooks/useMediaToggles';
import CallControls, { PhoneOffIcon } from '../components/CallControls';
import { MutedSpeakerIcon } from '../components/icons';
import socket from '../socket';
import { TranscriptionService } from '../transcription';
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
    streamReady,
    join,
    leave,
    peersRef,
  } = useGroupCall(postId!);

  const { isMuted, isCameraOff, toggleMute, toggleCamera } = useMediaToggles(localStreamRef);
  const [isScreenSharing, setIsScreenSharing] = useState(false);
  const [transcriptOpen, setTranscriptOpen] = useState(true);
  const [activeSpeakerId, setActiveSpeakerId] = useState<string | null>(null);
  const screenStreamRef = useRef<MediaStream | null>(null);
  const transcriptionRef = useRef<TranscriptionService | null>(null);

  const handleToggleMute = useCallback(() => {
    toggleMute();
    const audioTrack = localStreamRef.current?.getAudioTracks()[0];
    transcriptionRef.current?.setMuted(audioTrack ? !audioTrack.enabled : false);
  }, [toggleMute, localStreamRef]);

  // Transcription state
  const [liveSubtitle, setLiveSubtitle] = useState<{ text: string; userId: string; lang?: string } | null>(null);
  const subtitleTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const activeSpeakerTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const { transcriptEntries, onTranscriptEntry } = useTranscriptEntries(user?.native_language);
  const { savedWordsSet, isWordSaved, isDefinitionSaved, addWord, addOptimistic, removeWord } = useSavedWords();

  // Local video ref
  const localVideoRef = useRef<HTMLVideoElement>(null);

  // Auto-join on mount
  useEffect(() => {
    join();
  }, [join]);

  // Attach local stream to video element
  useEffect(() => {
    if (localVideoRef.current && localStreamRef.current) {
      localVideoRef.current.srcObject = localStreamRef.current;
    }
  }, [streamReady, localStreamRef]);

  useEffect(() => {
    if (callStatus !== 'connected' || !localStreamRef.current) return undefined;
    if (transcriptionRef.current) return undefined;

    const service = new TranscriptionService(postId!);
    transcriptionRef.current = service;
    service.start(localStreamRef.current);

    return () => {
      if (transcriptionRef.current === service) {
        service.stop();
        transcriptionRef.current = null;
      }
    };
  }, [callStatus, localStreamRef, postId]);

  // Transcript socket events
  useEffect(() => {
    const onTranscript = ({ text, userId, lang }: { text: string; userId: string; lang?: string }) => {
      if (!text) {
        setLiveSubtitle(null);
        return;
      }
      setLiveSubtitle({ text, userId, lang });
      setActiveSpeakerId(userId);
      if (activeSpeakerTimerRef.current) clearTimeout(activeSpeakerTimerRef.current);
      activeSpeakerTimerRef.current = setTimeout(() => setActiveSpeakerId(null), 1800);
      if (subtitleTimerRef.current) clearTimeout(subtitleTimerRef.current);
      subtitleTimerRef.current = setTimeout(() => setLiveSubtitle(null), 5000);
    };

    socket.on('transcript', onTranscript);
    socket.on('transcript:entry', onTranscriptEntry);

    return () => {
      socket.off('transcript', onTranscript);
      socket.off('transcript:entry', onTranscriptEntry);
      if (subtitleTimerRef.current) clearTimeout(subtitleTimerRef.current);
      if (activeSpeakerTimerRef.current) clearTimeout(activeSpeakerTimerRef.current);
    };
  }, [onTranscriptEntry]);

  // Leave and navigate back
  const handleLeave = useCallback(() => {
    transcriptionRef.current?.stop();
    transcriptionRef.current = null;
    screenStreamRef.current?.getTracks().forEach((track) => track.stop());
    screenStreamRef.current = null;
    leave();
    navigate(-1);
  }, [leave, navigate]);

  // Screen share — replace video track on all peer connections
  const toggleScreenShare = useCallback(async () => {
    if (isScreenSharing) {
      // Stop screen share, restore camera
      screenStreamRef.current?.getTracks().forEach((t) => t.stop());
      screenStreamRef.current = null;
      setIsScreenSharing(false);
      if (localVideoRef.current) localVideoRef.current.srcObject = localStreamRef.current;

      const cameraTrack = localStreamRef.current?.getVideoTracks()[0];
      if (cameraTrack) {
        for (const [, entry] of peersRef.current) {
          const sender = entry.pc.getSenders().find((s) => s.track?.kind === 'video');
          if (sender) await sender.replaceTrack(cameraTrack);
        }
      }
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
        screenTrack.onended = async () => {
          setIsScreenSharing(false);
          screenStreamRef.current = null;
          if (localVideoRef.current) localVideoRef.current.srcObject = localStreamRef.current;
          const cameraTrack = localStreamRef.current?.getVideoTracks()[0];
          if (cameraTrack) {
            for (const [, entry] of peersRef.current) {
              const sender = entry.pc.getSenders().find((s) => s.track?.kind === 'video');
              if (sender) {
                try {
                  await sender.replaceTrack(cameraTrack);
                } catch (err) {
                  console.error('[group-call] Failed to restore camera track after screen share:', err);
                }
              }
            }
          }
        };
      } catch (err) {
        console.error('[group-call] Screen share failed:', err);
      }
    }
  }, [isScreenSharing, peersRef, localStreamRef]);

  // A participant can join after sharing starts; make sure their newly-created
  // sender receives the presentation track instead of the camera track.
  useEffect(() => {
    const screenTrack = screenStreamRef.current?.getVideoTracks()[0];
    if (!isScreenSharing || !screenTrack) return;
    for (const [, entry] of peersRef.current) {
      const sender = entry.pc.getSenders().find((candidate) => candidate.track?.kind === 'video');
      if (sender && sender.track !== screenTrack) {
        sender.replaceTrack(screenTrack).catch((err) => console.error('[group-call] Failed to share with new participant:', err));
      }
    }
  }, [isScreenSharing, participants, peersRef]);

  useEffect(() => () => {
    screenStreamRef.current?.getTracks().forEach((track) => track.stop());
  }, []);

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
        onToggleMute={handleToggleMute}
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
