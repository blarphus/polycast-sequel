// ---------------------------------------------------------------------------
// pages/Call.tsx -- Active 1:1 call page (thin view over CallProvider)
//
// The call session itself (WebRTC, media, transcription, signaling) lives in
// contexts/CallProvider.tsx so it survives in-app navigation. This page only
// starts the session from URL params and renders it.
// ---------------------------------------------------------------------------

import { useEffect, useRef, useState } from 'react';
import { useParams, useSearchParams, useNavigate } from 'react-router-dom';
import { useAuth } from '../hooks/useAuth';
import { useAutoHideControls } from '../hooks/useAutoHideControls';
import { useActiveCall } from '../contexts/CallProvider';
import type { CallRole } from '../contexts/CallProvider';
import CallControls, { PhoneOffIcon } from '../components/CallControls';
import TranscriptPanel from '../components/TranscriptPanel';
import { useSavedWords } from '../hooks/useSavedWords';
import '../styles/call.css';

export default function Call() {
  const { peerId } = useParams<{ peerId: string }>();
  const [searchParams] = useSearchParams();
  const rawRole = searchParams.get('role');
  const role: CallRole | null = rawRole === 'caller' || rawRole === 'callee' ? rawRole : null;
  const initialCallId = searchParams.get('callId');
  const displayName = searchParams.get('name') || 'Polycast call';
  const navigate = useNavigate();
  const { user } = useAuth();

  const {
    active,
    callEnded,
    callId,
    callStatus,
    turnWarning,
    remoteStream,
    remoteHasVideo,
    mediaStatus,
    mediaError,
    localVideoRef,
    localStreamRef,
    isMuted,
    isCameraOff,
    isScreenSharing,
    transcriptEntries,
    remoteLang,
    startCall,
    endCall,
    toggleMute,
    toggleCamera,
    toggleScreenShare,
    retryMedia,
  } = useActiveCall();

  const remoteVideoRef = useRef<HTMLVideoElement>(null);
  const [transcriptOpen, setTranscriptOpen] = useState(true);
  const { controlsHidden, showControls } = useAutoHideControls();
  const { savedWordsSet, isWordSaved, isDefinitionSaved, addWord, addOptimistic, removeWord } = useSavedWords();

  // Start the call session if none is active for these URL params.
  useEffect(() => {
    if (!peerId || !role || active) return;
    startCall({ peerId, role, callId: initialCallId, displayName });
  }, [active, displayName, initialCallId, peerId, role, startCall]);

  // Attach the remote stream to this page's video element.
  useEffect(() => {
    if (remoteVideoRef.current) {
      remoteVideoRef.current.srcObject = remoteStream;
    }
  }, [remoteStream]);

  // Attach the local stream on (re)mount -- useLocalMedia only sets srcObject
  // at acquisition time, and this page can remount mid-call.
  useEffect(() => {
    const el = localVideoRef.current;
    if (el && !el.srcObject && localStreamRef.current) {
      el.srcObject = localStreamRef.current;
    }
  }, [localVideoRef, localStreamRef, mediaStatus]);

  // When the call ends while this page is showing, return to /chats.
  useEffect(() => {
    if (!callEnded) return;
    const timeout = setTimeout(() => navigate('/chats'), 1500);
    return () => clearTimeout(timeout);
  }, [callEnded, navigate]);

  if (!role) {
    return (
      <div className="call-page">
        <div className="call-status-overlay">
          <p className="call-status-text">Invalid call role: "{rawRole}".</p>
          <button className="btn btn-primary" onClick={() => navigate('/chats')}>Go Home</button>
        </div>
      </div>
    );
  }

  const blockingMessage = mediaError ? `${mediaError.title}. ${mediaError.message}` : callStatus;
  const showStatus = !!blockingMessage;

  return (
    <div
      className={`call-page call-page--new${controlsHidden ? ' controls-hidden' : ''}${transcriptOpen ? ' transcript-open' : ''}`}
      onMouseMove={showControls}
      onTouchStart={showControls}
    >
      <div className="call-video-area">
        <video
          ref={remoteVideoRef}
          className="call-remote-video"
          autoPlay
          playsInline
        />

        {!remoteHasVideo && !callStatus && (
          <div className="call-remote-placeholder">
            <div className="call-avatar">{displayName.slice(0, 1).toUpperCase()}</div>
            <div>
              <div className="call-peer-name">{displayName}</div>
              <div className="call-peer-subtitle">Camera is off</div>
            </div>
          </div>
        )}

        <div className="call-top-bar">
          <div>
            <div className="call-top-name">{displayName}{isScreenSharing && <span className="call-sharing-badge">You are presenting</span>}</div>
            <div className="call-top-status">
              {callId ? `Call ${callId.slice(0, 8)}` : mediaStatus === 'requesting' ? 'Requesting camera and microphone' : 'Ready'}
            </div>
          </div>
          {turnWarning && <div className="call-network-warning">{turnWarning}</div>}
        </div>

        <div className={`call-local-tile${isCameraOff ? ' camera-off' : ''}`}>
          <video
            ref={localVideoRef}
            className="call-local-video"
            autoPlay
            playsInline
            muted
          />
          {isCameraOff && <div className="call-local-off">Camera off</div>}
        </div>

        {showStatus && (
          <div className="call-status-overlay">
            <div className="call-status-card">
              <p className="call-status-text">{blockingMessage}</p>
              {mediaError && (
                <button className="btn btn-primary" onClick={() => retryMedia().catch(() => undefined)}>
                  Try Again
                </button>
              )}
            </div>
          </div>
        )}

        <button
          className="call-transcript-toggle"
          type="button"
          onClick={() => setTranscriptOpen((open) => !open)}
        >
          {transcriptOpen ? 'Hide transcript' : 'Show transcript'}
        </button>

        <CallControls
          isMuted={isMuted}
          isCameraOff={isCameraOff}
          isScreenSharing={isScreenSharing}
          onToggleMute={toggleMute}
          onToggleCamera={toggleCamera}
          onToggleScreenShare={toggleScreenShare}
          primaryAction={{
            label: 'End Call',
            icon: <PhoneOffIcon />,
            onClick: endCall,
            variant: 'danger',
          }}
        />
      </div>

      {transcriptOpen && (
        <TranscriptPanel
          entries={transcriptEntries}
          nativeLang={user?.native_language ?? undefined}
          targetLang={(remoteLang || user?.target_language) ?? undefined}
          savedWords={savedWordsSet}
          isWordSaved={isWordSaved}
          isDefinitionSaved={isDefinitionSaved}
          onSaveWord={addWord}
          onRemoveWord={removeWord}
          onOptimisticSave={addOptimistic}
        />
      )}
    </div>
  );
}
