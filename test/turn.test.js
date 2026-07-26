'use strict';

const { test } = require('node:test');
const assert = require('node:assert/strict');
const crypto = require('crypto');
const { startTestServer } = require('./helpers');
const { mintTurnCredentials } = require('../src/turn/credentials');

test('mintTurnCredentials uses coturn REST shape', () => {
  const nowMs = 1_700_000_000_000;
  const creds = mintTurnCredentials({
    sharedSecret: 's3cret',
    urls: ['turn:example:3478'],
    userId: 'alice',
    ttlSeconds: 300,
    nowMs,
  });

  const expiry = Math.floor(nowMs / 1000) + 300;
  assert.equal(creds.username, `${expiry}:alice`);
  const expected = crypto.createHmac('sha1', 's3cret').update(creds.username).digest('base64');
  assert.equal(creds.credential, expected);
  assert.deepEqual(creds.urls, ['turn:example:3478']);
});

test('POST /v1/turn/credentials requires auth and config', async () => {
  const disabled = await startTestServer();
  const denied = await fetch(`${disabled.url}/v1/turn/credentials`, { method: 'POST' });
  assert.equal(denied.status, 401);
  await disabled.close();

  const server = await startTestServer({
    turnSharedSecret: 'turn-secret',
    turnUrls: ['turn:example:3478'],
  });
  try {
    const noAuth = await fetch(`${server.url}/v1/turn/credentials`, { method: 'POST' });
    assert.equal(noAuth.status, 401);

    const token = server.tokenFor({ userId: 'alice', roomId: 'room-1', name: 'Alice' });
    const res = await fetch(`${server.url}/v1/turn/credentials`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${token}` },
    });
    assert.equal(res.status, 200);
    const body = await res.json();
    assert.ok(body.username.endsWith(':alice'));
    assert.ok(body.credential);
    assert.deepEqual(body.urls, ['turn:example:3478']);
  } finally {
    await server.close();
  }
});
