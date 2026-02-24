// ---------------------------------------------------------------------------
// transcription.ts -- Voxtral realtime transcription via Socket.IO relay
// NO FALLBACKS. Voxtral only. If it breaks, it breaks visibly.
// ---------------------------------------------------------------------------

import { socket } from './socket';

export interface TranscriptPayload {
  text: string;
  lang: string;
  userId: number;
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
  private chunkCount = 0;

  constructor(peerId: string) {
    this.peerId = peerId;
    console.log('[transcription] TranscriptionService created, peerId=', peerId);
  }

  /**
   * Start transcription. Accepts the call's existing MediaStream,
   * captures raw PCM 16-bit 16 kHz mono, and sends chunks to the server.
   */
  start(stream: MediaStream): void {
    if (this.running) {
      console.warn('[transcription] Already running, ignoring start()');
      return;
    }
    this.running = true;
    this.chunkCount = 0;

    console.log('[transcription] Starting Voxtral transcription for peerId=', this.peerId);
    console.log('[transcription] Stream tracks:', stream.getTracks().map(t => `${t.kind}:${t.label}:${t.readyState}`));

    // Tell the server to open a Voxtral WebSocket
    socket.emit('transcription:start', { peerId: this.peerId });
    console.log('[transcription] Emitted transcription:start');

    // Create AudioContext at 16 kHz for native PCM capture
    this.audioContext = new AudioContext({ sampleRate: 16000 });
    console.log('[transcription] AudioContext created, sampleRate=', this.audioContext.sampleRate);

    this.sourceNode = this.audioContext.createMediaStreamSource(stream);

    // 4096 samples at 16 kHz ≈ 256 ms per chunk
    this.processorNode = this.audioContext.createScriptProcessor(4096, 1, 1);

    this.processorNode.onaudioprocess = (e: AudioProcessingEvent) => {
      if (!this.running) return;
      this.chunkCount++;
      const float32 = e.inputBuffer.getChannelData(0);
      const base64 = float32ToPcm16Base64(float32);

      if (this.chunkCount <= 3 || this.chunkCount % 50 === 0) {
        console.log(`[transcription] Sending audio chunk #${this.chunkCount}, base64 size=${base64.length}`);
      }

      socket.emit('transcription:audio', base64);
    };

    this.sourceNode.connect(this.processorNode);

    // ScriptProcessorNode must be connected to destination to fire events.
    // Route through a zero-gain node to avoid audible playback of the mic.
    const muteNode = this.audioContext.createGain();
    muteNode.gain.value = 0;
    this.processorNode.connect(muteNode);
    muteNode.connect(this.audioContext.destination);

    console.log('[transcription] Audio pipeline connected, streaming to server');
  }

  /** Stop transcription and release audio resources. */
  stop(): void {
    console.log(`[transcription] Stopping transcription (sent ${this.chunkCount} chunks)`);
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
      this.audioContext.close().catch(() => {});
      this.audioContext = null;
    }
    console.log('[transcription] Stopped and cleaned up');
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
