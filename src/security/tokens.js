'use strict';

const jwt = require('jsonwebtoken');

function mintRoomToken({ secret, userId, name, roomId, role = 'member', ttlSeconds = 900 }) {
  if (!secret) {
    throw new Error('token secret is required');
  }
  if (!userId || !roomId) {
    throw new Error('userId and roomId are required');
  }

  return jwt.sign(
    {
      sub: String(userId),
      name: name ? String(name) : String(userId),
      roomId: String(roomId),
      role: String(role),
    },
    secret,
    {
      algorithm: 'HS256',
      expiresIn: ttlSeconds,
    }
  );
}

function verifyRoomToken(token, secret) {
  if (!token || !secret) {
    const err = new Error('missing token');
    err.code = 'AUTH_MISSING';
    throw err;
  }

  let payload;
  try {
    payload = jwt.verify(token, secret, { algorithms: ['HS256'] });
  } catch (cause) {
    const err = new Error('invalid token');
    err.code = 'AUTH_INVALID';
    err.cause = cause;
    throw err;
  }

  const userId = payload.sub;
  const roomId = payload.roomId;
  if (!userId || !roomId) {
    const err = new Error('token missing required claims');
    err.code = 'AUTH_INVALID';
    throw err;
  }

  return {
    userId: String(userId),
    name: payload.name ? String(payload.name) : String(userId),
    roomId: String(roomId),
    role: payload.role ? String(payload.role) : 'member',
  };
}

module.exports = { mintRoomToken, verifyRoomToken };
