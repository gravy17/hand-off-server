'use strict';

/**
 * In-memory, server-authoritative presence keyed by roomId -> socketId -> member.
 * Use createRedisPresenceStore when REDIS_URL is set for multi-instance.
 */
function createPresenceStore() {
  const rooms = new Map();

  function ensureRoom(roomId) {
    if (!rooms.has(roomId)) {
      rooms.set(roomId, new Map());
    }
    return rooms.get(roomId);
  }

  async function addMember(roomId, socketId, member) {
    const room = ensureRoom(roomId);
    room.set(socketId, {
      socketId,
      userId: member.userId,
      name: member.name,
      role: member.role || 'member',
    });
    return list(roomId);
  }

  async function removeMember(roomId, socketId) {
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

  async function list(roomId) {
    const room = rooms.get(roomId);
    if (!room) {
      return [];
    }
    return Array.from(room.values());
  }

  async function size(roomId) {
    const room = rooms.get(roomId);
    return room ? room.size : 0;
  }

  async function findByUserId(roomId, userId) {
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

  async function hasSocket(roomId, socketId) {
    const room = rooms.get(roomId);
    return Boolean(room && room.has(socketId));
  }

  return {
    backend: 'memory',
    addMember,
    removeMember,
    list,
    size,
    findByUserId,
    hasSocket,
  };
}

/**
 * Redis HASH presence shared across instances.
 * Keys:
 *   hof:presence:{roomId}                 HASH socketId -> JSON member
 *   hof:presence:user:{roomId}:{userId}   STRING socketId
 */
function createRedisPresenceStore(redis, { keyPrefix = 'hof:' } = {}) {
  const roomKey = (roomId) => `${keyPrefix}presence:${roomId}`;
  const userKey = (roomId, userId) => `${keyPrefix}presence:user:${roomId}:${userId}`;

  async function addMember(roomId, socketId, member) {
    const payload = {
      socketId,
      userId: member.userId,
      name: member.name,
      role: member.role || 'member',
    };
    const multi = redis.multi();
    multi.hSet(roomKey(roomId), socketId, JSON.stringify(payload));
    multi.expire(roomKey(roomId), 86_400);
    multi.set(userKey(roomId, member.userId), socketId, { EX: 86_400 });
    await multi.exec();
    return list(roomId);
  }

  async function removeMember(roomId, socketId) {
    const raw = await redis.hGet(roomKey(roomId), socketId);
    if (raw) {
      try {
        const member = JSON.parse(raw);
        const indexed = await redis.get(userKey(roomId, member.userId));
        const multi = redis.multi();
        multi.hDel(roomKey(roomId), socketId);
        if (indexed === socketId) {
          multi.del(userKey(roomId, member.userId));
        }
        await multi.exec();
      } catch {
        await redis.hDel(roomKey(roomId), socketId);
      }
    } else {
      await redis.hDel(roomKey(roomId), socketId);
    }
    return list(roomId);
  }

  async function list(roomId) {
    const all = await redis.hGetAll(roomKey(roomId));
    return Object.values(all)
      .map((raw) => {
        try {
          return JSON.parse(raw);
        } catch {
          return null;
        }
      })
      .filter(Boolean);
  }

  async function size(roomId) {
    return redis.hLen(roomKey(roomId));
  }

  async function findByUserId(roomId, userId) {
    const socketId = await redis.get(userKey(roomId, userId));
    if (!socketId) {
      // Fallback scan for consistency if index missing.
      const members = await list(roomId);
      return members.find((m) => m.userId === userId) || null;
    }
    const raw = await redis.hGet(roomKey(roomId), socketId);
    if (!raw) {
      return null;
    }
    try {
      return JSON.parse(raw);
    } catch {
      return null;
    }
  }

  async function hasSocket(roomId, socketId) {
    return Boolean(await redis.hExists(roomKey(roomId), socketId));
  }

  return {
    backend: 'redis',
    addMember,
    removeMember,
    list,
    size,
    findByUserId,
    hasSocket,
  };
}

module.exports = { createPresenceStore, createRedisPresenceStore };
