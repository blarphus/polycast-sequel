import { fetchYouTubeTranscript, TranscriptFetchError } from './videoTranscriptFetcher.js';
import { normalizeTranscriptSegmentsStrict } from './videoTranscriptNormalizer.js';

const QUEUE_KEY = 'queue:video_transcripts';
const DELAYED_KEY = 'queue:video_transcripts:delayed';
const DEDUPE_PREFIX = 'queue:video_transcripts:dedupe:';

const MAX_ATTEMPTS = 3;
const RETRY_DELAYS_MS = [15000, 60000, 180000];

function dedupeKey(videoId, language) {
  return `${DEDUPE_PREFIX}${videoId}:${language}`;
}

function serializeJob(job) {
  return JSON.stringify(job);
}

function parseJob(raw) {
  try {
    const parsed = JSON.parse(raw);
    if (!parsed || !parsed.videoId || !parsed.youtubeId || !parsed.language) return null;
    return {
      videoId: parsed.videoId,
      youtubeId: parsed.youtubeId,
      language: parsed.language,
      attempt: Number(parsed.attempt || 1),
    };
  } catch {
    return null;
  }
}

function mapErrorToMessage(err) {
  const withDetail = (friendly, code = 'UNKNOWN', detail = '') => {
    const suffix = detail ? ` (${code}: ${detail})` : ` (${code})`;
    return `${friendly}${suffix}`;
  };

  if (err instanceof TranscriptFetchError) {
    switch (err.code) {
      case 'NO_CAPTIONS':
        return withDetail(
          'No YouTube captions are available for this video and language.',
          err.code,
          err.message,
        );
      case 'BLOCKED_OR_RATE_LIMITED':
        return withDetail(
          'YouTube temporarily blocked transcript requests. Please retry later.',
          err.code,
          err.message,
        );
      case 'SOURCE_UNAVAILABLE':
        return withDetail(
          'Video is unavailable for transcript extraction.',
          err.code,
          err.message,
        );
      case 'CONFIG_ERROR':
        return withDetail(
          'Transcript service is not configured correctly on the server.',
          err.code,
          err.message,
        );
      case 'PARSER_ERROR':
        return withDetail(
          'Transcript parsing failed for this video.',
          err.code,
          err.message,
        );
      default:
        return withDetail('Transcript fetch temporarily failed.', err.code, err.message);
    }
  }
  return withDetail('Transcript fetch temporarily failed.', 'UNKNOWN', err?.message || '');
}

function shouldRetry(err, attempt) {
  if (attempt >= MAX_ATTEMPTS) return false;
  if (!(err instanceof TranscriptFetchError)) return true;
  return Boolean(err.transient);
}

async function markProcessing(pool, videoId, attempt) {
  await pool.query(
    `UPDATE videos
     SET transcript_status = 'processing',
         transcript_last_error = NULL,
         transcript_attempts = GREATEST(transcript_attempts, $2),
         transcript_updated_at = NOW()
     WHERE id = $1`,
    [videoId, attempt],
  );
}

async function markReady(pool, videoId, segments, source, attempt) {
  await pool.query(
    `UPDATE videos
     SET transcript = $2,
         transcript_status = 'ready',
         transcript_source = $3,
         transcript_last_error = NULL,
         transcript_attempts = $4,
         transcript_updated_at = NOW()
     WHERE id = $1`,
    [videoId, JSON.stringify(segments), source, attempt],
  );
}

async function markFailed(pool, videoId, message, attempt) {
  await pool.query(
    `UPDATE videos
     SET transcript_status = 'failed',
         transcript_source = 'none',
         transcript_last_error = $2,
         transcript_attempts = $3,
         transcript_updated_at = NOW()
     WHERE id = $1`,
    [videoId, message, attempt],
  );
}

async function scheduleRetry(redisClient, job) {
  const delayIdx = Math.max(0, Math.min(job.attempt - 1, RETRY_DELAYS_MS.length - 1));
  const delayMs = RETRY_DELAYS_MS[delayIdx];
  const nextJob = { ...job, attempt: job.attempt + 1 };

  await redisClient.zAdd(DELAYED_KEY, [{
    score: Date.now() + delayMs,
    value: serializeJob(nextJob),
  }]);
}

