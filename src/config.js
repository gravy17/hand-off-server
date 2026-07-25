'use strict';

function parseOrigins(value) {
  if (!value || !String(value).trim()) {
    return [];
  }
  return String(value)
    .split(',')
    .map((origin) => origin.trim())
    .filter(Boolean);
}

function parsePositiveInt(value, fallback) {
  const n = Number.parseInt(value, 10);
  return Number.isFinite(n) && n > 0 ? n : fallback;
}

function loadConfig(env = process.env) {
  const nodeEnv = env.NODE_ENV || 'development';
  const isProduction = nodeEnv === 'production';

  const roomTokenSecret = env.ROOM_TOKEN_SECRET || (isProduction ? '' : 'dev-room-token-secret-change-me');
  const mintSecret = env.MINT_SECRET || (isProduction ? '' : roomTokenSecret);
  const allowedOrigins = parseOrigins(env.ALLOWED_ORIGINS);

  if (isProduction && !env.ROOM_TOKEN_SECRET) {
    throw new Error('ROOM_TOKEN_SECRET is required in production');
  }

  if (isProduction && allowedOrigins.length === 0) {
    throw new Error('ALLOWED_ORIGINS is required in production');
  }

  return {
    nodeEnv,
    isProduction,
    port: parsePositiveInt(env.PORT, 8989),
    roomTokenSecret,
    mintSecret,
    allowedOrigins,
    maxRoomSize: parsePositiveInt(env.MAX_ROOM_SIZE, 8),
    maxPayloadBytes: parsePositiveInt(env.MAX_PAYLOAD_BYTES, 16384),
    tokenTtlSeconds: parsePositiveInt(env.TOKEN_TTL_SECONDS, 900),
    rateLimitEventsPerSec: parsePositiveInt(env.RATE_LIMIT_EVENTS_PER_SEC, 20),
  };
}

module.exports = { loadConfig, parseOrigins };
