import crypto from 'crypto';
import logger from '../logger.js';

const SECRET_PATTERN = /(bearer\s+)[^\s,;]+|((?:token|secret|password|api[_-]?key)\s*[=:]\s*)[^\s,;]+/gi;

function redact(value) {
  return String(value || '')
    .replace(SECRET_PATTERN, (_match, bearerPrefix, keyPrefix) => `${bearerPrefix || keyPrefix || ''}[REDACTED]`)
    .slice(0, 2000);
}

export function normalizeFallbackDiagnostic(input = {}, context = {}) {
  const code = String(input.code || context.code || 'fallback_used').trim().toLowerCase().replace(/[^a-z0-9_.-]+/g, '_');
  return {
    code,
    severity: ['info', 'warning', 'error'].includes(input.severity) ? input.severity : 'warning',
    title: redact(input.title || 'Fallback used'),
    message: redact(input.message || 'Polycast used an alternate path.'),
    source: String(input.source || context.source || 'server.unknown').slice(0, 120),
    operation: String(input.operation || context.operation || 'unknown').slice(0, 120),
    pipeline: String(input.pipeline || context.pipeline || input.operation || context.operation || 'unknown').slice(0, 120),
    stage: String(input.stage || context.stage || 'fallback').slice(0, 120),
    ...(input.language || context.language ? { language: String(input.language || context.language).slice(0, 20) } : {}),
    ...(input.entityType || context.entityType ? { entityType: String(input.entityType || context.entityType).slice(0, 80) } : {}),
    ...(input.entityId || context.entityId ? { entityId: String(input.entityId || context.entityId).slice(0, 200) } : {}),
    ...(input.selectedAction || context.selectedAction ? { selectedAction: String(input.selectedAction || context.selectedAction).slice(0, 160) } : {}),
    ...(input.catalogVersion || context.catalogVersion ? { catalogVersion: String(input.catalogVersion || context.catalogVersion).slice(0, 120) } : {}),
    correlationId: String(input.correlationId || context.correlationId || crypto.randomUUID()),
    occurredAt: input.occurredAt || new Date().toISOString(),
    ...(input.detail ? { detail: redact(input.detail) } : {}),
  };
}

export async function persistFallbackDiagnostic(db, input, context = {}) {
  const diagnostic = normalizeFallbackDiagnostic(input, context);
  await db.query(
    `INSERT INTO fallback_diagnostics (
       correlation_id, code, severity, pipeline, stage, source, operation,
       language, entity_type, entity_id, selected_action, message, detail, metadata, occurred_at
     ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14::jsonb, $15)`,
    [
      diagnostic.correlationId, diagnostic.code, diagnostic.severity,
      diagnostic.pipeline, diagnostic.stage, diagnostic.source, diagnostic.operation,
      diagnostic.language || null, diagnostic.entityType || null, diagnostic.entityId || null,
      diagnostic.selectedAction || null, diagnostic.message, diagnostic.detail || null,
      JSON.stringify({ catalogVersion: diagnostic.catalogVersion || null }), diagnostic.occurredAt,
    ],
  );
  return diagnostic;
}

export function fallbackDiagnosticsMiddleware(req, res, next) {
  const originalJson = res.json.bind(res);
  res.json = (body) => {
    if (body && typeof body === 'object' && Array.isArray(body.fallback_notices)) {
      body.fallback_notices = body.fallback_notices.map((notice) => {
        const normalized = normalizeFallbackDiagnostic(notice, {
          source: 'server.api',
          operation: `${req.method} ${req.route?.path || req.path}`,
          correlationId: req.id,
        });
        req.log?.warn({ fallback: normalized }, 'Fallback path used');
        return normalized;
      });
    }
    return originalJson(body);
  };
  next();
}

export function setFallbackDiagnosticHeader(res, diagnostic) {
  const existing = res.getHeader('X-Polycast-Fallback-Diagnostics');
  let diagnostics = [];
  if (typeof existing === 'string') {
    try {
      diagnostics = JSON.parse(Buffer.from(existing, 'base64url').toString('utf8'));
    } catch (error) {
      logger.error({
        event: 'fallback_diagnostic_header_repair',
        operation: 'append-fallback-header',
        headerLength: existing.length,
        error: error instanceof Error ? error.message : String(error),
      }, 'Malformed fallback diagnostic header was discarded before append');
      diagnostics = [];
    }
  }
  diagnostics.push(diagnostic);
  res.setHeader(
    'X-Polycast-Fallback-Diagnostics',
    Buffer.from(JSON.stringify(diagnostics)).toString('base64url'),
  );
  res.setHeader('Access-Control-Expose-Headers', 'X-Polycast-Fallback-Diagnostics, X-Correlation-ID');
}
