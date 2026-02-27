// ---------------------------------------------------------------------------
// pages/Test.tsx -- Solo test mode for camera + Voxtral transcription
// ---------------------------------------------------------------------------

import React, { useCallback } from 'react';
import { useNavigate } from 'react-router-dom';
import { useAuth } from '../hooks/useAuth';
import { useAutoHideControls } from '../hooks/useAutoHideControls';
import { useMediaToggles } from '../hooks/useMediaToggles';
import { useTranscription } from '../hooks/useTranscription';
import SubtitleBar from '../components/SubtitleBar';
import CallControls, { PhoneOffIcon } from '../components/CallControls';
import TranscriptPanel from '../components/TranscriptPanel';
import { useSavedWords } from '../hooks/useSavedWords';

export default function Test() {
  const navigate = useNavigate();
  const { user } = useAuth();

  const {
    streamRef,
    videoRef,
    localText,
    transcriptEntries,
    cleanupTranscription,
  } = useTranscription('__test__');

  const { controlsHidden, showControls } = useAutoHideControls();
  const { isMuted, isCameraOff, toggleMute, toggleCamera } = useMediaToggles(streamRef);
  const { savedWordsSet, isDefinitionSaved, addWord } = useSavedWords();

  const goBack = useCallback(() => {
    cleanupTranscription();
    navigate('/');
  }, [navigate, cleanupTranscription]);

  return (
    <div
      className={`call-page${controlsHidden ? ' controls-hidden' : ''}`}
      onMouseMove={showControls}
      onTouchStart={showControls}
    >
      <div className="call-video-area">
        <video
          ref={videoRef}
          className="test-self-video"
          autoPlay
          playsInline
          muted
        />

        <div className="test-label">Test Mode</div>

        <SubtitleBar localText={localText} remoteText="" remoteLang="" nativeLang={user?.native_language ?? undefined} savedWords={savedWordsSet} isDefinitionSaved={isDefinitionSaved} onSaveWord={addWord} />

        <CallControls
          isMuted={isMuted}
          isCameraOff={isCameraOff}
          onToggleMute={toggleMute}
          onToggleCamera={toggleCamera}
          primaryAction={{
            label: 'End Test',
            icon: <PhoneOffIcon />,
            onClick: goBack,
            variant: 'danger',
          }}
        />
      </div>

      <TranscriptPanel entries={transcriptEntries} nativeLang={user?.native_language ?? undefined} targetLang={user?.target_language ?? undefined} savedWords={savedWordsSet} isDefinitionSaved={isDefinitionSaved} onSaveWord={addWord} />
    </div>
  );
}
