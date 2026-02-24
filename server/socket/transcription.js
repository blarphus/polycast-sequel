import WebSocket from 'ws';
import { userToSocket } from './presence.js';

const VOXTRAL_URL =
  'wss://api.mistral.ai/v1/audio/transcriptions/realtime?model=voxtral-mini-transcribe-realtime-2602';

/**
 * Register realtime transcription event handlers on a socket.
 * Maintains a Voxtral WebSocket per active transcription session and relays
 * accumulated text back to the originating client AND to their call peer.
 */
export function handleTranscription(io, socket) {
  let voxtralWs = null;
  let peerId = null;
  let transcriptBuffer = '';
  let detectedLang = 'en';
  let clearTimer = null;
  let audioChunkCount = 0;

  function emitTranscript(text) {
    const transcriptData = {
      text,
      lang: detectedLang,
      userId: socket.userId,
    };

    // Send to the originating client
    socket.emit('transcript', transcriptData);

    // Send to peer
    const peerSocketId = userToSocket.get(peerId);
    if (peerSocketId) {
      io.to(peerSocketId).emit('transcript', transcriptData);
    }

    // Auto-clear after 4s of silence so stale text doesn't linger
    if (clearTimer) clearTimeout(clearTimer);
    clearTimer = setTimeout(() => {
      console.log(`[transcription] Clearing stale buffer for user ${socket.userId}`);
      transcriptBuffer = '';
      emitTranscript('');
    }, 4000);
  }

  function cleanup() {
    if (clearTimer) {
      clearTimeout(clearTimer);
      clearTimer = null;
    }
    if (voxtralWs) {
      try {
        voxtralWs.close();
      } catch {
        // already closed
      }
      voxtralWs = null;
    }
    peerId = null;
    transcriptBuffer = '';
    audioChunkCount = 0;
  }

  /**
   * transcription:start — open a Voxtral WebSocket session.
   * Payload: { peerId }
   */
  socket.on('transcription:start', (data) => {
    console.log(`[transcription] transcription:start from user ${socket.userId}, peerId=${data.peerId}`);

    // Close any existing session first
    cleanup();

    const apiKey = process.env.MISTRAL_API_KEY;
    if (!apiKey) {
      console.error('[transcription] MISTRAL_API_KEY not set — cannot start Voxtral');
      socket.emit('transcription:error', {
        message: 'Transcription service not configured',
      });
      return;
    }

    peerId = data.peerId;
    console.log(`[transcription] Opening Voxtral WebSocket for user ${socket.userId}...`);

    voxtralWs = new WebSocket(VOXTRAL_URL, {
      headers: {
        Authorization: `Bearer ${apiKey}`,
      },
    });

    voxtralWs.on('open', () => {
      console.log(`[transcription] Voxtral WS opened for user ${socket.userId}`);

      // Configure audio format
      const config = {
        type: 'session.update',
        session: {
          audio_format: {
            encoding: 'pcm_s16le',
            sample_rate: 16000,
          },
        },
      };
      console.log(`[transcription] Sending session.update:`, JSON.stringify(config));
      voxtralWs.send(JSON.stringify(config));
    });

    voxtralWs.on('message', (raw) => {
      try {
        const msg = JSON.parse(raw.toString());
        console.log(`[transcription] Voxtral message for user ${socket.userId}: type=${msg.type}`, msg.type === 'transcription.text.delta' ? `text="${msg.text}"` : '');

        if (msg.type === 'transcription.text.delta') {
          const delta = msg.text || '';
          transcriptBuffer += delta;
          console.log(`[transcription] Buffer for user ${socket.userId}: "${transcriptBuffer}"`);
          emitTranscript(transcriptBuffer);
        } else if (msg.type === 'transcription.language') {
          if (msg.language) {
            detectedLang = msg.language;
            console.log(`[transcription] Language detected for user ${socket.userId}: ${detectedLang}`);
          }
        } else if (msg.type === 'transcription.segment') {
          // Segment boundary — clear buffer for next sentence
          console.log(`[transcription] Segment boundary for user ${socket.userId}, clearing buffer`);
          transcriptBuffer = '';
        } else if (msg.type === 'transcription.done') {
          console.log(`[transcription] Transcription done for user ${socket.userId}`);
          transcriptBuffer = '';
        } else if (msg.type === 'error') {
          console.error(`[transcription] Voxtral error for user ${socket.userId}:`, JSON.stringify(msg));
        } else if (msg.type === 'session.created') {
          console.log(`[transcription] Session created for user ${socket.userId}:`, JSON.stringify(msg));
        } else if (msg.type === 'session.updated') {
          console.log(`[transcription] Session updated for user ${socket.userId}:`, JSON.stringify(msg));
        } else {
          console.log(`[transcription] Unhandled Voxtral message type for user ${socket.userId}: ${msg.type}`, JSON.stringify(msg));
        }
      } catch (err) {
        console.error(`[transcription] Error parsing Voxtral message for user ${socket.userId}:`, err, raw.toString());
      }
    });

    voxtralWs.on('error', (err) => {
      console.error(`[transcription] Voxtral WS error for user ${socket.userId}:`, err.message);
    });

    voxtralWs.on('close', (code, reason) => {
      console.log(`[transcription] Voxtral WS closed for user ${socket.userId}, code=${code}, reason=${reason}`);
      voxtralWs = null;
    });
  });

  /**
   * transcription:audio — receive Base64-encoded PCM chunk from client,
   * forward to Voxtral as an input_audio.append message.
   */
  socket.on('transcription:audio', (base64Chunk) => {
    audioChunkCount++;
    if (audioChunkCount <= 3 || audioChunkCount % 50 === 0) {
      console.log(`[transcription] Audio chunk #${audioChunkCount} from user ${socket.userId}, size=${base64Chunk.length} chars, wsReady=${voxtralWs?.readyState === WebSocket.OPEN}`);
    }

    if (voxtralWs && voxtralWs.readyState === WebSocket.OPEN) {
      voxtralWs.send(
        JSON.stringify({
          type: 'input_audio.append',
          audio: base64Chunk,
        }),
      );
    } else {
      if (audioChunkCount <= 5) {
        console.warn(`[transcription] Cannot send audio chunk #${audioChunkCount} for user ${socket.userId}: WS not open (state=${voxtralWs?.readyState})`);
      }
    }
  });

  /**
   * transcription:stop — gracefully close the Voxtral WebSocket.
   */
  socket.on('transcription:stop', () => {
    console.log(`[transcription] transcription:stop from user ${socket.userId}`);
    if (voxtralWs && voxtralWs.readyState === WebSocket.OPEN) {
      voxtralWs.send(JSON.stringify({ type: 'input_audio.end' }));
    }
    cleanup();
  });

  // Clean up on disconnect
  socket.on('disconnect', () => {
    console.log(`[transcription] Socket disconnect for user ${socket.userId}, cleaning up Voxtral WS`);
    cleanup();
  });
}
