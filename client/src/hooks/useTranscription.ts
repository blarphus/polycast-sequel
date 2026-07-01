// ---------------------------------------------------------------------------
// hooks/useTranscription.ts -- Shared media acquisition + transcription setup
// ---------------------------------------------------------------------------

import { useEffect, useRef, useState, useCallback } from 'react';
import { socket } from '../socket';
import { useAuth } from './useAuth';
import { useTranscriptEntries } from './useTranscriptEntries';
import { TranscriptionService } from '../transcription';
import type { TranscriptEntry } from '../components/TranscriptPanel';

export interface UseTranscriptionResult {
  streamRef: React.MutableRefObject<MediaStream | null>;
  videoRef: React.RefObject<HTMLVideoElement>;
  localText: string;
  remoteText: string;
  remoteLang: string;
  transcriptEntries: TranscriptEntry[];
  cleanupTranscription: () => void;
  setMicMuted: (muted: boolean) => void;
  streamReady: boolean;
}

export function useTranscription(
  peerId: string,
  externalStreamRef?: React.MutableRefObject<MediaStream | null>,
  externalStreamReady?: boolean,
): UseTranscriptionResult {
  const { user } = useAuth();

  const videoRef = useRef<HTMLVideoElement>(null);
  const ownedStreamRef = useRef<MediaStream | null>(null);
  const streamRef = externalStreamRef ?? ownedStreamRef;
  const ownsStream = !externalStreamRef;
  const transcriptionRef = useRef<TranscriptionService | null>(null);

  const [localText, setLocalText] = useState('');
  const [remoteText, setRemoteText] = useState('');
  const [remoteLang, setRemoteLang] = useState('');
  const [streamReady, setStreamReady] = useState(false);

  const { transcriptEntries, onTranscriptEntry } = useTranscriptEntries(user?.native_language);

  const cleanupTranscription = useCallback(() => {
    if (transcriptionRef.current) {
      transcriptionRef.current.stop();
      transcriptionRef.current = null;
    }
    if (ownsStream && ownedStreamRef.current) {
      ownedStreamRef.current.getTracks().forEach((t) => t.stop());
      ownedStreamRef.current = null;
    }
  }, [ownsStream]);

  useEffect(() => {
    let cleaned = false;

    const onTranscript = (data: { text: string; lang: string; userId: string }) => {
      if (data.userId === user?.id) {
        setLocalText(data.text);
      } else {
        setRemoteText(data.text);
        setRemoteLang(data.lang);
      }
    };

    socket.on('transcript', onTranscript);
    socket.on('transcript:entry', onTranscriptEntry);

    async function setup() {
      try {
        let stream = streamRef.current;
        if (!stream && ownsStream) {
          stream = await navigator.mediaDevices.getUserMedia({
            video: true,
            audio: true,
          });
          ownedStreamRef.current = stream;
        }

        if (!stream) return;

        if (cleaned) {
          if (ownsStream) stream.getTracks().forEach((t) => t.stop());
          return;
        }

        if (videoRef.current) {
          videoRef.current.srcObject = stream;
        }

        const ts = new TranscriptionService(peerId);
        transcriptionRef.current = ts;
        ts.start(stream);

        setStreamReady(true);
      } catch (err) {
        console.error('[useTranscription] Setup error:', err);
      }
    }

    setup();

    return () => {
      cleaned = true;
      socket.off('transcript', onTranscript);
      socket.off('transcript:entry', onTranscriptEntry);
      cleanupTranscription();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [peerId, externalStreamReady]);

  const setMicMuted = useCallback((muted: boolean) => {
    transcriptionRef.current?.setMuted(muted);
  }, []);

  return {
    streamRef,
    videoRef,
    localText,
    remoteText,
    remoteLang,
    transcriptEntries,
    cleanupTranscription,
    setMicMuted,
    streamReady: externalStreamRef ? !!externalStreamReady : streamReady,
  };
}
