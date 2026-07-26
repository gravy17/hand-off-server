'use strict';

function pairId(userA, userB) {
  return [userA, userB].sort().join(':');
}

/**
 * Multi-peer call registry: each user may have concurrent 1:1 links to many peers.
 * Busy only when the same pair already has a ringing/active call.
 * States: ringing -> active -> (ended)
 */
function createCallRegistry() {
  /** @type {Map<string, Map<string, { peerUserId: string, roomId: string, state: 'ringing' | 'active', initiatorUserId: string }>>} */
  const byUser = new Map();

  function edge(userId, peerUserId) {
    return byUser.get(userId)?.get(peerUserId) || null;
  }

  function setEdge(userId, peerUserId, record) {
    if (!byUser.has(userId)) {
      byUser.set(userId, new Map());
    }
    byUser.get(userId).set(peerUserId, record);
  }

  function deletePair(userA, userB) {
    byUser.get(userA)?.delete(userB);
    byUser.get(userB)?.delete(userA);
    if (byUser.get(userA)?.size === 0) byUser.delete(userA);
    if (byUser.get(userB)?.size === 0) byUser.delete(userB);
  }

  async function get(userId, peerUserId) {
    if (!peerUserId) {
      // Backward-compatible: first edge if any.
      const edges = byUser.get(userId);
      if (!edges || edges.size === 0) return null;
      return edges.values().next().value;
    }
    return edge(userId, peerUserId);
  }

  async function listForUser(userId) {
    const edges = byUser.get(userId);
    return edges ? Array.from(edges.values()) : [];
  }

  async function beginInvite({ roomId, fromUserId, toUserId }) {
    if (edge(fromUserId, toUserId) || edge(toUserId, fromUserId)) {
      const err = new Error('call with this peer already exists');
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
    setEdge(fromUserId, toUserId, record);
    setEdge(toUserId, fromUserId, mirror);
    return record;
  }

  async function accept({ roomId, fromUserId, toUserId }) {
    const self = edge(fromUserId, toUserId);
    const peer = edge(toUserId, fromUserId);
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
    const self = edge(fromUserId, toUserId);
    if (!self || self.roomId !== roomId) {
      const err = new Error('no matching call');
      err.code = 'CALL_NOT_FOUND';
      throw err;
    }
    deletePair(fromUserId, toUserId);
    return self;
  }

  async function assertCanSignal({ roomId, fromUserId, toUserId, requireActive = false }) {
    const self = edge(fromUserId, toUserId);
    if (!self || self.roomId !== roomId) {
      const err = new Error('no call for signaling');
      err.code = 'CALL_NOT_FOUND';
      throw err;
    }
    if (requireActive) {
      if (self.state !== 'active') {
        const err = new Error('call must be active for renegotiation');
        err.code = 'CALL_STATE';
        throw err;
      }
      return;
    }
    if (self.state !== 'ringing' && self.state !== 'active') {
      const err = new Error('invalid call state for signaling');
      err.code = 'CALL_STATE';
      throw err;
    }
  }

  async function clearUser(userId) {
    const edges = byUser.get(userId);
    if (!edges || edges.size === 0) {
      return [];
    }
    const cleared = Array.from(edges.values()).map((record) => ({
      peerUserId: record.peerUserId,
      roomId: record.roomId,
      state: record.state,
    }));
    for (const { peerUserId } of cleared) {
      deletePair(userId, peerUserId);
    }
    return cleared;
  }

  return {
    backend: 'memory',
    pairId,
    get,
    listForUser,
    beginInvite,
    accept,
    rejectOrEnd,
    assertCanSignal,
    clearUser,
  };
}

/**
 * Redis-backed multi-peer call registry.
 * Keys:
 *   hof:call:pair:{sortedUserIds} -> JSON { roomId, state, initiatorUserId, users:[a,b] }
 *   hof:call:user:{userId}        -> SET of peer userIds
 */
function createRedisCallRegistry(redis, { keyPrefix = 'hof:' } = {}) {
  const pairKey = (userA, userB) => `${keyPrefix}call:pair:${pairId(userA, userB)}`;
  const userKey = (userId) => `${keyPrefix}call:user:${userId}`;

  async function readPair(userA, userB) {
    const raw = await redis.get(pairKey(userA, userB));
    if (!raw) return null;
    try {
      return JSON.parse(raw);
    } catch {
      return null;
    }
  }

  function toEdge(pair, userId) {
    if (!pair) return null;
    const peerUserId = pair.users[0] === userId ? pair.users[1] : pair.users[0];
    return {
      peerUserId,
      roomId: pair.roomId,
      state: pair.state,
      initiatorUserId: pair.initiatorUserId,
    };
  }

  async function writePair(userA, userB, pair) {
    const multi = redis.multi();
    multi.set(pairKey(userA, userB), JSON.stringify(pair), { EX: 86_400 });
    multi.sAdd(userKey(userA), userB);
    multi.sAdd(userKey(userB), userA);
    multi.expire(userKey(userA), 86_400);
    multi.expire(userKey(userB), 86_400);
    await multi.exec();
  }

  async function deletePair(userA, userB) {
    const multi = redis.multi();
    multi.del(pairKey(userA, userB));
    multi.sRem(userKey(userA), userB);
    multi.sRem(userKey(userB), userA);
    await multi.exec();
  }

  async function get(userId, peerUserId) {
    if (!peerUserId) {
      const peers = await redis.sMembers(userKey(userId));
      if (!peers.length) return null;
      return toEdge(await readPair(userId, peers[0]), userId);
    }
    return toEdge(await readPair(userId, peerUserId), userId);
  }

  async function listForUser(userId) {
    const peers = await redis.sMembers(userKey(userId));
    const out = [];
    for (const peerUserId of peers) {
      const edge = toEdge(await readPair(userId, peerUserId), userId);
      if (edge) out.push(edge);
    }
    return out;
  }

  async function beginInvite({ roomId, fromUserId, toUserId }) {
    const lockKey = `${keyPrefix}calllock:${pairId(fromUserId, toUserId)}`;
    const locked = await redis.set(lockKey, '1', { NX: true, PX: 2000 });
    if (!locked) {
      const err = new Error('call with this peer already exists');
      err.code = 'CALL_BUSY';
      throw err;
    }

    try {
      const existing = await readPair(fromUserId, toUserId);
      if (existing) {
        const err = new Error('call with this peer already exists');
        err.code = 'CALL_BUSY';
        throw err;
      }

      const pair = {
        users: [fromUserId, toUserId].sort(),
        roomId,
        state: 'ringing',
        initiatorUserId: fromUserId,
      };
      await writePair(fromUserId, toUserId, pair);
      return toEdge(pair, fromUserId);
    } finally {
      await redis.del(lockKey);
    }
  }

  async function accept({ roomId, fromUserId, toUserId }) {
    const pair = await readPair(fromUserId, toUserId);
    if (!pair) {
      const err = new Error('no ringing call to accept');
      err.code = 'CALL_NOT_FOUND';
      throw err;
    }
    if (pair.roomId !== roomId) {
      const err = new Error('call room mismatch');
      err.code = 'CALL_NOT_FOUND';
      throw err;
    }
    if (pair.state !== 'ringing') {
      const err = new Error('call is not ringing');
      err.code = 'CALL_STATE';
      throw err;
    }
    if (pair.initiatorUserId !== toUserId) {
      const err = new Error('only callee can accept');
      err.code = 'CALL_STATE';
      throw err;
    }

    pair.state = 'active';
    await writePair(fromUserId, toUserId, pair);
    return toEdge(pair, fromUserId);
  }

  async function rejectOrEnd({ roomId, fromUserId, toUserId }) {
    const pair = await readPair(fromUserId, toUserId);
    if (!pair || pair.roomId !== roomId) {
      const err = new Error('no matching call');
      err.code = 'CALL_NOT_FOUND';
      throw err;
    }
    const edge = toEdge(pair, fromUserId);
    await deletePair(fromUserId, toUserId);
    return edge;
  }

  async function assertCanSignal({ roomId, fromUserId, toUserId, requireActive = false }) {
    const pair = await readPair(fromUserId, toUserId);
    if (!pair || pair.roomId !== roomId) {
      const err = new Error('no call for signaling');
      err.code = 'CALL_NOT_FOUND';
      throw err;
    }
    if (requireActive) {
      if (pair.state !== 'active') {
        const err = new Error('call must be active for renegotiation');
        err.code = 'CALL_STATE';
        throw err;
      }
      return;
    }
    if (pair.state !== 'ringing' && pair.state !== 'active') {
      const err = new Error('invalid call state for signaling');
      err.code = 'CALL_STATE';
      throw err;
    }
  }

  async function clearUser(userId) {
    const peers = await redis.sMembers(userKey(userId));
    const cleared = [];
    for (const peerUserId of peers) {
      const pair = await readPair(userId, peerUserId);
      if (pair) {
        cleared.push({
          peerUserId,
          roomId: pair.roomId,
          state: pair.state,
        });
      }
      await deletePair(userId, peerUserId);
    }
    return cleared;
  }

  return {
    backend: 'redis',
    pairId,
    get,
    listForUser,
    beginInvite,
    accept,
    rejectOrEnd,
    assertCanSignal,
    clearUser,
  };
}

module.exports = { createCallRegistry, createRedisCallRegistry, pairId };
