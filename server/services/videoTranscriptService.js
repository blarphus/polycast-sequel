import pool from '../db.js';
import redisClient from '../redis.js';
import {
  enqueueTranscriptJob,
  markReady,
  clearTranscriptDedupe,
} from './videoTranscriptQueue.js';
import {
  parseDuration,
  parseYouTubeId,
  getYouTubeApiKey,
  fetchYouTubeVideoMetadata,
} from './youtubeApi.js';

function httpError(status, message) {
  const err = new Error(message);
  err.status = status;
  return err;
}

export function attachTranscriptError(video) {
  const out = { ...video };
  const hasTranscript = Array.isArray(out.transcript)
    ? out.transcript.length > 0
    : Boolean(out.transcript);
  const status = out.transcript_status || (hasTranscript ? 'ready' : 'missing');
  out.transcript_status = status;

  if (!out.transcript_source) {
    out.transcript_source = hasTranscript ? 'manual' : 'none';
  }

  if (status === 'failed') {
    out.transcript_error = out.transcript_last_error || 'Transcript temporarily unavailable';
  }

  return out;
}

export async function fetchVideoById(id) {
  const { rows } = await pool.query('SELECT * FROM videos WHERE id = $1', [id]);
  return rows[0] || null;
}

export async function queueTranscriptIfNeeded(video, opts = {}) {
  const { force = false } = opts;

  if (!video) return null;

  const hasTranscript = Array.isArray(video.transcript) && video.transcript.length > 0;
  if (!force && hasTranscript && video.transcript_status === 'ready') {
    return attachTranscriptError(video);
  }

  if (!force && video.transcript_status === 'processing') {
    return attachTranscriptError(video);
  }

  const { rows: updatedRows } = await pool.query(
    `UPDATE videos
     SET transcript_status = 'processing',
         transcript_last_error = NULL,
         transcript_updated_at = NOW()
     WHERE id = $1
     RETURNING *`,
    [video.id],
  );

  const updated = updatedRows[0] || video;
  const enqueueResult = await enqueueTranscriptJob(
    redisClient,
    {
      videoId: updated.id,
      youtubeId: updated.youtube_id,
      language: updated.language,
      attempt: 1,
    },
    { force },
  );

  if (!enqueueResult.accepted && enqueueResult.reason === 'redis_unavailable') {
    const { rows: failedRows } = await pool.query(
      `UPDATE videos
       SET transcript_status = 'failed',
           transcript_source = 'none',
           transcript_last_error = 'Transcript queue unavailable. Please try again later.',
           transcript_updated_at = NOW()
       WHERE id = $1
       RETURNING *`,
      [video.id],
    );
    return attachTranscriptError(failedRows[0] || updated);
  }

  return attachTranscriptError(updated);
}

export async function listVideos() {
  const { rows } = await pool.query(
    `SELECT id, youtube_id, title, channel, language, duration_seconds,
            transcript_status, transcript_source, cefr_level, transcript_progress
     FROM videos ORDER BY created_at DESC`,
  );
  return rows.map(attachTranscriptError);
}

export async function createVideoFromUrl(url, language = 'en') {
  const youtube_id = parseYouTubeId(url);
  if (!youtube_id) throw httpError(400, 'Invalid YouTube URL');

  const existing = await pool.query('SELECT * FROM videos WHERE youtube_id = $1', [youtube_id]);
  if (existing.rows.length > 0) {
    const existingVideo = existing.rows[0];
    if (!existingVideo.transcript &&
        (!existingVideo.transcript_status || existingVideo.transcript_status === 'missing')) {
      return {
        created: false,
        video: await queueTranscriptIfNeeded(existingVideo),
      };
    }
    return {
      created: false,
      video: attachTranscriptError(existingVideo),
    };
  }

  const apiKey = getYouTubeApiKey();
  const item = await fetchYouTubeVideoMetadata(youtube_id, apiKey);
  if (!item) throw httpError(404, 'Video not found on YouTube');

  const title = item.snippet.title;
  const channel = item.snippet.channelTitle;
  const duration_seconds = parseDuration(item.contentDetails.duration);

  const { rows } = await pool.query(
    `INSERT INTO videos (youtube_id, title, channel, language, duration_seconds)
     VALUES ($1, $2, $3, $4, $5)
     RETURNING *`,
    [youtube_id, title, channel, language, duration_seconds],
  );

  return {
    created: true,
    video: await queueTranscriptIfNeeded(rows[0]),
  };
}

export async function getVideoDetail(id) {
  let video = await fetchVideoById(id);
  if (!video) throw httpError(404, 'Video not found');

  const hasTranscript = Array.isArray(video.transcript) && video.transcript.length > 0;

  if (hasTranscript &&
      video.transcript_status !== 'ready' &&
      video.transcript_status !== 'processing') {
    const { rows } = await pool.query(
      `UPDATE videos
       SET transcript_status = 'ready',
           transcript_source = CASE WHEN transcript_source = 'none' THEN 'manual' ELSE transcript_source END,
           transcript_last_error = NULL,
           transcript_updated_at = NOW()
       WHERE id = $1
       RETURNING *`,
      [id],
    );
    video = rows[0] || video;
  }

  if (!hasTranscript && (!video.transcript_status || video.transcript_status === 'missing')) {
    video = await queueTranscriptIfNeeded(video) || video;
  }

  return attachTranscriptError(video);
}

export async function retryVideoTranscriptExtraction(id) {
  const video = await fetchVideoById(id);
  if (!video) throw httpError(404, 'Video not found');

  const queued = await queueTranscriptIfNeeded(video, { force: true });
  if (!queued) throw httpError(500, 'Failed to queue transcript retry');
  return queued;
}

function normalizeTranscriptSegments(segments) {
  if (!Array.isArray(segments) || segments.length === 0 || segments.length > 10000) {
    throw httpError(400, 'segments must be a non-empty array (max 10,000 items)');
  }

  return segments.map((seg, i) => {
    if (!seg || typeof seg.text !== 'string' || !seg.text.trim() || seg.text.length > 2000) {
      throw httpError(400, `segments[${i}].text must be a non-empty string (max 2000 chars)`);
    }
    if (typeof seg.offset !== 'number' || !Number.isFinite(seg.offset) || seg.offset < 0) {
      throw httpError(400, `segments[${i}].offset must be a finite number >= 0`);
    }
    if (typeof seg.duration !== 'number' || !Number.isFinite(seg.duration) || seg.duration < 0) {
      throw httpError(400, `segments[${i}].duration must be a finite number >= 0`);
    }

    return {
      text: seg.text.trim(),
      offset: Math.round(seg.offset),
      duration: Math.round(seg.duration),
    };
  });
}

export async function uploadClientTranscript(id, segments) {
  const video = await fetchVideoById(id);
  if (!video) throw httpError(404, 'Video not found');

  const hasTranscript = Array.isArray(video.transcript) && video.transcript.length > 0;
  if (video.transcript_status === 'ready' && hasTranscript) {
    return attachTranscriptError(video);
  }

  const normalized = normalizeTranscriptSegments(segments);

  await markReady(pool, video.id, normalized, 'client_upload', video.transcript_attempts || 1, video.language);
  await clearTranscriptDedupe(redisClient, video.id, video.language);

  const updated = await fetchVideoById(id);
  return attachTranscriptError(updated);
}
