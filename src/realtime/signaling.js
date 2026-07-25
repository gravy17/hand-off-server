'use strict';

const { parseTargetedSignal, parseIce, ALLOWED_CLIENT_EVENTS, LEGACY_CLIENT_EVENTS } = require('./events');

function emitError(socket, code, message) {
  socket.emit('error:client', { code, message });
}

function attachSignalingHandlers({
  socket,
  presence,
  calls,
  config,
  rateLimiter,
  inviteRateLimiter,
  logger,
}) {
  const roomId = socket.data.roomId;

  function withRateLimit(handler) {
    return (payload, ack) => {
      if (!rateLimiter(socket.id)) {
        emitError(socket, 'RATE_LIMIT', 'too many events');
        if (typeof ack === 'function') {
          ack({ ok: false, code: 'RATE_LIMIT' });
        }
        return;
      }
      try {
        handler(payload, ack);
      } catch (err) {
        const code = err.code || 'ERROR';
        emitError(socket, code, err.message);
        if (typeof ack === 'function') {
          ack({ ok: false, code, message: err.message });
        }
        if (
          code !== 'VALIDATION' &&
          code !== 'PEER_NOT_FOUND' &&
          code !== 'RATE_LIMIT' &&
          code !== 'CALL_BUSY' &&
          code !== 'CALL_NOT_FOUND' &&
          code !== 'CALL_STATE' &&
          code !== 'INVITE_RATE_LIMIT'
        ) {
          logger.warn('signaling handler error', {
            socketId: socket.id,
            roomId,
            err,
          });
        }
      }
    };
  }

  function resolvePeer(toUserId) {
    if (toUserId === socket.data.userId) {
      const err = new Error('cannot signal yourself');
      err.code = 'VALIDATION';
      throw err;
    }

    const peer = presence.findByUserId(roomId, toUserId);
    if (!peer) {
      const err = new Error('peer not in room');
      err.code = 'PEER_NOT_FOUND';
      throw err;
    }
    return peer;
  }

  function ok(ack, extra = {}) {
    if (typeof ack === 'function') {
      ack({ ok: true, ...extra });
    }
  }

  socket.onAny((eventName) => {
    if (ALLOWED_CLIENT_EVENTS.has(eventName)) {
      return;
    }
    if (LEGACY_CLIENT_EVENTS.has(eventName)) {
      emitError(
        socket,
        'LEGACY_EVENT',
        `legacy event "${eventName}" is not supported; see docs/MIGRATION.md`
      );
      return;
    }
    if (eventName.startsWith('call:') || eventName.startsWith('signal:')) {
      emitError(socket, 'UNKNOWN_EVENT', `unknown event "${eventName}"`);
    }
  });

  socket.on(
    'call:invite',
    withRateLimit((payload, ack) => {
      if (!inviteRateLimiter(socket.data.userId)) {
        const err = new Error('invite rate limit exceeded');
        err.code = 'INVITE_RATE_LIMIT';
        throw err;
      }
      const { toUserId, signal } = parseTargetedSignal(payload, config.maxPayloadBytes);
      const peer = resolvePeer(toUserId);
      calls.beginInvite({
        roomId,
        fromUserId: socket.data.userId,
        toUserId,
      });
      socket.to(peer.socketId).emit('call:incoming', {
        fromUserId: socket.data.userId,
        fromName: socket.data.name,
        signal,
      });
      ok(ack);
    })
  );

  socket.on(
    'call:accept',
    withRateLimit((payload, ack) => {
      const { toUserId, signal } = parseTargetedSignal(payload, config.maxPayloadBytes);
      const peer = resolvePeer(toUserId);
      calls.accept({
        roomId,
        fromUserId: socket.data.userId,
        toUserId,
      });
      socket.to(peer.socketId).emit('call:accepted', {
        fromUserId: socket.data.userId,
        signal,
      });
      ok(ack);
    })
  );

  socket.on(
    'call:reject',
    withRateLimit((payload, ack) => {
      const { toUserId } = parseTargetedSignal(payload, config.maxPayloadBytes, {
        requireSignal: false,
      });
      const peer = resolvePeer(toUserId);
      calls.rejectOrEnd({
        roomId,
        fromUserId: socket.data.userId,
        toUserId,
      });
      socket.to(peer.socketId).emit('call:rejected', {
        fromUserId: socket.data.userId,
      });
      ok(ack);
    })
  );

  socket.on(
    'call:end',
    withRateLimit((payload, ack) => {
      const { toUserId } = parseTargetedSignal(payload, config.maxPayloadBytes, {
        requireSignal: false,
      });
      const peer = resolvePeer(toUserId);
      calls.rejectOrEnd({
        roomId,
        fromUserId: socket.data.userId,
        toUserId,
      });
      socket.to(peer.socketId).emit('call:ended', {
        fromUserId: socket.data.userId,
      });
      ok(ack);
    })
  );

  socket.on(
    'signal:ice',
    withRateLimit((payload, ack) => {
      const { toUserId, candidate } = parseIce(payload, config.maxPayloadBytes);
      const peer = resolvePeer(toUserId);
      calls.assertCanSignal({
        roomId,
        fromUserId: socket.data.userId,
        toUserId,
      });
      socket.to(peer.socketId).emit('signal:ice', {
        fromUserId: socket.data.userId,
        candidate,
      });
      ok(ack);
    })
  );

  socket.on('disconnect', () => {
    const cleared = calls.clearUser(socket.data.userId);
    if (!cleared) {
      return;
    }
    const peer = presence.findByUserId(roomId, cleared.peerUserId);
    if (peer) {
      socket.to(peer.socketId).emit('call:ended', {
        fromUserId: socket.data.userId,
        reason: 'disconnect',
      });
    }
  });
}

module.exports = { attachSignalingHandlers };
