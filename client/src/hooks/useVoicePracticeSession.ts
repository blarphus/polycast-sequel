import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  completeVoicePracticeSession,
  createVoicePracticeSession,
  createVoiceRealtimeToken,
  gradeVoicePracticeTurn,
  type FeedbackLanguageMode,
  type VoiceGradeResult,
  type VoicePracticeSentence,
  type VoicePracticeSummary,
  type VoicePracticeSession,
} from '../api/voicePractice';

type ConnectionState = 'idle' | 'connecting' | 'ready' | 'error';

interface TurnRecord {
  sentenceId: string;
  result: 'correct' | 'partial' | 'incorrect' | 'skipped';
}

function getEphemeralToken(payload: Record<string, any>) {
  return payload?.client_secret?.value || payload?.client_secret || payload?.ephemeral_key || null;
}

function parseTranscriptEvent(event: any) {
  if (event?.type !== 'conversation.item.input_audio_transcription.completed') {
    return null;
  }
  if (typeof event.transcript === 'string') {
    return event.transcript;
  }
  const itemContent = event.item?.content;
  if (Array.isArray(itemContent)) {
    const transcriptPart = itemContent.find((part: any) => typeof part?.transcript === 'string');
    return transcriptPart?.transcript || null;
  }
  return null;
}

function parseToolCall(event: any) {
  if (event?.type === 'response.function_call_arguments.done') {
    return {
      name: event.name,
      arguments: event.arguments || '{}',
      callId: event.call_id,
    };
  }
  const item = event?.item;
  if (event?.type === 'response.output_item.done' && item?.type === 'function_call') {
    return {
      name: item.name,
      arguments: item.arguments || '{}',
      callId: item.call_id,
    };
  }
  return null;
}

