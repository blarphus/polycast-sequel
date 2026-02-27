// ---------------------------------------------------------------------------
// routes/iceServers.js -- ICE server config (STUN + optional TURN)
// ---------------------------------------------------------------------------

import { Router } from 'express';
import { authMiddleware } from '../auth.js';

const router = Router();

// Cache Metered TURN credentials for 5 minutes
let cachedTurnServers = null;
let cacheTimestamp = 0;
const CACHE_TTL = 5 * 60 * 1000;

async function getMeteredTurnServers() {
  const apiKey = process.env.METERED_API_KEY;
  const appName = process.env.METERED_APP_NAME;
  if (!apiKey || !appName) return [];

  const now = Date.now();
  if (cachedTurnServers && (now - cacheTimestamp) < CACHE_TTL) {
    return cachedTurnServers;
  }

  const resp = await fetch(
    `https://${appName}.metered.live/api/v1/turn/credentials?apiKey=${apiKey}`,
  );
  if (!resp.ok) {
    throw new Error(`Metered API returned ${resp.status}`);
  }

  cachedTurnServers = await resp.json();
  cacheTimestamp = now;
  return cachedTurnServers;
}

router.get('/api/ice-servers', authMiddleware, async (_req, res) => {
  const iceServers = [
    { urls: 'stun:stun.l.google.com:19302' },
    { urls: 'stun:stun1.l.google.com:19302' },
  ];

  // Static TURN credentials from env vars (works with any TURN provider)
  const turnUrls = process.env.TURN_URLS;
  const turnUsername = process.env.TURN_USERNAME;
  const turnCredential = process.env.TURN_CREDENTIAL;

  if (turnUrls && turnUsername && turnCredential) {
    iceServers.push({
      urls: turnUrls.split(',').map((u) => u.trim()),
      username: turnUsername,
      credential: turnCredential,
    });
  }

  // Metered.ca dynamic TURN credentials (free tier: 500 GB/month)
  try {
    const metered = await getMeteredTurnServers();
    if (metered.length > 0) {
      iceServers.push(...metered);
    }
  } catch (err) {
    console.error('[ice-servers] Failed to fetch Metered TURN credentials:', err.message);
  }

  res.json({ iceServers });
});

export default router;
