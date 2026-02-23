// ---------------------------------------------------------------------------
// transcription.ts -- Web Speech API wrapper with Whisper (/api/transcribe) fallback
// ---------------------------------------------------------------------------

import { transcribe } from './api';

export interface TranscriptPayload {
  text: string;
  lang: string;
}

type TranscriptCallback = (payload: TranscriptPayload) => void;

// Web Speech API types (not in all TS libs)
interface SpeechRecognitionInstance {
  lang: string;
  continuous: boolean;
  interimResults: boolean;
  maxAlternatives: number;
  onresult: ((event: any) => void) | null;
  onerror: ((event: any) => void) | null;
  onend: (() => void) | null;
  start(): void;
  stop(): void;
  abort(): void;
}

interface SpeechWindow extends Window {
  SpeechRecognition?: new () => SpeechRecognitionInstance;
  webkitSpeechRecognition?: new () => SpeechRecognitionInstance;
}

export class TranscriptionService {
  private onTranscript: TranscriptCallback;
  private lang: string;
  private recognition: SpeechRecognitionInstance | null = null;
  private recorder: MediaRecorder | null = null;
  private recordingStream: MediaStream | null = null;
  private running = false;
  private shouldRestart = false;
  private recordingInterval: ReturnType<typeof setInterval> | null = null;

  constructor(onTranscript: TranscriptCallback, preferredLang = 'en-US') {
    this.onTranscript = onTranscript;
    this.lang = preferredLang;
  }

  // ---- Public API --------------------------------------------------------

  /**
   * Start transcription.  Prefers Web Speech API; falls back to
   * MediaRecorder + server-side Whisper.
   */
  start(): void {
    if (this.running) return;
    this.running = true;
    this.shouldRestart = true;

    if (TranscriptionService.isSupported()) {
      this.startWebSpeech();
    } else {
      this.startMediaRecorderFallback();
    }
  }

  stop(): void {
    this.running = false;
    this.shouldRestart = false;
    this.stopWebSpeech();
    this.stopMediaRecorder();
  }

  setLanguage(lang: string): void {
    this.lang = lang;
    // Restart recognition with new language if already running
    if (this.running) {
      this.stop();
      this.start();
    }
  }

  static isSupported(): boolean {
    const w = window as unknown as SpeechWindow;
    return !!(w.SpeechRecognition || w.webkitSpeechRecognition);
  }

  // ---- Web Speech API ----------------------------------------------------

  private startWebSpeech(): void {
    const w = window as unknown as SpeechWindow;
    const SpeechCtor = w.SpeechRecognition || w.webkitSpeechRecognition;
    if (!SpeechCtor) return;

    const recognition = new SpeechCtor();
    recognition.lang = this.lang;
    recognition.continuous = true;
    recognition.interimResults = true;
    recognition.maxAlternatives = 1;

    recognition.onresult = (event: any) => {
      for (let i = event.resultIndex; i < event.results.length; i++) {
        const result = event.results[i];
        if (result.isFinal) {
          const text = result[0].transcript.trim();
          if (text) {
            this.onTranscript({ text, lang: this.lang });
          }
        }
      }
    };

    recognition.onerror = (event: any) => {
      console.warn('[transcription] Web Speech error:', event.error);
      // "no-speech" and "aborted" are non-fatal
      if (event.error === 'not-allowed' || event.error === 'service-not-allowed') {
        console.error('[transcription] Microphone or speech service not allowed.');
        this.stop();
      }
    };

    // Web Speech API stops periodically; auto-restart
    recognition.onend = () => {
      if (this.shouldRestart && this.running) {
        try {
          recognition.start();
        } catch {
          // already started, ignore
        }
      }
    };

    try {
      recognition.start();
    } catch {
      // ignore if already started
    }

    this.recognition = recognition;
  }

  private stopWebSpeech(): void {
    if (this.recognition) {
      try {
        this.recognition.stop();
      } catch {
        // already stopped
      }
      this.recognition = null;
    }
  }

  // ---- MediaRecorder + Whisper fallback ----------------------------------

  private async startMediaRecorderFallback(): Promise<void> {
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      this.recordingStream = stream;
      this.recordChunk(stream);

      // Record in 5-second chunks
      this.recordingInterval = setInterval(() => {
        if (this.running) {
          this.recordChunk(stream);
        }
      }, 5000);
    } catch (err) {
      console.error('[transcription] Could not get audio stream for fallback:', err);
    }
  }

  private recordChunk(stream: MediaStream): void {
    const chunks: Blob[] = [];
    const recorder = new MediaRecorder(stream, { mimeType: 'audio/webm;codecs=opus' });
    this.recorder = recorder;

    recorder.ondataavailable = (e) => {
      if (e.data.size > 0) chunks.push(e.data);
    };

    recorder.onstop = async () => {
      if (chunks.length === 0) return;
      const blob = new Blob(chunks, { type: 'audio/webm' });
      try {
        const result = await transcribe(blob);
        if (result.text.trim()) {
          this.onTranscript({ text: result.text, lang: result.lang || this.lang });
        }
      } catch (err) {
        console.warn('[transcription] Whisper fallback error:', err);
      }
    };

    recorder.start();

    // Stop after ~4.8s so the interval has time to start the next chunk
    setTimeout(() => {
      if (recorder.state === 'recording') {
        recorder.stop();
      }
    }, 4800);
  }

  private stopMediaRecorder(): void {
    if (this.recordingInterval) {
      clearInterval(this.recordingInterval);
      this.recordingInterval = null;
    }
    if (this.recorder && this.recorder.state === 'recording') {
      this.recorder.stop();
    }
    this.recorder = null;

    if (this.recordingStream) {
      this.recordingStream.getTracks().forEach((t) => t.stop());
      this.recordingStream = null;
    }
  }
}
