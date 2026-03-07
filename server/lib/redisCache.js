import redisClient from '../redis.js';

export async function cachedFetch(cacheKey, fetchFn, ttl) {
  if (!redisClient.isReady) {
    throw new Error(`Redis is not ready for cache key ${cacheKey}`);
  }

  const cached = await redisClient.get(cacheKey);

  if (cached) {
    return { data: JSON.parse(cached), fromCache: true };
  }

  const data = await fetchFn();
  if (data != null) {
    await redisClient.set(cacheKey, JSON.stringify(data), { EX: ttl });
  }

  return { data, fromCache: false };
}
