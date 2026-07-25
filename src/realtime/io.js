'use strict';

const { Server } = require('socket.io');
const { verifyRoomToken } = require('../security/tokens');
const {
  createEventRateLimiter,
  createInviteRateLimiter,
  createConnectionGuard,
} = require('../security/rateLimit');
const { createPresenceStore, createRedisPresenceStore } = require('./presence');
const { createCallRegistry, createRedisCallRegistry } = require('./calls');
const { connectRedis } = require('./redisClients');
const { attachRoomHandlers } = require('./rooms');
const { attachSignalingHandlers } = require('./signaling');

async function createSocketServer(httpServer, config, logger) {
  let redis = null;
  let presence = createPresenceStore();
  let calls = createCallRegistry();

  if (config.redisUrl) {
    redis = await connectRedis(config.redisUrl, logger);
    presence = createRedisPresenceStore(redis.dataClient);
    calls = createRedisCallRegistry(redis.dataClient);
    logger.info('redis connected for socket adapter and shared state');
  }

  const rateLimiter = createEventRateLimiter({
    limitPerSec: config.rateLimitEventsPerSec,
  });
  const inviteRateLimiter = createInviteRateLimiter({
    limitPerMin: config.rateLimitInvitesPerMin,
  });
  const connectionGuard = createConnectionGuard({
    maxConnectionsPerIp: config.maxConnectionsPerIp,
    connectionRatePerIpPerMin: config.connectionRatePerIpPerMin,
  });

  const io = new Server(httpServer, {
    // Keep the transport buffer comfortably above app-level signal limits so
    // handshake/control packets are not rejected when MAX_PAYLOAD_BYTES is tight.
    maxHttpBufferSize: Math.max(config.maxPayloadBytes, 1_000_000),
    cors: {
      origin(origin, callback) {
        // Non-browser clients may omit Origin.
        if (!origin) {
          callback(null, true);
          return;
        }
        if (!config.isProduction && config.allowedOrigins.length === 0) {
          callback(null, true);
          return;
        }
        if (config.allowedOrigins.includes(origin)) {
          callback(null, true);
          return;
        }
        callback(new Error('origin not allowed'));
      },
      methods: ['GET', 'POST'],
    },
  });

  if (redis) {
    io.adapter(redis.adapter);
  }

  io.use((socket, next) => {
    try {
      // Rate-limit and cap checks run before auth so failed handshakes still count.
      connectionGuard.assertCanConnect(socket);

      const token =
        socket.handshake.auth?.token ||
        extractBearer(socket.handshake.headers?.authorization);

      // Clean break: query-string tokens are no longer accepted.
      const claims = verifyRoomToken(token, config.roomTokenSecret);
      socket.data.userId = claims.userId;
      socket.data.name = claims.name;
      socket.data.roomId = claims.roomId;
      socket.data.role = claims.role;
      next();
    } catch (err) {
      const error = new Error(err.message || 'unauthorized');
      error.data = { content: err.code || 'AUTH_INVALID' };
      next(error);
    }
  });

  io.on('connection', (socket) => {
    connectionGuard.track(socket);

    Promise.resolve()
      .then(() => attachRoomHandlers({ io, socket, presence, calls, config, logger }))
      .then(() => {
        attachSignalingHandlers({
          socket,
          presence,
          calls,
          config,
          rateLimiter,
          inviteRateLimiter,
          logger,
        });
      })
      .catch((err) => {
        logger.warn('connection rejected after auth', {
          socketId: socket.id,
          roomId: socket.data.roomId,
          userId: socket.data.userId,
          err,
        });
        socket.emit('error:client', {
          code: err.data?.content || 'CONNECT_REJECTED',
          message: err.message,
        });
        socket.disconnect(true);
      });
  });

  async function closeRedis() {
    if (redis) {
      await redis.close();
    }
  }

  return {
    io,
    presence,
    calls,
    redis,
    pingRedis: redis ? () => redis.ping() : async () => true,
    closeRedis,
  };
}

function extractBearer(header) {
  if (!header || typeof header !== 'string') {
    return undefined;
  }
  const [scheme, token] = header.split(' ');
  if (scheme?.toLowerCase() !== 'bearer' || !token) {
    return undefined;
  }
  return token;
}

module.exports = { createSocketServer };
