'use strict';

function attachRoomHandlers({ io, socket, presence, calls, config, logger }) {
  const { roomId, userId, name, role } = socket.data;

  if (presence.size(roomId) >= config.maxRoomSize) {
    const err = new Error('room is full');
    err.data = { content: 'ROOM_FULL' };
    throw err;
  }

  // Session takeover: one socket per userId per room.
  const existing = presence.findByUserId(roomId, userId);
  if (existing && existing.socketId !== socket.id) {
    const previous = io.sockets.sockets.get(existing.socketId);
    if (previous) {
      previous.emit('error:client', {
        code: 'SESSION_REPLACED',
        message: 'connected from another session',
      });
      previous.disconnect(true);
    }
    presence.removeMember(roomId, existing.socketId);
    const cleared = calls.clearUser(userId);
    if (cleared) {
      const peer = presence.findByUserId(roomId, cleared.peerUserId);
      if (peer) {
        io.to(peer.socketId).emit('call:ended', {
          fromUserId: userId,
          reason: 'session_replaced',
        });
      }
    }
  }

  socket.join(roomId);
  const roster = presence.addMember(roomId, socket.id, { userId, name, role });

  socket.emit('room:joined', {
    roomId,
    self: { socketId: socket.id, userId, name, role },
    members: roster,
  });

  socket.to(roomId).emit('presence:update', {
    roomId,
    members: roster,
    reason: 'join',
    userId,
  });

  logger.info('socket joined room', {
    socketId: socket.id,
    roomId,
    userId,
    members: roster.length,
  });

  socket.on('disconnect', (reason) => {
    // Skip if this socket was already removed by a session takeover.
    if (!presence.hasSocket(roomId, socket.id)) {
      return;
    }
    const nextRoster = presence.removeMember(roomId, socket.id);
    socket.to(roomId).emit('presence:update', {
      roomId,
      members: nextRoster,
      reason: 'leave',
      userId,
    });
    logger.info('socket left room', {
      socketId: socket.id,
      roomId,
      userId,
      reason,
      members: nextRoster.length,
    });
  });
}

module.exports = { attachRoomHandlers };
