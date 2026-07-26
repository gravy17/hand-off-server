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

async function connectPair(server, roomId = 'room-1') {
  const a = connectClient(
    server.url,
    server.tokenFor({ userId: 'alice', roomId, name: 'Alice' })
  );
  const b = connectClient(
    server.url,
    server.tokenFor({ userId: 'bob', roomId, name: 'Bob' })
  );
  await Promise.all([waitFor(a, 'room:joined'), waitFor(b, 'room:joined')]);
  return { a, b };
}

test('call invite is room-scoped and fromUserId is server-bound', async () => {
  const server = await startTestServer();
  const { a, b } = await connectPair(server);
  try {
    const incomingPromise = waitFor(b, 'call:incoming');
    a.emit('call:invite', {
      toUserId: 'bob',
      fromUserId: 'eve-the-spoof',
      signal: { type: 'offer', sdp: 'v=0' },
    });

    const incoming = await incomingPromise;
    assert.equal(incoming.fromUserId, 'alice');
    assert.equal(incoming.fromName, 'Alice');
    assert.deepEqual(incoming.signal, { type: 'offer', sdp: 'v=0' });
  } finally {
    a.close();
    b.close();
    await server.close();
  }
});

test('cross-room call invite does not deliver', async () => {
  const server = await startTestServer();

  const a = connectClient(
    server.url,
    server.tokenFor({ userId: 'alice', roomId: 'room-a', name: 'Alice' })
  );
  const b = connectClient(
    server.url,
    server.tokenFor({ userId: 'bob', roomId: 'room-b', name: 'Bob' })
  );
  await Promise.all([waitFor(a, 'room:joined'), waitFor(b, 'room:joined')]);

  try {
    let delivered = false;
    b.on('call:incoming', () => {
      delivered = true;
    });

    const errPromise = waitFor(a, 'error:client');
    a.emit('call:invite', {
      toUserId: 'bob',
      signal: { type: 'offer', sdp: 'v=0' },
    });

    const err = await errPromise;
    assert.equal(err.code, 'PEER_NOT_FOUND');
    await new Promise((r) => setTimeout(r, 100));
    assert.equal(delivered, false);
  } finally {
    a.close();
    b.close();
    await server.close();
  }
});

test('oversized signal is rejected', async () => {
  const server = await startTestServer({ maxPayloadBytes: 64 });
  const { a, b } = await connectPair(server);
  try {
    const errPromise = waitFor(a, 'error:client');
    a.emit('call:invite', {
      toUserId: 'bob',
      signal: { type: 'offer', sdp: 'x'.repeat(500) },
    });
    const err = await errPromise;
    assert.equal(err.code, 'VALIDATION');
  } finally {
    a.close();
    b.close();
    await server.close();
  }
});

test('accept and ice relay require invite first', async () => {
  const server = await startTestServer();
  const { a, b } = await connectPair(server);
  try {
    const incomingPromise = waitFor(b, 'call:incoming');
    a.emit('call:invite', {
      toUserId: 'bob',
      signal: { type: 'offer', sdp: 'v=0' },
    });
    await incomingPromise;

    const acceptedPromise = waitFor(a, 'call:accepted');
    const icePromise = waitFor(a, 'signal:ice');

    b.emit('call:accept', {
      toUserId: 'alice',
      signal: { type: 'answer', sdp: 'v=0' },
    });
    b.emit('signal:ice', {
      toUserId: 'alice',
      candidate: { candidate: 'candidate:1' },
    });

    const accepted = await acceptedPromise;
    const ice = await icePromise;
    assert.equal(accepted.fromUserId, 'bob');
    assert.equal(ice.fromUserId, 'bob');
  } finally {
    a.close();
    b.close();
    await server.close();
  }
});

test('second invite while busy is rejected', async () => {
  const server = await startTestServer();
  const a = connectClient(
    server.url,
    server.tokenFor({ userId: 'alice', roomId: 'room-1', name: 'Alice' })
  );
  const b = connectClient(
    server.url,
    server.tokenFor({ userId: 'bob', roomId: 'room-1', name: 'Bob' })
  );
  const c = connectClient(
    server.url,
    server.tokenFor({ userId: 'carol', roomId: 'room-1', name: 'Carol' })
  );
  await Promise.all([
    waitFor(a, 'room:joined'),
    waitFor(b, 'room:joined'),
    waitFor(c, 'room:joined'),
  ]);

  try {
    await new Promise((resolve) => {
      a.emit('call:invite', { toUserId: 'bob', signal: { type: 'offer', sdp: '1' } }, resolve);
    });

    const errPromise = waitFor(a, 'error:client');
    a.emit('call:invite', { toUserId: 'carol', signal: { type: 'offer', sdp: '2' } });
    const err = await errPromise;
    assert.equal(err.code, 'CALL_BUSY');
  } finally {
    a.close();
    b.close();
    c.close();
    await server.close();
  }
});

test('legacy events are rejected', async () => {
  const server = await startTestServer();
  const { a, b } = await connectPair(server);
  try {
    const errPromise = waitFor(a, 'error:client');
    a.emit('peer-msg', { type: 'REGISTER_USR', id: 'x', name: 'x' });
    const err = await errPromise;
    assert.equal(err.code, 'LEGACY_EVENT');
  } finally {
    a.close();
    b.close();
    await server.close();
  }
});

test('query-string tokens are rejected (clean break)', async () => {
  const server = await startTestServer();
  const token = server.tokenFor({ userId: 'alice', roomId: 'room-1', name: 'Alice' });
  const socket = ioc(server.url, {
    transports: ['websocket'],
    forceNew: true,
    auth: {},
    query: { token },
  });

  try {
    const err = await waitFor(socket, 'connect_error');
    assert.ok(err);
  } finally {
    socket.close();
    await server.close();
  }
});
