import redisClient from '../redis.js';

const CACHE_NAMESPACE = `polycast:${process.env.CACHE_VERSION || 'v1'}`;

export async function cachedFetch(cacheKey, fetchFn, ttl) {
  if (!redisClient.isReady) {
    throw new Error(`Redis is not ready for cache key ${cacheKey}`);
  }

  const namespacedKey = `${CACHE_NAMESPACE}:${cacheKey}`;
  const cached = await redisClient.get(namespacedKey);

  if (cached) {
    return { data: JSON.parse(cached), fromCache: true };
  }

  const data = await fetchFn();
  if (data != null) {
    await redisClient.set(namespacedKey, JSON.stringify(data), { EX: ttl });
  }

  return { data, fromCache: false };
}
