'use strict';

/**
 * Server-side 1:1 call state machine.
 * States: ringing -> active -> (ended)
 * One active/ringing call per user.
 */
function createCallRegistry() {
  /** @type {Map<string, { peerUserId: string, roomId: string, state: 'ringing' | 'active', initiatorUserId: string }>} */
  const byUser = new Map();

  async function get(userId) {
    return byUser.get(userId) || null;
  }

  function clearPair(userA, userB) {
    byUser.delete(userA);
    byUser.delete(userB);
  }

  async function beginInvite({ roomId, fromUserId, toUserId }) {
    if (byUser.has(fromUserId) || byUser.has(toUserId)) {
      const err = new Error('user already in a call');
      err.code = 'CALL_BUSY';
      throw err;
    }

    const record = {
      peerUserId: toUserId,
      roomId,
      state: 'ringing',
      initiatorUserId: fromUserId,
    };
    const mirror = {
      peerUserId: fromUserId,
      roomId,
      state: 'ringing',
      initiatorUserId: fromUserId,
    };
    byUser.set(fromUserId, record);
    byUser.set(toUserId, mirror);
    return record;
  }

  async function accept({ roomId, fromUserId, toUserId }) {
    const self = byUser.get(fromUserId);
    const peer = byUser.get(toUserId);
    if (!self || !peer) {
      const err = new Error('no ringing call to accept');
      err.code = 'CALL_NOT_FOUND';
      throw err;
    }
    if (self.roomId !== roomId || peer.roomId !== roomId) {
      const err = new Error('call room mismatch');
      err.code = 'CALL_NOT_FOUND';
      throw err;
    }
    if (self.peerUserId !== toUserId || peer.peerUserId !== fromUserId) {
      const err = new Error('call peer mismatch');
      err.code = 'CALL_NOT_FOUND';
      throw err;
    }
    if (self.state !== 'ringing' || peer.state !== 'ringing') {
      const err = new Error('call is not ringing');
      err.code = 'CALL_STATE';
      throw err;
    }
    if (self.initiatorUserId !== toUserId) {
      const err = new Error('only callee can accept');
      err.code = 'CALL_STATE';
      throw err;
    }

    self.state = 'active';
    peer.state = 'active';
    return self;
  }

  async function rejectOrEnd({ roomId, fromUserId, toUserId }) {
    const self = byUser.get(fromUserId);
    if (!self || self.peerUserId !== toUserId || self.roomId !== roomId) {
      const err = new Error('no matching call');
      err.code = 'CALL_NOT_FOUND';
      throw err;
    }
    clearPair(fromUserId, toUserId);
    return self;
  }

  async function assertCanSignal({ roomId, fromUserId, toUserId }) {
    const self = byUser.get(fromUserId);
    if (!self || self.peerUserId !== toUserId || self.roomId !== roomId) {
      const err = new Error('no active call for ice');
      err.code = 'CALL_NOT_FOUND';
      throw err;
    }
    if (self.state !== 'ringing' && self.state !== 'active') {
      const err = new Error('invalid call state for ice');
      err.code = 'CALL_STATE';
      throw err;
    }
  }

  async function clearUser(userId) {
    const self = byUser.get(userId);
    if (!self) {
      return null;
    }
    const peerUserId = self.peerUserId;
    clearPair(userId, peerUserId);
    return { peerUserId, roomId: self.roomId, state: self.state };
  }

  return {
    backend: 'memory',
    get,
    beginInvite,
    accept,
    rejectOrEnd,
    assertCanSignal,
    clearUser,
  };
}

/**
 * Redis-backed call registry for multi-instance deployments.
 * Keys: hof:call:{userId} -> JSON record
 */
