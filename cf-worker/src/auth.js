import { createDiagnostic } from './diagnostics.js';

const encoder = new TextEncoder();

function decodeBase64Url(value) {
  const normalized = value.replace(/-/g, '+').replace(/_/g, '/');
  const padded = normalized.padEnd(Math.ceil(normalized.length / 4) * 4, '=');
  return Uint8Array.from(atob(padded), (character) => character.charCodeAt(0));
}

function decodeJSON(value) {
  return JSON.parse(new TextDecoder().decode(decodeBase64Url(value)));
}

function authFailure(code, message, operation, correlationId, status = 401) {
  return {
    ok: false,
    status,
    error: message,
    diagnostic: createDiagnostic({
      code,
      severity: status >= 500 ? 'error' : 'warning',
      title: status === 429 ? 'Media request limit reached' : 'Media authorization failed',
      message,
      operation,
      correlationId,
    }),
  };
}

function quotaLimit(scope, env) {
  const configured = Number(env[`QUOTA_${scope.toUpperCase()}`]);
  if (Number.isInteger(configured) && configured > 0) return configured;
  return scope === 'check' || scope === 'tts' ? 10 : 30;
}

export async function authorizeWorkerRequest(request, env, scope) {
  const correlationId = request.headers.get('X-Correlation-ID') || crypto.randomUUID();
  if (!env.AUTH_SECRET || !env.AUTH_REPLAY) {
    return authFailure(
      'worker_auth_configuration_missing',
      'The media authorization service is not fully configured.',
      scope,
      correlationId,
      503,
    );
  }

  const token = request.headers.get('Authorization')?.replace(/^Bearer\s+/i, '') || '';
  const match = /^p1\.([A-Za-z0-9_-]+)\.([A-Za-z0-9_-]+)$/.exec(token);
  if (!match) return authFailure('worker_token_invalid', 'The media request token is invalid.', scope, correlationId);

  let claims;
  let signature;
  try {
    claims = decodeJSON(match[1]);
    signature = decodeBase64Url(match[2]);
  } catch {
    return authFailure('worker_token_malformed', 'The media request token could not be decoded.', scope, correlationId);
  }

  const key = await crypto.subtle.importKey(
    'raw',
    encoder.encode(env.AUTH_SECRET),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['verify'],
  );
  const validSignature = await crypto.subtle.verify('HMAC', key, signature, encoder.encode(`p1.${match[1]}`));
  if (!validSignature) return authFailure('worker_token_signature_invalid', 'The media request token signature is invalid.', scope, correlationId);

  const now = Math.floor(Date.now() / 1000);
  if (claims.v !== 1 || claims.iss !== 'polycast-server' || typeof claims.sub !== 'string') {
    return authFailure('worker_token_claims_invalid', 'The media request token has invalid claims.', scope, correlationId);
  }
  if (!Number.isInteger(claims.iat) || !Number.isInteger(claims.exp) || claims.iat > now + 5 || claims.exp <= now || claims.exp - claims.iat > 60) {
    return authFailure('worker_token_expired', 'The media request token expired or has an invalid lifetime.', scope, correlationId);
  }
  if (claims.scope !== scope) {
    return authFailure('worker_token_scope_mismatch', 'The media request token is not authorized for this operation.', scope, correlationId);
  }
  if (typeof claims.jti !== 'string' || !/^[A-Za-z0-9_-]{16,128}$/.test(claims.jti)) {
    return authFailure('worker_token_nonce_invalid', 'The media request token has an invalid nonce.', scope, correlationId);
  }

  const replayKey = `auth:${claims.jti}`;
  if (await env.AUTH_REPLAY.get(replayKey)) {
    return authFailure('worker_token_replayed', 'The media request token has already been used.', scope, correlationId);
  }
  await env.AUTH_REPLAY.put(replayKey, '1', { expirationTtl: Math.max(claims.exp - now, 60) });

  const minute = Math.floor(now / 60);
  const quotaKey = `quota:${scope}:${claims.sub}:${minute}`;
  const used = Number(await env.AUTH_REPLAY.get(quotaKey) || 0);
  const limit = quotaLimit(scope, env);
  if (used >= limit) {
    return authFailure(
      'worker_action_quota_exhausted',
      `The ${scope} media request limit was reached. Try again after the current minute.`,
      scope,
      correlationId,
      429,
    );
  }
  await env.AUTH_REPLAY.put(quotaKey, String(used + 1), { expirationTtl: 120 });

  return { ok: true, claims, correlationId };
}
