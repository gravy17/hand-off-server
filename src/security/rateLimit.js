'use strict';

function createSlidingWindowLimiter({ limit, windowMs }) {
  const buckets = new Map();

  function allow(key) {
    const now = Date.now();
    const windowStart = now - windowMs;
    let timestamps = buckets.get(key);

    if (!timestamps) {
      timestamps = [];
      buckets.set(key, timestamps);
    }

    while (timestamps.length && timestamps[0] < windowStart) {
      timestamps.shift();
    }

    if (timestamps.length >= limit) {
      return false;
    }

    timestamps.push(now);
    return true;
  }

  function reset(key) {
    buckets.delete(key);
  }

  return { allow, reset };
}

function createEventRateLimiter({ limitPerSec }) {
  const limiter = createSlidingWindowLimiter({
    limit: limitPerSec,
    windowMs: 1000,
  });
  return (socketId) => limiter.allow(socketId);
}

function createInviteRateLimiter({ limitPerMin }) {
  const limiter = createSlidingWindowLimiter({
    limit: limitPerMin,
    windowMs: 60_000,
  });
  return (userId) => limiter.allow(userId);
}

function createConnectionGuard({ maxConnectionsPerIp, connectionRatePerIpPerMin }) {
  const activeByIp = new Map();
  const connectLimiter = createSlidingWindowLimiter({
    limit: connectionRatePerIpPerMin,
    windowMs: 60_000,
  });

  function clientIp(socket) {
    const forwarded = socket.handshake.headers['x-forwarded-for'];
    if (typeof forwarded === 'string' && forwarded.trim()) {
      return forwarded.split(',')[0].trim();
    }
    return socket.handshake.address || 'unknown';
  }

  function assertCanConnect(socket) {
    const ip = clientIp(socket);
    socket.data.clientIp = ip;

    if (!connectLimiter.allow(ip)) {
      const err = new Error('connection rate limit exceeded');
      err.code = 'CONN_RATE_LIMIT';
      throw err;
    }

    const active = activeByIp.get(ip) || 0;
    if (active >= maxConnectionsPerIp) {
      const err = new Error('too many connections from this address');
      err.code = 'CONN_LIMIT';
      throw err;
    }
  }

  function track(socket) {
    const ip = socket.data.clientIp || clientIp(socket);
    socket.data.clientIp = ip;
    activeByIp.set(ip, (activeByIp.get(ip) || 0) + 1);

    socket.on('disconnect', () => {
      const next = (activeByIp.get(ip) || 1) - 1;
      if (next <= 0) {
        activeByIp.delete(ip);
      } else {
        activeByIp.set(ip, next);
      }
    });
  }

  return { assertCanConnect, track, clientIp };
}

module.exports = {
  createEventRateLimiter,
  createInviteRateLimiter,
  createConnectionGuard,
  createSlidingWindowLimiter,
};
