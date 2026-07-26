'use strict';

const { test } = require('node:test');
const assert = require('node:assert/strict');
const { createCallRegistry } = require('../src/realtime/calls');

test('call registry supports multi-peer mesh and accept rules', async () => {
  const calls = createCallRegistry();
  await calls.beginInvite({ roomId: 'r1', fromUserId: 'a', toUserId: 'b' });

  // Same pair is busy; a different peer is allowed (mesh).
  await assert.rejects(
    () => calls.beginInvite({ roomId: 'r1', fromUserId: 'a', toUserId: 'b' }),
    (err) => err.code === 'CALL_BUSY'
  );
  await calls.beginInvite({ roomId: 'r1', fromUserId: 'a', toUserId: 'c' });
  assert.equal((await calls.listForUser('a')).length, 2);

  await assert.rejects(
    () => calls.accept({ roomId: 'r1', fromUserId: 'a', toUserId: 'b' }),
    (err) => err.code === 'CALL_STATE'
  );

  await calls.accept({ roomId: 'r1', fromUserId: 'b', toUserId: 'a' });
  assert.equal((await calls.get('a', 'b')).state, 'active');
  assert.equal((await calls.get('b', 'a')).state, 'active');

  await calls.assertCanSignal({
    roomId: 'r1',
    fromUserId: 'a',
    toUserId: 'b',
    requireActive: true,
  });

  await calls.rejectOrEnd({ roomId: 'r1', fromUserId: 'a', toUserId: 'b' });
  assert.equal(await calls.get('a', 'b'), null);
  assert.equal((await calls.get('a', 'c')).state, 'ringing');

  const cleared = await calls.clearUser('a');
  assert.equal(cleared.length, 1);
  assert.equal(cleared[0].peerUserId, 'c');
  assert.equal(await calls.get('c', 'a'), null);
});
