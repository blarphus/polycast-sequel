import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  completeVoicePracticeSession,
  createVoicePracticeSession,
  gradeVoicePracticeTurn,
  transcribeVoicePracticeTurn,
  type FeedbackLanguageMode,
  type VoiceGradeResult,
  type VoicePracticeSentence,
  type VoicePracticeSummary,
  type VoicePracticeSession,
} from '../api/voicePractice';
import { playAiSpeech, stopAiSpeech } from '../utils/aiSpeech';
import { playCorrectSound, playIncorrectSound } from '../utils/sounds';

type ConnectionState = 'idle' | 'ready' | 'error';

interface TurnRecord {
  sentenceId: string;
  result: 'correct' | 'partial' | 'incorrect' | 'skipped';
}

function formatDuration(seconds: number) {
  const mins = Math.floor(seconds / 60);
  const secs = seconds % 60;
  return mins > 0 ? `${mins}m ${secs}s` : `${secs}s`;
}

async function blobToBase64(blob: Blob) {
  const buffer = await blob.arrayBuffer();
  let binary = '';
  const bytes = new Uint8Array(buffer);
  for (let i = 0; i < bytes.length; i++) {
    binary += String.fromCharCode(bytes[i]);
  }
  return btoa(binary);
}

function shouldOfferRedo(grade: VoiceGradeResult | null, transcript: string) {
  if (!grade) return false;
  const transcriptWordCount = transcript.trim().split(/\s+/).filter(Boolean).length;
  const noteText = grade.issueNotes.map((note) => `${note.type} ${note.message}`.toLowerCase()).join(' ');

  if (grade.issueNotes.some((note) => note.type === 'pronunciation_heard_as')) return true;
  if (grade.score <= 15) return true;
  if (transcriptWordCount <= 2 && grade.result === 'incorrect') return true;
  if (
    noteText.includes('unrelated')
    || noteText.includes('did not translate')
    || noteText.includes('wrong sentence')
    || noteText.includes('bad audio')
    || noteText.includes('unclear')
    || noteText.includes('noise')
    || noteText.includes('english instead')
  ) {
    return true;
  }

  return false;
}

