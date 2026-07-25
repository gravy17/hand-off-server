'use strict';

const { test } = require('node:test');
const assert = require('node:assert/strict');
const { io: ioc } = require('socket.io-client');
const { startTestServer } = require('./helpers');

function connectClient(url, token) {
  return ioc(url, {
    transports: ['websocket'],
    forceNew: true,
    auth: { token },
  });
}

function waitFor(socket, event, timeoutMs = 2000) {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      reject(new Error(`timeout waiting for ${event}`));
    }, timeoutMs);
    socket.once(event, (payload) => {
      clearTimeout(timer);
      resolve(payload);
    });
  });
}

test('users in different rooms cannot see each other presence', async () => {
  const server = await startTestServer();

  const a = connectClient(
    server.url,
    server.tokenFor({ userId: 'a', roomId: 'room-1', name: 'A' })
  );
  const b = connectClient(
    server.url,
    server.tokenFor({ userId: 'b', roomId: 'room-2', name: 'B' })
  );

  const joinedA = await waitFor(a, 'room:joined');
  const joinedB = await waitFor(b, 'room:joined');

  assert.equal(joinedA.members.length, 1);
  assert.equal(joinedB.members.length, 1);
  assert.equal(joinedA.members[0].userId, 'a');
  assert.equal(joinedB.members[0].userId, 'b');

  let leaked = false;
  a.on('presence:update', (payload) => {
    if (payload.members.some((m) => m.userId === 'b')) {
      leaked = true;
    }
  });

  // Give a short window for any illegal cross-room event.
  await new Promise((r) => setTimeout(r, 150));
  assert.equal(leaked, false);

  a.close();
  b.close();
  await server.close();
});

test('same-room join updates peer presence', async () => {
  const server = await startTestServer();

  const a = connectClient(
    server.url,
    server.tokenFor({ userId: 'a', roomId: 'room-1', name: 'A' })
  );
  await waitFor(a, 'room:joined');

  const presencePromise = waitFor(a, 'presence:update');
  const b = connectClient(
    server.url,
    server.tokenFor({ userId: 'b', roomId: 'room-1', name: 'B' })
  );
  await waitFor(b, 'room:joined');

  const update = await presencePromise;
  assert.equal(update.reason, 'join');
  assert.equal(update.userId, 'b');
  assert.equal(update.members.length, 2);

  a.close();
  b.close();
  await server.close();
});

test('room capacity is enforced', async () => {
  const server = await startTestServer({ maxRoomSize: 1 });

  const a = connectClient(
    server.url,
    server.tokenFor({ userId: 'a', roomId: 'room-1', name: 'A' })
  );
  await waitFor(a, 'room:joined');

  const b = connectClient(
    server.url,
    server.tokenFor({ userId: 'b', roomId: 'room-1', name: 'B' })
  );

  const errEvent = waitFor(b, 'error:client');
  const disconnect = waitFor(b, 'disconnect');
  const err = await errEvent;
  assert.equal(err.code, 'ROOM_FULL');
  await disconnect;

  a.close();
  b.close();
  await server.close();
});
