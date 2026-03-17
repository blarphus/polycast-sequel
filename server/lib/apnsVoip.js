import crypto from 'crypto';
import http2 from 'http2';
import logger from '../logger.js';

function base64url(input) {
  return Buffer.from(input)
    .toString('base64')
    .replace(/\+/g, '-')
    .replace(/\//g, '_')
    .replace(/=+$/g, '');
}

function decodePrivateKey(value) {
  return value.replace(/\\n/g, '\n');
}

function getApnsConfig(environment) {
  const keyId = process.env.APNS_KEY_ID;
  const teamId = process.env.APNS_TEAM_ID;
  const privateKey = process.env.APNS_PRIVATE_KEY;
  const bundleId = process.env.APNS_BUNDLE_ID || 'com.patron.polycast';
  if (!keyId || !teamId || !privateKey || !bundleId) {
    return null;
  }

  return {
    keyId,
    teamId,
    privateKey: decodePrivateKey(privateKey),
    bundleId,
    host: environment === 'sandbox' ? 'https://api.sandbox.push.apple.com' : 'https://api.push.apple.com',
  };
}

let cachedJwt = null;
let cachedJwtIssuedAt = 0;

function createProviderToken(config) {
  const now = Math.floor(Date.now() / 1000);
  if (cachedJwt && now - cachedJwtIssuedAt < 50 * 60) {
    return cachedJwt;
  }

  const header = base64url(JSON.stringify({ alg: 'ES256', kid: config.keyId }));
  const claims = base64url(JSON.stringify({ iss: config.teamId, iat: now }));
  const signer = crypto.createSign('sha256');
  signer.update(`${header}.${claims}`);
  signer.end();
  const signature = signer.sign(config.privateKey);
  cachedJwt = `${header}.${claims}.${base64url(signature)}`;
  cachedJwtIssuedAt = now;
  return cachedJwt;
}

function requestApnsPush(config, deviceToken, payload) {
  return new Promise((resolve, reject) => {
    const client = http2.connect(config.host);
    client.on('error', reject);

    const req = client.request({
      ':method': 'POST',
      ':path': `/3/device/${deviceToken}`,
      authorization: `bearer ${createProviderToken(config)}`,
      'apns-push-type': 'voip',
      'apns-topic': `${config.bundleId}.voip`,
      'apns-priority': '10',
      'content-type': 'application/json',
    });

    let responseBody = '';
    let statusCode = 0;
    req.setEncoding('utf8');

    req.on('response', (headers) => {
      statusCode = Number(headers[':status'] || 0);
    });
    req.on('data', (chunk) => {
      responseBody += chunk;
    });
    req.on('end', () => {
      client.close();
      if (statusCode >= 200 && statusCode < 300) {
        resolve({ ok: true });
        return;
      }

      let reason = `APNs ${statusCode}`;
      try {
        const parsed = JSON.parse(responseBody);
        if (parsed.reason) reason = parsed.reason;
      } catch {
        // Keep fallback reason.
      }
      resolve({ ok: false, reason, statusCode });
    });
    req.on('error', (err) => {
      client.close();
      reject(err);
    });
    req.end(JSON.stringify(payload));
  });
}

export async function sendIncomingCallVoipPushes(db, userId, callPayload) {
  const { rows } = await db.query(
    `SELECT id, device_token, apns_environment, bundle_id
     FROM ios_voip_devices
     WHERE user_id = $1
     ORDER BY updated_at DESC`,
    [userId],
  );

  if (rows.length === 0) {
    return 0;
  }

  let successCount = 0;
  for (const row of rows) {
    const config = getApnsConfig(row.apns_environment);
    if (!config) {
      logger.error('APNs VoIP config missing; cannot deliver incoming call push');
      break;
    }

    const payload = {
      aps: {
        'content-available': 1,
      },
      callId: callPayload.callId,
      callerId: callPayload.callerId,
      callerUsername: callPayload.callerUsername,
      callerDisplayName: callPayload.callerDisplayName,
      mode: callPayload.mode,
    };

    try {
      const response = await requestApnsPush(
        { ...config, bundleId: row.bundle_id || config.bundleId },
        row.device_token,
        payload,
      );

      if (response.ok) {
        successCount += 1;
        await db.query(
          'UPDATE ios_voip_devices SET updated_at = NOW(), last_seen_at = NOW() WHERE id = $1',
          [row.id],
        );
        continue;
      }

      logger.warn(
        { reason: response.reason, statusCode: response.statusCode, userId, deviceId: row.id },
        'APNs VoIP push rejected',
      );
      if (response.reason === 'BadDeviceToken' || response.reason === 'Unregistered') {
        await db.query('DELETE FROM ios_voip_devices WHERE id = $1', [row.id]);
      }
    } catch (err) {
      logger.error({ err, userId, deviceId: row.id }, 'Failed to send APNs VoIP push');
    }
  }

  return successCount;
}
