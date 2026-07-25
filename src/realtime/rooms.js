'use strict';

async function attachRoomHandlers({ io, socket, presence, calls, config, logger }) {
  const { roomId, userId, name, role } = socket.data;

  if ((await presence.size(roomId)) >= config.maxRoomSize) {
    const err = new Error('room is full');
    err.data = { content: 'ROOM_FULL' };
    throw err;
  }

  // Session takeover: one socket per userId per room (works across instances via adapter).
  const existing = await presence.findByUserId(roomId, userId);
  if (existing && existing.socketId !== socket.id) {
    io.in(existing.socketId).disconnectSockets(true);
    await presence.removeMember(roomId, existing.socketId);
    const cleared = await calls.clearUser(userId);
    if (cleared) {
      const peer = await presence.findByUserId(roomId, cleared.peerUserId);
      if (peer) {
        io.to(peer.socketId).emit('call:ended', {
          fromUserId: userId,
          reason: 'session_replaced',
        });
      }
    }
  }

  socket.join(roomId);
  const roster = await presence.addMember(roomId, socket.id, { userId, name, role });

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
    presenceBackend: presence.backend,
  });

  socket.on('disconnect', (reason) => {
    // Fire-and-forget async cleanup; Socket.IO disconnect handlers can't be async reliably.
    (async () => {
      if (!(await presence.hasSocket(roomId, socket.id))) {
        return;
      }
      const nextRoster = await presence.removeMember(roomId, socket.id);
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
    })().catch((err) => {
      logger.error('presence cleanup failed', { err, socketId: socket.id, roomId, userId });
    });
  });
}

module.exports = { attachRoomHandlers };
