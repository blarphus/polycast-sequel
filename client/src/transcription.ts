// ---------------------------------------------------------------------------
// transcription.ts -- Voxtral realtime transcription via Socket.IO relay
// NO FALLBACKS. Voxtral only. If it breaks, it breaks visibly.
// ---------------------------------------------------------------------------

import { socket } from './socket';
import { logRuntimeDiagnostic } from './utils/runtimeDiagnostics';

function logAudioContextFailure(operation: string, error: unknown) {
  logRuntimeDiagnostic({
    code: 'transcription_audio_context_failed',
    severity: 'error',
    source: 'web.transcription',
    operation,
    message: 'The call transcription audio pipeline could not change state.',
    detail: error,
    visible: true,
  });
}

/**
 * Captures PCM audio from a MediaStream and streams it to the server
 * via Socket.IO. The server relays audio to the Voxtral realtime API
 * and emits `transcript` events back to both peers.
 */
export class TranscriptionService {
  private peerId: string;
  private audioContext: AudioContext | null = null;
  private sourceNode: MediaStreamAudioSourceNode | null = null;
  private processorNode: ScriptProcessorNode | null = null;
  private running = false;

  constructor(peerId: string) {
    this.peerId = peerId;
  }

  /**
   * Start transcription. Accepts the call's existing MediaStream,
   * captures raw PCM 16-bit 16 kHz mono, and sends chunks to the server.
   */
  start(stream: MediaStream): void {
    if (this.running) {
      logRuntimeDiagnostic({
        code: 'transcription_duplicate_start_ignored',
        severity: 'warning',
        source: 'web.transcription',
        operation: 'start',
        message: 'A duplicate transcription start was ignored to prevent two audio pipelines.',
        detail: `peerId=${this.peerId}`,
        visible: true,
      });
      return;
    }
    this.running = true;

    // Tell the server to open a Voxtral WebSocket
    socket.emit('transcription:start', { peerId: this.peerId });

    // Create AudioContext at 16 kHz for native PCM capture
    this.audioContext = new AudioContext({ sampleRate: 16000 });

    // iOS Safari starts AudioContext in 'suspended' state — resume it so
    // onaudioprocess events actually fire.
    if (this.audioContext.state === 'suspended') {
      this.audioContext.resume().catch((error) => logAudioContextFailure('resume-on-start', error));
    }

    this.sourceNode = this.audioContext.createMediaStreamSource(stream);

    // 4096 samples at 16 kHz ≈ 256 ms per chunk
    this.processorNode = this.audioContext.createScriptProcessor(4096, 1, 1);

    this.processorNode.onaudioprocess = (e: AudioProcessingEvent) => {
      if (!this.running) return;
      const float32 = e.inputBuffer.getChannelData(0);
      const base64 = float32ToPcm16Base64(float32);
      socket.emit('transcription:audio', base64);
    };

    this.sourceNode.connect(this.processorNode);

    // ScriptProcessorNode must be connected to destination to fire events.
    // Route through a zero-gain node to avoid audible playback of the mic.
    const muteNode = this.audioContext.createGain();
    muteNode.gain.value = 0;
    this.processorNode.connect(muteNode);
    muteNode.connect(this.audioContext.destination);

  }

  /**
   * Mute/unmute the mic feed into the transcription pipeline. Suspending the
   * AudioContext halts capture at the graph level — a disabled MediaStreamTrack
   * would still push (silent) samples through, i.e. still "receive" audio.
   */
  setMuted(muted: boolean): void {
    if (!this.audioContext) return;
    if (muted && this.audioContext.state === 'running') {
      this.audioContext.suspend().catch((error) => logAudioContextFailure('suspend-for-mute', error));
    } else if (!muted && this.audioContext.state === 'suspended') {
      this.audioContext.resume().catch((error) => logAudioContextFailure('resume-after-mute', error));
    }
  }

  /** Stop transcription and release audio resources. */
  stop(): void {
    this.running = false;
    socket.emit('transcription:stop');

    if (this.processorNode) {
      this.processorNode.disconnect();
      this.processorNode = null;
    }
    if (this.sourceNode) {
      this.sourceNode.disconnect();
      this.sourceNode = null;
    }
    if (this.audioContext) {
      this.audioContext.close().catch((error) => logAudioContextFailure('close', error));
      this.audioContext = null;
    }
  }
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Convert Float32 PCM samples (–1…1) to Int16 and encode as Base64. */
function float32ToPcm16Base64(float32: Float32Array): string {
  const int16 = new Int16Array(float32.length);
  for (let i = 0; i < float32.length; i++) {
    const s = Math.max(-1, Math.min(1, float32[i]));
    int16[i] = s < 0 ? s * 0x8000 : s * 0x7fff;
  }

  const bytes = new Uint8Array(int16.buffer);
  let binary = '';
  for (let i = 0; i < bytes.byteLength; i++) {
    binary += String.fromCharCode(bytes[i]);
  }
  return btoa(binary);
}
