'use strict';

function attachRoomHandlers({ io, socket, presence, config, logger }) {
  const { roomId, userId, name, role } = socket.data;

  if (presence.size(roomId) >= config.maxRoomSize) {
    const err = new Error('room is full');
    err.data = { content: 'ROOM_FULL' };
    throw err;
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
