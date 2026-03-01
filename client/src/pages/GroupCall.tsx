// ---------------------------------------------------------------------------
// pages/GroupCall.tsx — Group video call page with mesh WebRTC
// ---------------------------------------------------------------------------

import React, { useEffect, useRef, useState, useCallback } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { useAuth } from '../hooks/useAuth';
import { useGroupCall } from '../hooks/useGroupCall';
import { useMediaToggles } from '../hooks/useMediaToggles';
import CallControls, { PhoneOffIcon } from '../components/CallControls';
import socket from '../socket';

interface TranscriptEntry {
  userId: string;
  displayName: string;
  text: string;
  lang: string;
}

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
  const screenStreamRef = useRef<MediaStream | null>(null);

  // Transcription state
  const [liveSubtitle, setLiveSubtitle] = useState<{ text: string; userId: string } | null>(null);
  const [transcriptEntries, setTranscriptEntries] = useState<TranscriptEntry[]>([]);
  const subtitleTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

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

  // Transcript socket events
  useEffect(() => {
    const onTranscript = ({ text, userId }: { text: string; userId: string }) => {
      if (!text) {
        setLiveSubtitle(null);
        return;
      }
      setLiveSubtitle({ text, userId });
      if (subtitleTimerRef.current) clearTimeout(subtitleTimerRef.current);
      subtitleTimerRef.current = setTimeout(() => setLiveSubtitle(null), 5000);
    };

    const onTranscriptEntry = (entry: TranscriptEntry) => {
      setTranscriptEntries((prev) => [...prev.slice(-49), entry]);
    };

    socket.on('transcript', onTranscript);
    socket.on('transcript:entry', onTranscriptEntry);

    return () => {
      socket.off('transcript', onTranscript);
      socket.off('transcript:entry', onTranscriptEntry);
      if (subtitleTimerRef.current) clearTimeout(subtitleTimerRef.current);
    };
  }, []);

  // Leave and navigate back
  const handleLeave = useCallback(() => {
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

        // Replace video track on all PCs
        for (const [, entry] of peersRef.current) {
          const sender = entry.pc.getSenders().find((s) => s.track?.kind === 'video');
          if (sender) await sender.replaceTrack(screenTrack);
        }

        // Restore camera when user stops sharing via browser UI
        screenTrack.onended = () => {
          setIsScreenSharing(false);
          screenStreamRef.current = null;
          const cameraTrack = localStreamRef.current?.getVideoTracks()[0];
          if (cameraTrack) {
            for (const [, entry] of peersRef.current) {
              const sender = entry.pc.getSenders().find((s) => s.track?.kind === 'video');
              if (sender) sender.replaceTrack(cameraTrack);
            }
          }
        };
      } catch (err) {
        console.error('[group-call] Screen share failed:', err);
      }
    }
  }, [isScreenSharing, peersRef, localStreamRef]);

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
    <div className="gc-page">
      <div className={`gc-grid ${gridClass}`}>
        {/* Local video */}
        <div className="gc-tile">
          <video
            ref={localVideoRef}
            autoPlay
            playsInline
            muted
            className="gc-video"
          />
          <div className="gc-tile-label">
            {user?.display_name || user?.username || 'You'}
            {isMuted && <span className="gc-mute-indicator" title="Muted">🔇</span>}
          </div>
        </div>

        {/* Remote videos */}
        {Array.from(remoteStreams.entries()).map(([userId, stream]) => (
          <RemoteVideoTile
            key={userId}
            stream={stream}
            displayName={getDisplayName(userId)}
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
  );
}

// ---------------------------------------------------------------------------
// Remote video tile (avoids re-mounting <video> on every render)
// ---------------------------------------------------------------------------

function RemoteVideoTile({ stream, displayName }: { stream: MediaStream; displayName: string }) {
  const videoRef = useRef<HTMLVideoElement>(null);

  useEffect(() => {
    if (videoRef.current) {
      videoRef.current.srcObject = stream;
    }
  }, [stream]);

  const audioEnabled = stream.getAudioTracks().some((t) => t.enabled);

  return (
    <div className="gc-tile">
      <video
        ref={videoRef}
        autoPlay
        playsInline
        className="gc-video"
      />
      <div className="gc-tile-label">
        {displayName}
        {!audioEnabled && <span className="gc-mute-indicator" title="Muted">🔇</span>}
      </div>
    </div>
  );
}
