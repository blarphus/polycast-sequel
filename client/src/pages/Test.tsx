// ---------------------------------------------------------------------------
// pages/Test.tsx -- Solo test mode for camera + Voxtral transcription
// ---------------------------------------------------------------------------

import React, { useEffect, useRef, useState, useCallback } from 'react';
import { useNavigate } from 'react-router-dom';
import { socket } from '../socket';
import { useAuth } from '../hooks/useAuth';
import { useAutoHideControls } from '../hooks/useAutoHideControls';
import { useMediaToggles } from '../hooks/useMediaToggles';
import { TranscriptionService } from '../transcription';
import SubtitleBar from '../components/SubtitleBar';
import CallControls, { PhoneOffIcon } from '../components/CallControls';
import TranscriptPanel, { TranscriptEntry } from '../components/TranscriptPanel';
import { useSavedWords } from '../hooks/useSavedWords';
import { translateSentence } from '../api';

export default function Test() {
  const navigate = useNavigate();
  const { user } = useAuth();

  const videoRef = useRef<HTMLVideoElement>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const transcriptionRef = useRef<TranscriptionService | null>(null);

  const [localText, setLocalText] = useState('');
  const [transcriptEntries, setTranscriptEntries] = useState<TranscriptEntry[]>([]);
  const entryIdRef = useRef(0);

  const { controlsHidden, showControls } = useAutoHideControls();
  const { isMuted, isCameraOff, toggleMute, toggleCamera } = useMediaToggles(streamRef);
  const { savedWordsSet, isWordSaved, addWord } = useSavedWords();

  const goBack = useCallback(() => {
    if (transcriptionRef.current) {
      transcriptionRef.current.stop();
      transcriptionRef.current = null;
    }
    if (streamRef.current) {
      streamRef.current.getTracks().forEach((t) => t.stop());
      streamRef.current = null;
    }
    navigate('/');
  }, [navigate]);

  useEffect(() => {
    let cleaned = false;

    const onTranscript = (data: { text: string; lang: string; userId: number }) => {
      if (data.userId === user?.id) {
        setLocalText(data.text);
      }
    };

    const onTranscriptEntry = (data: { userId: string; displayName: string; text: string; lang?: string }) => {
      const id = ++entryIdRef.current;
      const entry: TranscriptEntry = { ...data, id };
      setTranscriptEntries(prev => [...prev, entry]);

      // Auto-translate if speaking in a foreign language
      const nativeLang = user?.native_language;
      const langBase = data.lang?.split('-')[0];
      if (nativeLang && langBase && langBase !== nativeLang) {
        translateSentence(data.text, langBase, nativeLang)
          .then(({ translation }) => {
            setTranscriptEntries(prev =>
              prev.map(e => e.id === id ? { ...e, translation } : e),
            );
          })
          .catch(() => {});
      }
    };

    socket.on('transcript', onTranscript);
    socket.on('transcript:entry', onTranscriptEntry);

    async function setup() {
      try {
        const stream = await navigator.mediaDevices.getUserMedia({
          video: true,
          audio: true,
        });
        if (cleaned) {
          stream.getTracks().forEach((t) => t.stop());
          return;
        }
        streamRef.current = stream;

        if (videoRef.current) {
          videoRef.current.srcObject = stream;
        }

        const ts = new TranscriptionService('__test__');
        transcriptionRef.current = ts;
        ts.start(stream);
      } catch (err) {
        console.error('[test] Setup error:', err);
      }
    }

    setup();

    return () => {
      cleaned = true;
      socket.off('transcript', onTranscript);
      socket.off('transcript:entry', onTranscriptEntry);

      if (transcriptionRef.current) {
        transcriptionRef.current.stop();
        transcriptionRef.current = null;
      }
      if (streamRef.current) {
        streamRef.current.getTracks().forEach((t) => t.stop());
        streamRef.current = null;
      }
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

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

        <SubtitleBar localText={localText} remoteText="" remoteLang="" nativeLang={user?.native_language || undefined} savedWords={savedWordsSet} isWordSaved={isWordSaved} onSaveWord={addWord} />

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

      <TranscriptPanel entries={transcriptEntries} nativeLang={user?.native_language || undefined} targetLang={user?.target_language || undefined} savedWords={savedWordsSet} isWordSaved={isWordSaved} onSaveWord={addWord} />
    </div>
  );
}
