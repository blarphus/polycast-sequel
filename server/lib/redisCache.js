import redisClient from '../redis.js';
import logger from '../logger.js';

/**
 * Try Redis cache first; on miss call fetchFn() and cache the result.
 * Skips caching empty arrays to avoid cache poisoning.
 * Redis failures are non-critical (warned, not thrown).
 * Fetch errors propagate to the caller.
 */
export async function cachedFetch(cacheKey, fetchFn, ttl) {
  let cached = null;
  try {
    if (redisClient.isReady) {
      cached = await redisClient.get(cacheKey);
    }
  } catch (err) {
    logger.warn('Redis read failed for %s: %s', cacheKey, err.message);
  }

  if (cached) {
    return { data: JSON.parse(cached), fromCache: true };
  }

  const data = await fetchFn();

  const shouldCache = Array.isArray(data) ? data.length > 0 : data != null;
  if (shouldCache) {
    try {
      if (redisClient.isReady) {
        await redisClient.set(cacheKey, JSON.stringify(data), { EX: ttl });
      }
    } catch (err) {
      logger.warn('Redis write failed for %s: %s', cacheKey, err.message);
    }
  }

  return { data, fromCache: false };
}
