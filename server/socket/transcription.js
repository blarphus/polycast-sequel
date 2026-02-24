import WebSocket from 'ws';
import { userToSocket } from './presence.js';

const VOXTRAL_URL =
  'wss://api.mistral.ai/v1/audio/transcriptions/realtime?model=voxtral-mini-transcribe-realtime-2602';

/**
 * Register realtime transcription event handlers on a socket.
 * Maintains a Voxtral WebSocket per active transcription session and relays
 * text deltas back to the originating client AND to their call peer.
 */
export function handleTranscription(io, socket) {
  let voxtralWs = null;
  let peerId = null;

  function cleanup() {
    if (voxtralWs) {
      try {
        voxtralWs.close();
      } catch {
        // already closed
      }
      voxtralWs = null;
    }
    peerId = null;
  }

  /**
   * transcription:start — open a Voxtral WebSocket session.
   * Payload: { peerId }
   */
  socket.on('transcription:start', (data) => {
    // Close any existing session first
    cleanup();

    const apiKey = process.env.MISTRAL_API_KEY;
    if (!apiKey) {
      console.error('[transcription] MISTRAL_API_KEY not set');
      socket.emit('transcription:error', {
        message: 'Transcription service not configured',
      });
      return;
    }

    peerId = data.peerId;

    voxtralWs = new WebSocket(VOXTRAL_URL, {
      headers: {
        Authorization: `Bearer ${apiKey}`,
      },
    });

    voxtralWs.on('open', () => {
      console.log(
        `[transcription] Voxtral WS opened for user ${socket.userId}`,
      );

      // Configure audio format
      voxtralWs.send(
        JSON.stringify({
          type: 'session.update',
          session: {
            audio_format: {
              encoding: 'pcm_s16le',
              sample_rate: 16000,
            },
          },
        }),
      );
    });

    voxtralWs.on('message', (raw) => {
      try {
        const msg = JSON.parse(raw.toString());

        if (msg.type === 'transcription.text.delta') {
          const transcriptData = {
            text: msg.text || '',
            lang: 'en',
            userId: socket.userId,
          };

          // Send to the originating client
          socket.emit('transcript', transcriptData);

          // Send to peer
          const peerSocketId = userToSocket.get(peerId);
          if (peerSocketId) {
            io.to(peerSocketId).emit('transcript', transcriptData);
          }
        } else if (msg.type === 'transcription.language') {
          // Store detected language for future deltas if provided
          // The language info can be relayed as-is
          if (msg.language) {
            const langData = {
              text: '',
              lang: msg.language,
              userId: socket.userId,
            };
            socket.emit('transcript:lang', langData);
            const peerSocketId = userToSocket.get(peerId);
            if (peerSocketId) {
              io.to(peerSocketId).emit('transcript:lang', langData);
            }
          }
        } else if (msg.type === 'error') {
          console.error(
            '[transcription] Voxtral error:',
            msg.error || msg.message || msg,
          );
        } else if (
          msg.type === 'session.created' ||
          msg.type === 'session.updated'
        ) {
          console.log(`[transcription] ${msg.type} for user ${socket.userId}`);
        }
      } catch (err) {
        console.warn('[transcription] Error parsing Voxtral message:', err);
      }
    });

    voxtralWs.on('error', (err) => {
      console.error('[transcription] Voxtral WS error:', err.message);
    });

    voxtralWs.on('close', () => {
      console.log(
        `[transcription] Voxtral WS closed for user ${socket.userId}`,
      );
      voxtralWs = null;
    });
  });

  /**
   * transcription:audio — receive Base64-encoded PCM chunk from client,
   * forward to Voxtral as an input_audio.append message.
   */
  socket.on('transcription:audio', (base64Chunk) => {
    if (voxtralWs && voxtralWs.readyState === WebSocket.OPEN) {
      voxtralWs.send(
        JSON.stringify({
          type: 'input_audio.append',
          audio: base64Chunk,
        }),
      );
    }
  });

  /**
   * transcription:stop — gracefully close the Voxtral WebSocket.
   */
  socket.on('transcription:stop', () => {
    if (voxtralWs && voxtralWs.readyState === WebSocket.OPEN) {
      // Signal end of audio stream before closing
      voxtralWs.send(JSON.stringify({ type: 'input_audio.end' }));
    }
    cleanup();
  });

  // Clean up on disconnect
  socket.on('disconnect', () => {
    cleanup();
  });
}