export function useVoicePracticeSession() {
  const [session, setSession] = useState<VoicePracticeSession | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [connectionState, setConnectionState] = useState<ConnectionState>('idle');
  const [currentIndex, setCurrentIndex] = useState(0);
  const [feedbackLanguageMode, setFeedbackLanguageMode] = useState<FeedbackLanguageMode>('native');
  const [currentTranscript, setCurrentTranscript] = useState('');
  const [currentGrade, setCurrentGrade] = useState<VoiceGradeResult | null>(null);
  const [listening, setListening] = useState(false);
  const [grading, setGrading] = useState(false);
  const [committing, setCommitting] = useState(false);
  const [summary, setSummary] = useState<VoicePracticeSummary | null>(null);
  const [audioPeaks, setAudioPeaks] = useState<number[]>(() => Array.from({ length: 72 }, () => 0.08));
  const [repeatTarget, setRepeatTarget] = useState('');
  const [repeatTranscript, setRepeatTranscript] = useState('');
  const [repeatComplete, setRepeatComplete] = useState(false);

  const mediaRecorderRef = useRef<MediaRecorder | null>(null);
  const mediaStreamRef = useRef<MediaStream | null>(null);
  const analyserRef = useRef<AnalyserNode | null>(null);
  const audioContextRef = useRef<AudioContext | null>(null);
  const animationFrameRef = useRef<number | null>(null);
  const waveformFrameCounterRef = useRef(0);
  const audioChunksRef = useRef<Blob[]>([]);
  const turnRecordsRef = useRef<TurnRecord[]>([]);
  const issueCountsRef = useRef<Record<string, number>>({});
  const sessionStartRef = useRef<number>(Date.now());
  const initStartedRef = useRef(false);
  const sessionRef = useRef<VoicePracticeSession | null>(null);
  const currentSentenceRef = useRef<VoicePracticeSentence | null>(null);
  const feedbackLanguageModeRef = useRef<FeedbackLanguageMode>('native');
  const currentIndexRef = useRef(0);
  const repeatTargetRef = useRef('');
  const currentSentence = session?.sentences[currentIndex] || null;
  const isLastPrompt = session ? currentIndex >= session.sentences.length - 1 : false;
  const isRepeatStage = Boolean(repeatTarget);

  useEffect(() => {
    sessionRef.current = session;
  }, [session]);

  useEffect(() => {
    currentSentenceRef.current = currentSentence;
  }, [currentSentence]);

  useEffect(() => {
    feedbackLanguageModeRef.current = feedbackLanguageMode;
  }, [feedbackLanguageMode]);

  useEffect(() => {
    currentIndexRef.current = currentIndex;
  }, [currentIndex]);

  useEffect(() => {
    repeatTargetRef.current = repeatTarget;
  }, [repeatTarget]);

  const counts = useMemo(() => {
    const result = { correct: 0, partial: 0, incorrect: 0, skipped: 0 };
    for (const record of turnRecordsRef.current) {
      if (record.result === 'correct') result.correct += 1;
      if (record.result === 'partial') result.partial += 1;
      if (record.result === 'incorrect') result.incorrect += 1;
      if (record.result === 'skipped') result.skipped += 1;
    }
    return result;
  }, [currentGrade, currentIndex, summary]);

  const speakFeedback = useCallback(async (text: string, languageCode: string) => {
    if (!text.trim()) return;
    try {
      await playAiSpeech(text, languageCode);
    } catch (err) {
      console.error('OpenAI TTS playback failed', err);
      setError(err instanceof Error ? err.message : 'OpenAI TTS playback failed');
    }
  }, []);

  const stopWaveform = useCallback(() => {
    if (animationFrameRef.current !== null) {
      cancelAnimationFrame(animationFrameRef.current);
      animationFrameRef.current = null;
    }
      setAudioPeaks(Array.from({ length: 72 }, () => 0.08));
  }, []);

  const startWaveform = useCallback(() => {
    const analyser = analyserRef.current;
    if (!analyser) return;

    const data = new Uint8Array(analyser.fftSize);
    const tick = () => {
      analyser.getByteTimeDomainData(data);
      let peak = 0;
      for (let i = 0; i < data.length; i++) {
        const normalized = Math.abs((data[i] - 128) / 128);
        if (normalized > peak) peak = normalized;
      }
      const visualPeak = Math.max(0.08, Math.min(1, peak * 2.4));
      waveformFrameCounterRef.current += 1;
      if (waveformFrameCounterRef.current % 9 === 0) {
        setAudioPeaks((prev) => [...prev.slice(1), visualPeak]);
      }
      animationFrameRef.current = requestAnimationFrame(tick);
    };

    stopWaveform();
    waveformFrameCounterRef.current = 0;
    animationFrameRef.current = requestAnimationFrame(tick);
  }, [stopWaveform]);

  const finalizeSession = useCallback(async () => {
    if (!session) return;
    try {
      const summaryResult = await completeVoicePracticeSession(session.sessionId, {
        answeredCount: turnRecordsRef.current.filter((record) => record.result !== 'skipped').length,
        correctCount: turnRecordsRef.current.filter((record) => record.result === 'correct').length,
        partialCount: turnRecordsRef.current.filter((record) => record.result === 'partial').length,
        incorrectCount: turnRecordsRef.current.filter((record) => record.result === 'incorrect').length,
        skippedCount: turnRecordsRef.current.filter((record) => record.result === 'skipped').length,
        durationSeconds: Math.max(1, Math.round((Date.now() - sessionStartRef.current) / 1000)),
        feedbackLanguageMode,
        issueCounts: issueCountsRef.current,
      });
      setSummary(summaryResult);
    } catch (err: any) {
      setError(err.message || 'Failed to complete voice practice session');
    }
  }, [feedbackLanguageMode, session]);

  const advanceAfterPrompt = useCallback(async () => {
    if (!sessionRef.current) return;
    if (currentIndexRef.current >= sessionRef.current.sentences.length - 1) {
      await finalizeSession();
      return;
    }
    setCurrentIndex((prev) => prev + 1);
    setCurrentTranscript('');
    setCurrentGrade(null);
    setRepeatTarget('');
    setRepeatTranscript('');
    setRepeatComplete(false);
  }, [finalizeSession]);

  const gradeTranscript = useCallback(async (transcript: string) => {
    const activeSession = sessionRef.current;
    const activeSentence = currentSentenceRef.current;
    const activeFeedbackLanguageMode = feedbackLanguageModeRef.current;
    if (!activeSession || !activeSentence) return;
    const normalized = transcript.trim();
    if (!normalized) {
      setError('No speech detected. Try again.');
      setCommitting(false);
      return;
    }

    setCurrentTranscript(normalized);
    setGrading(true);
    setCommitting(false);
    try {
      const result = await gradeVoicePracticeTurn(activeSession.sessionId, {
        sentenceId: activeSentence.id,
        userTranscript: normalized,
        feedbackLanguageMode: activeFeedbackLanguageMode,
      });
      setCurrentGrade(result);
      if (result.result === 'correct') {
        playCorrectSound();
      } else {
        playIncorrectSound();
        setRepeatTarget(result.correctedAnswer);
        setRepeatTranscript('');
        setRepeatComplete(false);
      }
      turnRecordsRef.current = [
        ...turnRecordsRef.current,
        { sentenceId: activeSentence.id, result: result.result },
      ];
      const nextIssueCounts = { ...issueCountsRef.current };
      for (const [issueType, count] of Object.entries(result.issueTypeCounts || {})) {
        nextIssueCounts[issueType] = (nextIssueCounts[issueType] || 0) + count;
      }
      issueCountsRef.current = nextIssueCounts;
      if (result.result !== 'correct') {
        void speakFeedback(result.correctedAnswer, activeSession.targetLanguage);
      }
    } catch (err: any) {
      setError(err.message || 'Failed to grade spoken answer');
    } finally {
      setGrading(false);
    }
  }, [speakFeedback]);

  useEffect(() => {
    async function init() {
      if (initStartedRef.current) return;
      initStartedRef.current = true;
      setLoading(true);
      setError('');
      try {
        const voiceSession = await createVoicePracticeSession(10, 'native');
        setSession(voiceSession);
        setFeedbackLanguageMode(voiceSession.feedbackLanguageMode);
        setCurrentIndex(voiceSession.initialPromptIndex || 0);
        setConnectionState('ready');
      } catch (err: any) {
        setError(err.message || 'Failed to start voice practice');
        setConnectionState('error');
      } finally {
        setLoading(false);
      }
    }

    init();

    return () => {
      mediaRecorderRef.current?.stop();
      mediaStreamRef.current?.getTracks().forEach((track) => track.stop());
      if (audioContextRef.current) {
        audioContextRef.current.close().catch((err) => {
          console.error('Failed to close voice practice audio context', err);
        });
      }
      stopAiSpeech();
      stopWaveform();
    };
  }, [stopWaveform]);

  const ensureRecorder = useCallback(async () => {
    if (mediaRecorderRef.current && mediaStreamRef.current) {
      return mediaRecorderRef.current;
    }
    const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
    mediaStreamRef.current = stream;

    const audioContext = new AudioContext();
    const source = audioContext.createMediaStreamSource(stream);
    const analyser = audioContext.createAnalyser();
    analyser.fftSize = 256;
    analyser.smoothingTimeConstant = 0.82;
    source.connect(analyser);
    analyserRef.current = analyser;
    audioContextRef.current = audioContext;

    const recorder = new MediaRecorder(stream, { mimeType: 'audio/webm' });
    recorder.ondataavailable = (event) => {
      if (event.data && event.data.size > 0) {
        audioChunksRef.current.push(event.data);
      }
    };
    recorder.onstop = async () => {
      const blob = new Blob(audioChunksRef.current, { type: recorder.mimeType || 'audio/webm' });
      audioChunksRef.current = [];
      if (currentSentenceRef.current && repeatTargetRef.current) {
        setRepeatTranscript('Transcribing…');
      } else {
        setCurrentTranscript('Transcribing…');
      }
      try {
        const audioBase64 = await blobToBase64(blob);
        const transcription = await transcribeVoicePracticeTurn({
          audioBase64,
          mimeType: blob.type || 'audio/webm',
          nativeLanguage: sessionRef.current?.nativeLanguage,
          targetLanguage: sessionRef.current?.targetLanguage,
        });
        const normalized = transcription.transcript.trim();
        if (repeatTargetRef.current) {
          if (!normalized) {
            setRepeatTranscript('');
            setCommitting(false);
            setError('No speech detected. Try repeating the correction once.');
            return;
          }
          setRepeatTranscript(normalized);
          setCommitting(false);
          setRepeatComplete(true);
          playCorrectSound();
          return;
        }
        await gradeTranscript(transcription.transcript);
      } catch (err: any) {
        if (repeatTargetRef.current) {
          setRepeatTranscript('');
        } else {
          setCurrentTranscript('');
        }
        setCommitting(false);
        setError(err.message || 'Failed to transcribe audio');
      }
    };
    mediaRecorderRef.current = recorder;
    return recorder;
  }, [advanceAfterPrompt, gradeTranscript]);

  const startListening = useCallback(async () => {
    if (!currentSentence || !session || connectionState !== 'ready' || grading || committing) return;
    setError('');
    if (isRepeatStage) {
      setRepeatTranscript('');
    } else {
      setCurrentTranscript('');
      setCurrentGrade(null);
    }
    setListening(true);
    try {
      const recorder = await ensureRecorder();
      audioChunksRef.current = [];
      recorder.start();
      startWaveform();
    } catch (err: any) {
      setListening(false);
      setError(err.message || 'Failed to start recording');
    }
  }, [committing, connectionState, currentSentence, ensureRecorder, grading, isRepeatStage, session, startWaveform]);

  const stopListening = useCallback(() => {
    const recorder = mediaRecorderRef.current;
    if (!recorder || !listening) return;
    setListening(false);
    setCommitting(true);
    stopWaveform();
    recorder.stop();
  }, [listening, stopWaveform]);

  const skipPrompt = useCallback(async () => {
    if (!currentSentence || !session) return;
    turnRecordsRef.current = [
      ...turnRecordsRef.current,
      { sentenceId: currentSentence.id, result: 'skipped' },
    ];
    setCurrentTranscript('');
    setCurrentGrade(null);
    setRepeatTarget('');
    setRepeatTranscript('');
    setRepeatComplete(false);
    if (isLastPrompt) {
      await finalizeSession();
      return;
    }
    setCurrentIndex((prev) => prev + 1);
  }, [currentSentence, finalizeSession, isLastPrompt, session]);

  const nextPrompt = useCallback(async () => {
    if (!session) return;
    await advanceAfterPrompt();
  }, [advanceAfterPrompt, session]);

  const redoPrompt = useCallback(() => {
    if (!currentSentence || !currentGrade) return;

    const nextRecords = [...turnRecordsRef.current];
    for (let i = nextRecords.length - 1; i >= 0; i--) {
      if (nextRecords[i].sentenceId === currentSentence.id) {
        nextRecords.splice(i, 1);
        break;
      }
    }
    turnRecordsRef.current = nextRecords;

    const nextIssueCounts = { ...issueCountsRef.current };
    for (const [issueType, count] of Object.entries(currentGrade.issueTypeCounts || {})) {
      nextIssueCounts[issueType] = Math.max(0, (nextIssueCounts[issueType] || 0) - count);
    }
    issueCountsRef.current = nextIssueCounts;

    stopAiSpeech();
    setError('');
    setCurrentTranscript('');
    setCurrentGrade(null);
    setRepeatTarget('');
    setRepeatTranscript('');
    setRepeatComplete(false);
  }, [currentGrade, currentSentence]);

  return {
    loading,
    error,
    session,
    summary,
    currentSentence,
    currentIndex,
    totalPrompts: session?.sentences.length || 0,
    currentTranscript,
    currentGrade,
    repeatTarget,
    repeatTranscript,
    repeatComplete,
    isRepeatStage,
    listening,
    grading,
    committing,
    audioPeaks,
    connectionState,
    feedbackLanguageMode,
    counts,
    startListening,
    stopListening,
    submitTypedAnswer: gradeTranscript,
    skipPrompt,
    nextPrompt,
    redoPrompt,
    canRedoCurrentPrompt: shouldOfferRedo(currentGrade, currentTranscript),
    formatDuration,
  };
}
