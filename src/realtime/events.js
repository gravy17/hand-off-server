'use strict';

const ALLOWED_CLIENT_EVENTS = new Set([
  'call:invite',
  'call:accept',
  'call:reject',
  'call:end',
  'signal:ice',
]);

const LEGACY_CLIENT_EVENTS = new Set([
  'hello',
  'peer-msg',
  'callUser',
  'acceptCall',
  'hey',
  'callAccepted',
  'yourID',
  'allUsers',
]);

function isObject(value) {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function assertNonEmptyString(value, field) {
  if (typeof value !== 'string' || value.trim().length === 0) {
    const err = new Error(`${field} must be a non-empty string`);
    err.code = 'VALIDATION';
    throw err;
  }
  return value.trim();
}

function assertSignal(signal, maxPayloadBytes) {
  if (signal === undefined || signal === null) {
    const err = new Error('signal is required');
    err.code = 'VALIDATION';
    throw err;
  }

  let encoded;
  try {
    encoded = JSON.stringify(signal);
  } catch {
    const err = new Error('signal must be JSON-serializable');
    err.code = 'VALIDATION';
    throw err;
  }

  if (Buffer.byteLength(encoded, 'utf8') > maxPayloadBytes) {
    const err = new Error('signal exceeds max payload size');
    err.code = 'VALIDATION';
    throw err;
  }

  return signal;
}

function parseTargetedSignal(payload, maxPayloadBytes, { requireSignal = true } = {}) {
  if (!isObject(payload)) {
    const err = new Error('payload must be an object');
    err.code = 'VALIDATION';
    throw err;
  }

  const toUserId = assertNonEmptyString(payload.toUserId, 'toUserId');
  const result = { toUserId };

  if (requireSignal) {
    result.signal = assertSignal(payload.signal, maxPayloadBytes);
  } else if (payload.signal !== undefined) {
    result.signal = assertSignal(payload.signal, maxPayloadBytes);
  }

  return result;
}

function parseIce(payload, maxPayloadBytes) {
  if (!isObject(payload)) {
    const err = new Error('payload must be an object');
    err.code = 'VALIDATION';
    throw err;
  }

  return {
    toUserId: assertNonEmptyString(payload.toUserId, 'toUserId'),
    candidate: assertSignal(payload.candidate, maxPayloadBytes),
  };
}

module.exports = {
  ALLOWED_CLIENT_EVENTS,
  LEGACY_CLIENT_EVENTS,
  parseTargetedSignal,
  parseIce,
};