async function moveDueDelayedJobs(redisClient) {
  const now = Date.now();
  const due = await redisClient.zRangeByScore(DELAYED_KEY, 0, now, { LIMIT: { offset: 0, count: 50 } });
  if (due.length === 0) return;

  for (const raw of due) {
    const removed = await redisClient.zRem(DELAYED_KEY, raw);
    if (!removed) continue;
    await redisClient.lPush(QUEUE_KEY, raw);
  }
}

export async function enqueueTranscriptJob(redisClient, job, opts = {}) {
  const { force = false } = opts;

  if (!redisClient?.isOpen) {
    return { accepted: false, reason: 'redis_unavailable' };
  }

  const key = dedupeKey(job.videoId, job.language);

  if (!force) {
    const created = await redisClient.set(key, '1', { NX: true, EX: 900 });
    if (!created) return { accepted: false, reason: 'duplicate' };
  } else {
    await redisClient.set(key, '1', { EX: 900 });
  }

  await redisClient.lPush(QUEUE_KEY, serializeJob({ ...job, attempt: Number(job.attempt || 1) }));
  return { accepted: true, reason: 'queued' };
}

export async function startTranscriptWorker({ redisClient, pool }) {
  if (!redisClient?.isOpen) {
    console.warn('[transcript-queue] Redis is not connected; worker not started');
    return { stop: async () => {} };
  }

  const blockingClient = redisClient.duplicate();
  const schedulerClient = redisClient.duplicate();

  await Promise.all([blockingClient.connect(), schedulerClient.connect()]);

  let running = true;
  const delayedTimer = setInterval(() => {
    moveDueDelayedJobs(schedulerClient).catch((err) => {
      console.error('[transcript-queue] Failed to move delayed jobs:', err.message);
    });
  }, 2000);

  const processRawJob = async (raw) => {
    const job = parseJob(raw);
    if (!job) {
      console.warn('[transcript-queue] Dropping malformed job payload');
      return;
    }

    const key = dedupeKey(job.videoId, job.language);

    try {
      await markProcessing(pool, job.videoId, job.attempt);

      const { segments, source } = await fetchYouTubeTranscript(job.youtubeId, job.language);
      const normalized = normalizeTranscriptSegmentsStrict(segments, { language: job.language });
      const segmentsToSave = normalized.meta.applied ? normalized.segments : segments;

      await markReady(pool, job.videoId, segmentsToSave, source, job.attempt);
      await redisClient.del(key);

      console.log(
        `[transcript-queue] Ready video=${job.videoId} source=${source} lang=${job.language} segments=${segmentsToSave.length} normalize=${normalized.meta.applied ? 'applied' : 'skipped'} reason=${normalized.meta.reason}`,
      );
    } catch (err) {
      const message = mapErrorToMessage(err);

      if (shouldRetry(err, job.attempt)) {
        await scheduleRetry(redisClient, job);

        await pool.query(
          `UPDATE videos
           SET transcript_status = 'processing',
               transcript_last_error = $2,
               transcript_attempts = $3,
               transcript_updated_at = NOW()
           WHERE id = $1`,
          [job.videoId, `${message} Retrying...`, job.attempt],
        );

        console.warn(
          `[transcript-queue] Retry scheduled video=${job.videoId} attempt=${job.attempt + 1} reason=${err?.code || 'unknown'}`,
        );
        return;
      }

      await markFailed(pool, job.videoId, message, job.attempt);
      await redisClient.del(key);
      console.error(
        `[transcript-queue] Failed video=${job.videoId} attempts=${job.attempt} reason=${err?.code || 'unknown'} msg=${err?.message || err}`,
      );
    }
  };

  const loopPromise = (async () => {
    while (running) {
      try {
        await moveDueDelayedJobs(schedulerClient);

        const item = await blockingClient.brPop(QUEUE_KEY, 5);
        if (!item) continue;

        await processRawJob(item.element);
      } catch (err) {
        if (!running) break;
        console.error('[transcript-queue] Worker loop error:', err.message);
      }
    }
  })();

  console.log('[transcript-queue] Worker started');

  return {
    stop: async () => {
      running = false;
      clearInterval(delayedTimer);
      await Promise.allSettled([blockingClient.quit(), schedulerClient.quit(), loopPromise]);
      console.log('[transcript-queue] Worker stopped');
    },
  };
}
