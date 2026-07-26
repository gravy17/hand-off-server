'use strict';

const { test } = require('node:test');
const assert = require('node:assert/strict');
const { io: ioc } = require('socket.io-client');
const { startTestServer } = require('./helpers');
const { mintRoomToken, verifyRoomToken } = require('../src/security/tokens');

function connectClient(url, token) {
  return ioc(url, {
    transports: ['websocket'],
    forceNew: true,
    auth: token ? { token } : {},
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

test('mint and verify room token claims', () => {
  const token = mintRoomToken({
    secret: 's',
    userId: 'u1',
    name: 'Ada',
    roomId: 'r1',
  });
  const claims = verifyRoomToken(token, 's');
  assert.equal(claims.userId, 'u1');
  assert.equal(claims.roomId, 'r1');
  assert.equal(claims.name, 'Ada');
});

test('socket connection without token is rejected', async () => {
  const server = await startTestServer();
  const socket = connectClient(server.url);

  const err = await waitFor(socket, 'connect_error');
  assert.match(String(err.message), /token|unauthorized|missing/i);

  socket.close();
  await server.close();
});

test('socket connection with invalid token is rejected', async () => {
  const server = await startTestServer();
  const socket = connectClient(server.url, 'not-a-jwt');

  const err = await waitFor(socket, 'connect_error');
  assert.ok(err);

  socket.close();
  await server.close();
});

test('valid token joins claimed room only', async () => {
  const server = await startTestServer();
  const token = server.tokenFor({ userId: 'u1', roomId: 'room-a', name: 'Ada' });
  const socket = connectClient(server.url, token);

  const joined = await waitFor(socket, 'room:joined');
  assert.equal(joined.roomId, 'room-a');
  assert.equal(joined.self.userId, 'u1');
  assert.equal(joined.members.length, 1);

  socket.close();
  await server.close();
});

test('POST /v1/rooms/:roomId/token requires mint secret', async () => {
  const server = await startTestServer();
  const res = await fetch(`${server.url}/v1/rooms/room-a/token`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ userId: 'u1' }),
  });
  assert.equal(res.status, 401);
  await server.close();
});

test('POST /v1/rooms/:roomId/token mints usable token', async () => {
  const server = await startTestServer();
  const res = await fetch(`${server.url}/v1/rooms/room-a/token`, {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      'x-mint-secret': 'mint-secret',
    },
    body: JSON.stringify({ userId: 'u9', name: 'Grace' }),
  });
  assert.equal(res.status, 200);
  const body = await res.json();
  assert.ok(body.token);

  const socket = connectClient(server.url, body.token);
  const joined = await waitFor(socket, 'room:joined');
  assert.equal(joined.roomId, 'room-a');
  assert.equal(joined.self.userId, 'u9');

  socket.close();
  await server.close();
});
