'use strict';

/**
 * Server-side 1:1 call state machine.
 * States: ringing -> active -> (ended)
 * One active/ringing call per user.
 */
function createCallRegistry() {
  /** @type {Map<string, { peerUserId: string, roomId: string, state: 'ringing' | 'active', initiatorUserId: string }>} */
  const byUser = new Map();

  function get(userId) {
    return byUser.get(userId) || null;
  }

  function clearPair(userA, userB) {
    byUser.delete(userA);
    byUser.delete(userB);
  }

  function beginInvite({ roomId, fromUserId, toUserId }) {
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

  function accept({ roomId, fromUserId, toUserId }) {
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
    // Callee accepts; initiator must be toUserId
    if (self.initiatorUserId !== toUserId) {
      const err = new Error('only callee can accept');
      err.code = 'CALL_STATE';
      throw err;
    }

    self.state = 'active';
    peer.state = 'active';
    return self;
  }

  function rejectOrEnd({ roomId, fromUserId, toUserId }) {
    const self = byUser.get(fromUserId);
    if (!self || self.peerUserId !== toUserId || self.roomId !== roomId) {
      const err = new Error('no matching call');
      err.code = 'CALL_NOT_FOUND';
      throw err;
    }
    clearPair(fromUserId, toUserId);
    return self;
  }

  function assertCanSignal({ roomId, fromUserId, toUserId }) {
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

  function clearUser(userId) {
    const self = byUser.get(userId);
    if (!self) {
      return null;
    }
    const peerUserId = self.peerUserId;
    clearPair(userId, peerUserId);
    return { peerUserId, roomId: self.roomId, state: self.state };
  }

  return {
    get,
    beginInvite,
    accept,
    rejectOrEnd,
    assertCanSignal,
    clearUser,
  };
}

module.exports = { createCallRegistry };
