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
  let audioChunkCount = 0;

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
      console.log(`[transcription] Clearing stale buffer for user ${socket.userId}`);
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
    audioChunkCount = 0;
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
      console.log(`[transcription] Speaker: ${speakerName}, callId: ${callId}`);
    } catch (err) {
      console.error(`[transcription] Failed to fetch speaker info:`, err.message);
    }

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
            console.log(`[transcription] Language detected for user ${socket.userId}: ${detectedLang}`);
          }
        } else if (msg.type === 'transcription.segment') {
          // Segment boundary — emit completed sentence, then clear buffer
          console.log(`[transcription] Segment boundary for user ${socket.userId}, saving entry`);
          emitTranscriptEntry(transcriptBuffer);
          transcriptBuffer = '';
        } else if (msg.type === 'transcription.done') {
          console.log(`[transcription] Transcription done for user ${socket.userId}`);
          emitTranscriptEntry(transcriptBuffer);
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