function formatDuration(seconds: number) {
  const mins = Math.floor(seconds / 60);
  const secs = seconds % 60;
  return mins > 0 ? `${mins}m ${secs}s` : `${secs}s`;
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
  const [summary, setSummary] = useState<VoicePracticeSummary | null>(null);

  const audioRef = useRef<HTMLAudioElement | null>(null);
  const peerConnectionRef = useRef<RTCPeerConnection | null>(null);
  const dataChannelRef = useRef<RTCDataChannel | null>(null);
  const localStreamRef = useRef<MediaStream | null>(null);
  const localTrackRef = useRef<MediaStreamTrack | null>(null);
  const introPlayedRef = useRef(false);
  const turnRecordsRef = useRef<TurnRecord[]>([]);
  const issueCountsRef = useRef<Record<string, number>>({});
  const sessionStartRef = useRef<number>(Date.now());
  const gradingInFlightRef = useRef(false);

  const currentSentence = session?.sentences[currentIndex] || null;
  const isLastPrompt = session ? currentIndex >= session.sentences.length - 1 : false;

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

  const sendRealtimeEvent = useCallback((payload: Record<string, unknown>) => {
    const channel = dataChannelRef.current;
    if (!channel || channel.readyState !== 'open') return;
    channel.send(JSON.stringify(payload));
  }, []);

  const speakMessage = useCallback((text: string) => {
    if (!text.trim()) return;
    sendRealtimeEvent({
      type: 'response.create',
      response: {
        modalities: ['audio'],
        instructions: `Say this exactly, naturally, and concisely: ${text}`,
      },
    });
  }, [sendRealtimeEvent]);

  const applyToolCall = useCallback((toolCall: { name: string; arguments: string; callId?: string }) => {
    if (toolCall.name !== 'set_feedback_language') return;
    let mode: FeedbackLanguageMode = 'native';
    try {
      const parsed = JSON.parse(toolCall.arguments || '{}');
      if (parsed.mode === 'target') {
        mode = 'target';
      }
    } catch {
      mode = 'native';
    }
    setFeedbackLanguageMode(mode);
    if (toolCall.callId) {
      sendRealtimeEvent({
        type: 'conversation.item.create',
        item: {
          type: 'function_call_output',
          call_id: toolCall.callId,
          output: JSON.stringify({ ok: true, mode }),
        },
      });
      sendRealtimeEvent({
        type: 'response.create',
        response: {
          modalities: ['audio'],
          instructions: mode === 'target'
            ? 'Confirm briefly that you will now speak in the target language.'
            : 'Confirm briefly that you will now speak in the native language.',
        },
      });
    }
  }, [sendRealtimeEvent]);

  const finishTurn = useCallback(async (transcript: string) => {
    if (!session || !currentSentence || gradingInFlightRef.current || currentGrade) return;
    const normalized = transcript.trim();
    if (!normalized) return;
    gradingInFlightRef.current = true;
    setGrading(true);
    setCurrentTranscript(normalized);
    setListening(false);
    if (localTrackRef.current) {
      localTrackRef.current.enabled = false;
    }
    try {
      const result = await gradeVoicePracticeTurn(session.sessionId, {
        sentenceId: currentSentence.id,
        userTranscript: normalized,
        feedbackLanguageMode,
      });
      setCurrentGrade(result);
      turnRecordsRef.current = [
        ...turnRecordsRef.current,
        { sentenceId: currentSentence.id, result: result.result },
      ];
      const nextIssueCounts = { ...issueCountsRef.current };
      for (const [issueType, count] of Object.entries(result.issueTypeCounts || {})) {
        nextIssueCounts[issueType] = (nextIssueCounts[issueType] || 0) + count;
      }
      issueCountsRef.current = nextIssueCounts;
      speakMessage(result.spokenFeedback);
    } catch (err: any) {
      setError(err.message || 'Failed to grade spoken answer');
    } finally {
      gradingInFlightRef.current = false;
      setGrading(false);
    }
  }, [currentGrade, currentSentence, feedbackLanguageMode, session, speakMessage]);

  const initializeRealtime = useCallback(async (voiceSession: VoicePracticeSession) => {
    setConnectionState('connecting');
    const tokenPayload = await createVoiceRealtimeToken({
      nativeLanguage: voiceSession.nativeLanguage,
      targetLanguage: voiceSession.targetLanguage,
      feedbackLanguageMode: voiceSession.feedbackLanguageMode,
    });
    const ephemeralToken = getEphemeralToken(tokenPayload as Record<string, any>);
    if (!ephemeralToken) {
      throw new Error('OpenAI realtime token was missing from the server response');
    }

    const audio = document.createElement('audio');
    audio.autoplay = true;
    audioRef.current = audio;

    const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
    localStreamRef.current = stream;
    const track = stream.getAudioTracks()[0];
    if (!track) {
      throw new Error('No microphone track available');
    }
    track.enabled = false;
    localTrackRef.current = track;

    const pc = new RTCPeerConnection();
    peerConnectionRef.current = pc;
    pc.onconnectionstatechange = () => {
      if (pc.connectionState === 'connected') setConnectionState('ready');
      if (pc.connectionState === 'failed' || pc.connectionState === 'disconnected') {
        setConnectionState('error');
      }
    };
    pc.ontrack = (event) => {
      audio.srcObject = event.streams[0];
    };

    stream.getTracks().forEach((mediaTrack) => pc.addTrack(mediaTrack, stream));

    const dataChannel = pc.createDataChannel('oai-events');
    dataChannelRef.current = dataChannel;
    dataChannel.onmessage = (message) => {
      try {
        const event = JSON.parse(message.data);
        const transcript = parseTranscriptEvent(event);
        if (transcript) {
          finishTurn(transcript);
          return;
        }
        const toolCall = parseToolCall(event);
        if (toolCall) {
          applyToolCall(toolCall);
          return;
        }
        if (event?.type === 'error') {
          setError(event.error?.message || 'OpenAI realtime error');
          setConnectionState('error');
        }
      } catch (err) {
        console.error('Failed to parse realtime event:', err);
      }
    };
    dataChannel.onopen = () => {
      setConnectionState('ready');
      if (!introPlayedRef.current) {
        introPlayedRef.current = true;
        speakMessage(
          'In the learner’s native language, give a very short welcome and remind them once that they should translate into the target language, that if they do not know a word they can say that word in their native language and do their best, and that they can ask you to speak in either language.'
        );
      }
    };

    const offer = await pc.createOffer();
    await pc.setLocalDescription(offer);

    const response = await fetch(`https://api.openai.com/v1/realtime?model=gpt-realtime`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${ephemeralToken}`,
        'Content-Type': 'application/sdp',
      },
      body: offer.sdp,
    });

    if (!response.ok) {
      const body = await response.text().catch(() => '');
      throw new Error(body || 'Failed to establish OpenAI realtime session');
    }

    const answerSdp = await response.text();
    await pc.setRemoteDescription({ type: 'answer', sdp: answerSdp });
  }, [applyToolCall, finishTurn, speakMessage]);

  useEffect(() => {
    let cancelled = false;

    async function init() {
      setLoading(true);
      setError('');
      try {
        const voiceSession = await createVoicePracticeSession(10, 'native');
        if (cancelled) return;
        setSession(voiceSession);
        setFeedbackLanguageMode(voiceSession.feedbackLanguageMode);
        setCurrentIndex(voiceSession.initialPromptIndex || 0);
        await initializeRealtime(voiceSession);
      } catch (err: any) {
        if (!cancelled) {
          setError(err.message || 'Failed to start voice practice');
          setConnectionState('error');
        }
      } finally {
        if (!cancelled) {
          setLoading(false);
        }
      }
    }

    init();

    return () => {
      cancelled = true;
      dataChannelRef.current?.close();
      peerConnectionRef.current?.close();
      localStreamRef.current?.getTracks().forEach((track) => track.stop());
      audioRef.current?.remove();
    };
  }, [initializeRealtime]);

  const startListening = useCallback(() => {
    if (!currentSentence || !session || connectionState !== 'ready' || grading) return;
    setError('');
    setCurrentTranscript('');
    setCurrentGrade(null);
    setListening(true);
    if (localTrackRef.current) {
      localTrackRef.current.enabled = true;
    }
    sendRealtimeEvent({ type: 'input_audio_buffer.clear' });
  }, [connectionState, currentSentence, grading, sendRealtimeEvent, session]);

  const stopListening = useCallback(() => {
    setListening(false);
    if (localTrackRef.current) {
      localTrackRef.current.enabled = false;
    }
  }, []);

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

  const skipPrompt = useCallback(async () => {
    if (!currentSentence || !session) return;
    turnRecordsRef.current = [
      ...turnRecordsRef.current,
      { sentenceId: currentSentence.id, result: 'skipped' },
    ];
    setCurrentTranscript('');
    setCurrentGrade(null);
    if (isLastPrompt) {
      await finalizeSession();
      return;
    }
    setCurrentIndex((prev) => prev + 1);
  }, [currentSentence, finalizeSession, isLastPrompt, session]);

  const nextPrompt = useCallback(async () => {
    if (!session) return;
    if (isLastPrompt) {
      await finalizeSession();
      return;
    }
    setCurrentIndex((prev) => prev + 1);
    setCurrentTranscript('');
    setCurrentGrade(null);
  }, [finalizeSession, isLastPrompt, session]);

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
    listening,
    grading,
    connectionState,
    feedbackLanguageMode,
    counts,
    startListening,
    stopListening,
    skipPrompt,
    nextPrompt,
    formatDuration,
  };
}
