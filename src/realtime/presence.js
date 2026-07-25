'use strict';

/**
 * In-memory, server-authoritative presence keyed by roomId -> socketId -> member.
 * Not shared across processes; Redis can replace this later.
 */
function createPresenceStore() {
  const rooms = new Map();

  function ensureRoom(roomId) {
    if (!rooms.has(roomId)) {
      rooms.set(roomId, new Map());
    }
    return rooms.get(roomId);
  }

  function addMember(roomId, socketId, member) {
    const room = ensureRoom(roomId);
    room.set(socketId, {
      socketId,
      userId: member.userId,
      name: member.name,
      role: member.role || 'member',
    });
    return list(roomId);
  }

  function removeMember(roomId, socketId) {
    const room = rooms.get(roomId);
    if (!room) {
      return [];
    }
    room.delete(socketId);
    if (room.size === 0) {
      rooms.delete(roomId);
      return [];
    }
    return list(roomId);
  }

  function list(roomId) {
    const room = rooms.get(roomId);
    if (!room) {
      return [];
    }
    return Array.from(room.values());
  }

  function size(roomId) {
    const room = rooms.get(roomId);
    return room ? room.size : 0;
  }

  function findByUserId(roomId, userId) {
    const room = rooms.get(roomId);
    if (!room) {
      return null;
    }
    for (const member of room.values()) {
      if (member.userId === userId) {
        return member;
      }
    }
    return null;
  }

  function hasSocket(roomId, socketId) {
    const room = rooms.get(roomId);
    return Boolean(room && room.has(socketId));
  }

  return {
    addMember,
    removeMember,
    list,
    size,
    findByUserId,
    hasSocket,
  };
}

module.exports = { createPresenceStore };
