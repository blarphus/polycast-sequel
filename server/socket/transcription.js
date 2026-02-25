import WebSocket from 'ws';
import { userToSocket } from './presence.js';

const VOXTRAL_URL =
  'wss://api.mistral.ai/v1/audio/transcriptions/realtime?model=voxtral-mini-transcribe-realtime-2602';

/**
 * Register realtime transcription event handlers on a socket.
 * Maintains a Voxtral WebSocket per active transcription session and relays
 * accumulated text back to the originating client AND to their call peer.
 */
export function handleTranscription(io, socket, pool) {
  let voxtralWs = null;
  let peerId = null;
  let transcriptBuffer = '';
  let detectedLang = 'en';
  let clearTimer = null;

  // Cached speaker info (populated on transcription:start)
  let speakerName = '';
  let callId = null;

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
      // Save the completed sentence to transcript before clearing
      emitTranscriptEntry(transcriptBuffer);
      transcriptBuffer = '';
      emitTranscript('');
    }, 4000);
  }

  /**
   * Emit a completed sentence to both users and persist to DB.
   */
  function emitTranscriptEntry(text) {
    if (!text || !text.trim()) return;

    const entry = {
      userId: socket.userId,
      displayName: speakerName,
      text: text.trim(),
      lang: detectedLang,
    };

    // Emit to speaker
    socket.emit('transcript:entry', entry);

    // Emit to peer
    const peerSocketId = userToSocket.get(peerId);
    if (peerSocketId) {
      io.to(peerSocketId).emit('transcript:entry', entry);
    }

    // Persist to DB (fire and forget)
    if (callId) {
      pool.query(
        `INSERT INTO transcript_entries (call_id, user_id, text, language) VALUES ($1, $2, $3, $4)`,
        [callId, socket.userId, text.trim(), detectedLang],
      ).catch((err) => {
        console.error(`[transcription] Failed to save transcript entry:`, err.message);
      });
    }
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
    speakerName = '';
    callId = null;
  }

  /**
   * transcription:start — open a Voxtral WebSocket session.
   * Payload: { peerId }
   */
  socket.on('transcription:start', async (data) => {
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

    // Cache speaker info from DB
    try {
      const userResult = await pool.query(
        'SELECT display_name, username FROM users WHERE id = $1',
        [socket.userId],
      );
      const row = userResult.rows[0];
      if (!row) {
        console.error(`[transcription] Speaker user not found in DB for userId=${socket.userId}`);
      }
      speakerName = row?.display_name || row?.username || 'Unknown';

      // Find the active call between this user and the peer
      const callResult = await pool.query(
        `SELECT id FROM calls
         WHERE status = 'active'
           AND ((caller_id = $1 AND callee_id = $2) OR (caller_id = $2 AND callee_id = $1))
         ORDER BY started_at DESC LIMIT 1`,
        [socket.userId, peerId],
      );
      callId = callResult.rows[0]?.id || null;
      if (!callId) {
        console.warn(`[transcription] No active call found between ${socket.userId} and ${peerId} — transcripts will not be persisted`);
      }
    } catch (err) {
      console.error(`[transcription] Failed to fetch speaker info:`, err.message);
    }

    voxtralWs = new WebSocket(VOXTRAL_URL, {
      headers: {
        Authorization: `Bearer ${apiKey}`,
      },
    });

    voxtralWs.on('open', () => {
      console.log(`[transcription] Voxtral WS opened for user ${socket.userId}`);

      // Configure audio format
      voxtralWs.send(JSON.stringify({
        type: 'session.update',
        session: {
          audio_format: {
            encoding: 'pcm_s16le',
            sample_rate: 16000,
          },
        },
      }));
    });

    voxtralWs.on('message', (raw) => {
      try {
        const msg = JSON.parse(raw.toString());

        if (msg.type === 'transcription.text.delta') {
          const delta = msg.text || '';
          transcriptBuffer += delta;

          // Flush completed sentences on punctuation boundaries
          const sentenceEnd = /[.!?。？！]\s*/g;
          let lastIdx = 0;
          let match;
          while ((match = sentenceEnd.exec(transcriptBuffer)) !== null) {
            lastIdx = match.index + match[0].length;
          }
          if (lastIdx > 0) {
            const completed = transcriptBuffer.slice(0, lastIdx);
            transcriptBuffer = transcriptBuffer.slice(lastIdx);
            emitTranscriptEntry(completed);
          }

          // Show whatever is in the buffer as the live subtitle
          emitTranscript(transcriptBuffer);
        } else if (msg.type === 'transcription.language') {
          if (msg.language) {
            detectedLang = msg.language;
          }
        } else if (msg.type === 'transcription.segment') {
          emitTranscriptEntry(transcriptBuffer);
          transcriptBuffer = '';
        } else if (msg.type === 'transcription.done') {
          emitTranscriptEntry(transcriptBuffer);
          transcriptBuffer = '';
        } else if (msg.type === 'error') {
          console.error(`[transcription] Voxtral error for user ${socket.userId}:`, JSON.stringify(msg));
        } else if (msg.type === 'session.created' || msg.type === 'session.updated') {
          // expected lifecycle events, no action needed
        } else {
          console.warn(`[transcription] Unhandled Voxtral message type for user ${socket.userId}: ${msg.type}`);
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
    console.log(`[transcription] transcription:stop from user ${socket.userId}`);
    if (voxtralWs && voxtralWs.readyState === WebSocket.OPEN) {
      voxtralWs.send(JSON.stringify({ type: 'input_audio.end' }));
    }
    cleanup();
  });

  // Clean up on disconnect
  socket.on('disconnect', () => {
    cleanup();
  });
}