function createRedisCallRegistry(redis, { keyPrefix = 'hof:' } = {}) {
  const key = (userId) => `${keyPrefix}call:${userId}`;

  async function read(userId) {
    const raw = await redis.get(key(userId));
    if (!raw) return null;
    try {
      return JSON.parse(raw);
    } catch {
      return null;
    }
  }

  async function writePair(fromUserId, toUserId, fromRecord, toRecord) {
    const multi = redis.multi();
    multi.set(key(fromUserId), JSON.stringify(fromRecord), { EX: 86_400 });
    multi.set(key(toUserId), JSON.stringify(toRecord), { EX: 86_400 });
    await multi.exec();
  }

  async function clearPair(userA, userB) {
    await redis.del(key(userA), key(userB));
  }

  async function get(userId) {
    return read(userId);
  }

  async function beginInvite({ roomId, fromUserId, toUserId }) {
    // Cheap exclusive lock to reduce race windows across instances.
    const lockKey = `${keyPrefix}calllock:${[fromUserId, toUserId].sort().join(':')}`;
    const locked = await redis.set(lockKey, '1', { NX: true, PX: 2000 });
    if (!locked) {
      const err = new Error('user already in a call');
      err.code = 'CALL_BUSY';
      throw err;
    }

    try {
      const [fromExisting, toExisting] = await Promise.all([
        read(fromUserId),
        read(toUserId),
      ]);
      if (fromExisting || toExisting) {
        const err = new Error('user already in a call');
        err.code = 'CALL_BUSY';
        throw err;
      }

      const record = {
        peerUserId: toUserId,
        roomId,
        state: 'ringing',
        initiatorUserId: fromUserId,
      };
      const mirror = {
        peerUserId: fromUserId,
        roomId,
        state: 'ringing',
        initiatorUserId: fromUserId,
      };
      await writePair(fromUserId, toUserId, record, mirror);
      return record;
    } finally {
      await redis.del(lockKey);
    }
  }

  async function accept({ roomId, fromUserId, toUserId }) {
    const self = await read(fromUserId);
    const peer = await read(toUserId);
    if (!self || !peer) {
      const err = new Error('no ringing call to accept');
      err.code = 'CALL_NOT_FOUND';
      throw err;
    }
    if (self.roomId !== roomId || peer.roomId !== roomId) {
      const err = new Error('call room mismatch');
      err.code = 'CALL_NOT_FOUND';
      throw err;
    }
    if (self.peerUserId !== toUserId || peer.peerUserId !== fromUserId) {
      const err = new Error('call peer mismatch');
      err.code = 'CALL_NOT_FOUND';
      throw err;
    }
    if (self.state !== 'ringing' || peer.state !== 'ringing') {
      const err = new Error('call is not ringing');
      err.code = 'CALL_STATE';
      throw err;
    }
    if (self.initiatorUserId !== toUserId) {
      const err = new Error('only callee can accept');
      err.code = 'CALL_STATE';
      throw err;
    }

    self.state = 'active';
    peer.state = 'active';
    await writePair(fromUserId, toUserId, self, peer);
    return self;
  }

  async function rejectOrEnd({ roomId, fromUserId, toUserId }) {
    const self = await read(fromUserId);
    if (!self || self.peerUserId !== toUserId || self.roomId !== roomId) {
      const err = new Error('no matching call');
      err.code = 'CALL_NOT_FOUND';
      throw err;
    }
    await clearPair(fromUserId, toUserId);
    return self;
  }

  async function assertCanSignal({ roomId, fromUserId, toUserId }) {
    const self = await read(fromUserId);
    if (!self || self.peerUserId !== toUserId || self.roomId !== roomId) {
      const err = new Error('no active call for ice');
      err.code = 'CALL_NOT_FOUND';
      throw err;
    }
    if (self.state !== 'ringing' && self.state !== 'active') {
      const err = new Error('invalid call state for ice');
      err.code = 'CALL_STATE';
      throw err;
    }
  }

  async function clearUser(userId) {
    const self = await read(userId);
    if (!self) {
      return null;
    }
    const peerUserId = self.peerUserId;
    await clearPair(userId, peerUserId);
    return { peerUserId, roomId: self.roomId, state: self.state };
  }

  return {
    backend: 'redis',
    get,
    beginInvite,
    accept,
    rejectOrEnd,
    assertCanSignal,
    clearUser,
  };
}

module.exports = { createCallRegistry, createRedisCallRegistry };
