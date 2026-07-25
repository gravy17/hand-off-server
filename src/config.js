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

function parseCsv(value) {
  if (!value || !String(value).trim()) {
    return [];
  }
  return String(value)
    .split(',')
    .map((part) => part.trim())
    .filter(Boolean);
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

  const turnUrls = parseCsv(env.TURN_URLS);
  const turnSharedSecret = env.TURN_SHARED_SECRET || '';
  const turnEnabled = Boolean(turnSharedSecret && turnUrls.length > 0);

  if (env.TURN_SHARED_SECRET && turnUrls.length === 0) {
    throw new Error('TURN_URLS is required when TURN_SHARED_SECRET is set');
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
    rateLimitInvitesPerMin: parsePositiveInt(env.RATE_LIMIT_INVITES_PER_MIN, 10),
    maxConnectionsPerIp: parsePositiveInt(env.MAX_CONNECTIONS_PER_IP, 20),
    connectionRatePerIpPerMin: parsePositiveInt(env.CONNECTION_RATE_PER_IP_PER_MIN, 60),
    turnEnabled,
    turnSharedSecret,
    turnUrls,
    turnTtlSeconds: parsePositiveInt(env.TURN_TTL_SECONDS, 300),
    // Render Key Value (free Redis-compatible) internal URL, e.g. redis://red-xxxxx:6379
    redisUrl: env.REDIS_URL || '',
  };
}

module.exports = { loadConfig, parseOrigins };
