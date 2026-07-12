export class HttpError extends Error {
  constructor(status, message, {
    code = 'http_error',
    expose = status < 500,
    details,
    fallbackNotices,
    cause,
  } = {}) {
    super(message, cause ? { cause } : undefined);
    this.name = this.constructor.name;
    this.status = status;
    this.code = code;
    this.expose = expose;
    if (details !== undefined) this.details = details;
    if (fallbackNotices?.length) this.fallbackNotices = fallbackNotices;
  }
}

export class ValidationError extends HttpError {
  constructor(details) {
    super(400, details[0]?.message || 'Request validation failed', {
      code: 'request_validation_failed',
      details,
    });
  }
}

export class NotFoundError extends HttpError {
  constructor(message = 'Not found', options = {}) {
    super(404, message, { code: 'not_found', ...options });
  }
}

export class ConflictError extends HttpError {
  constructor(message, options = {}) {
    super(409, message, { code: 'conflict', ...options });
  }
}

export class ForbiddenError extends HttpError {
  constructor(message = 'Forbidden', options = {}) {
    super(403, message, { code: 'forbidden', ...options });
  }
}

export class UpstreamError extends HttpError {
  constructor(message, options = {}) {
    super(502, message, { code: 'upstream_failed', expose: true, ...options });
  }
}

export function asyncHandler(handler) {
  return function polycastAsyncHandler(req, res, next) {
    return Promise.resolve(handler(req, res, next)).catch(next);
  };
}

export function errorResponse(err, correlationId) {
  const status = Number.isInteger(err?.status) ? err.status : 500;
  const expose = err?.expose === true || status < 500;
  return {
    status,
    body: {
      error: expose ? err.message : 'Internal server error',
      code: err?.code || 'internal_server_error',
      correlationId,
      ...(Array.isArray(err?.details) ? { errors: err.details } : {}),
      ...(err?.fallbackNotices?.length ? { fallback_notices: err.fallbackNotices } : {}),
    },
  };
}
