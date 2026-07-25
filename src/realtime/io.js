'use strict';

const { Server } = require('socket.io');
const { verifyRoomToken } = require('../security/tokens');
const { createEventRateLimiter } = require('../security/rateLimit');
const { createPresenceStore } = require('./presence');
const { attachRoomHandlers } = require('./rooms');
const { attachSignalingHandlers } = require('./signaling');

function createSocketServer(httpServer, config, logger) {
  const presence = createPresenceStore();
  const rateLimiter = createEventRateLimiter({
    limitPerSec: config.rateLimitEventsPerSec,
  });

  const io = new Server(httpServer, {
    maxHttpBufferSize: config.maxPayloadBytes,
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

  io.use((socket, next) => {
    try {
      const token =
        socket.handshake.auth?.token ||
        socket.handshake.query?.token ||
        extractBearer(socket.handshake.headers?.authorization);

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
    try {
      attachRoomHandlers({ io, socket, presence, config, logger });
      attachSignalingHandlers({ socket, presence, config, rateLimiter, logger });
    } catch (err) {
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
    }
  });

  return { io, presence };
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
