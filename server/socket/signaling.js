import { z } from 'zod';
import { getUserSocketIds } from './presence.js';
import logger from '../logger.js';
import { normalizeFallbackDiagnostic } from '../lib/fallbackDiagnostics.js';

const envelope = {
  correlationId: z.string().min(1).max(200),
  occurredAt: z.string().datetime(),
  callId: z.string().uuid(),
  peerId: z.string().uuid(),
};
const offerSchema = z.object({
  ...envelope,
  offer: z.object({ type: z.literal('offer'), sdp: z.string().min(1).max(200_000) }).strict(),
}).strict();
const answerSchema = z.object({
  ...envelope,
  answer: z.object({ type: z.literal('answer'), sdp: z.string().min(1).max(200_000) }).strict(),
}).strict();
const iceSchema = z.object({
  ...envelope,
  candidate: z.object({
    candidate: z.string().max(16_384),
    sdpMid: z.string().max(256).nullable().optional(),
    sdpMLineIndex: z.number().int().min(0).max(65_535).nullable().optional(),
    usernameFragment: z.string().max(256).nullable().optional(),
  }).strict(),
}).strict();

function reportSignalDiagnostic(socket, input, operation) {
  const diagnostic = normalizeFallbackDiagnostic(input, { source: 'server.call-signaling', operation });
  logger.warn({ diagnostic, socketId: socket.id, userId: socket.userId }, 'Direct call signaling alternate/rejection path used');
  socket.emit('call:diagnostic', diagnostic);
}

function parseSignal(socket, schema, payload, operation) {
  const result = schema.safeParse(payload);
  if (result.success) return result.data;
  reportSignalDiagnostic(socket, {
    code: 'call_signal_rejected', severity: 'error', title: 'Call signal rejected',
    message: `The ${operation} message was malformed and was not forwarded.`,
    detail: result.error.issues.map((issue) => `${issue.path.join('.') || 'payload'}: ${issue.message}`).join('; '),
    ...(typeof payload?.correlationId === 'string' ? { correlationId: payload.correlationId } : {}),
    ...(typeof payload?.occurredAt === 'string' ? { occurredAt: payload.occurredAt } : {}),
  }, operation);
  return null;
}

export function handleSignaling(io, socket, pool) {
  function relay(eventName, peerId, payload) {
    const targetSocketIds = getUserSocketIds(peerId);
    if (!targetSocketIds.length) {
      reportSignalDiagnostic(socket, {
        code: 'call_signal_target_unavailable', severity: 'warning', title: 'Call participant unavailable',
        message: 'The call signal target has no active authenticated socket, so the signal was not forwarded.',
        detail: `peerId=${peerId}`,
        correlationId: payload.correlationId,
        occurredAt: payload.occurredAt,
      }, eventName);
      return;
    }
    io.to(targetSocketIds).emit(eventName, { fromUserId: socket.userId, ...payload });
  }

  async function resolveSignalTarget(data, operation) {
    if (!data.callId) return data.peerId;
    const { rows } = await pool.query(
      `SELECT caller_id, callee_id, status, ended_at FROM calls
       WHERE id = $1 AND (caller_id = $2 OR callee_id = $2) LIMIT 1`,
      [data.callId, socket.userId],
    );
    const call = rows[0];
    if (!call || call.ended_at || !['ringing', 'active'].includes(call.status)) {
      reportSignalDiagnostic(socket, {
        code: 'stale_call_signal_rejected', severity: 'warning', title: 'Stale call signal rejected',
        message: 'This call is no longer active, so its signaling message was ignored.',
        detail: `callId=${data.callId}`,
        correlationId: data.correlationId, occurredAt: data.occurredAt,
      }, operation);
      return null;
    }
    const targetUserId = call.caller_id === socket.userId ? call.callee_id : call.caller_id;
    if (data.peerId !== targetUserId) {
      reportSignalDiagnostic(socket, {
        code: 'call_signal_target_mismatch', severity: 'error', title: 'Call signal target rejected',
        message: 'The requested signal target does not match the active call participant.',
        detail: `callId=${data.callId}; requestedPeerId=${data.peerId}; expectedPeerId=${targetUserId}`,
        correlationId: data.correlationId, occurredAt: data.occurredAt,
      }, operation);
      return null;
    }
    return targetUserId;
  }

  const register = (eventName, schema, field) => {
    socket.on(eventName, async (payload) => {
      const data = parseSignal(socket, schema, payload, eventName);
      if (!data) return;
      try {
        const targetUserId = await resolveSignalTarget(data, eventName);
        if (!targetUserId) return;
        relay(eventName, targetUserId, {
          callId: data.callId,
          [field]: data[field],
          correlationId: data.correlationId,
          occurredAt: data.occurredAt,
        });
      } catch (error) {
        reportSignalDiagnostic(socket, {
          code: 'call_signal_pipeline_failed', severity: 'error', title: 'Call signal failed',
          message: `Polycast could not process the ${eventName} message.`,
          detail: error instanceof Error ? error.message : String(error),
          correlationId: data.correlationId, occurredAt: data.occurredAt,
        }, eventName);
      }
    });
  };

  register('signal:offer', offerSchema, 'offer');
  register('signal:answer', answerSchema, 'answer');
  register('signal:ice-candidate', iceSchema, 'candidate');
}
