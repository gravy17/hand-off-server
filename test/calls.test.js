'use strict';

const { test } = require('node:test');
const assert = require('node:assert/strict');
const { createCallRegistry } = require('../src/realtime/calls');

test('call registry enforces one call and accept rules', async () => {
  const calls = createCallRegistry();
  await calls.beginInvite({ roomId: 'r1', fromUserId: 'a', toUserId: 'b' });

  await assert.rejects(
    () => calls.beginInvite({ roomId: 'r1', fromUserId: 'a', toUserId: 'c' }),
    (err) => err.code === 'CALL_BUSY'
  );

  await assert.rejects(
    () => calls.accept({ roomId: 'r1', fromUserId: 'a', toUserId: 'b' }),
    (err) => err.code === 'CALL_STATE'
  );

  await calls.accept({ roomId: 'r1', fromUserId: 'b', toUserId: 'a' });
  assert.equal((await calls.get('a')).state, 'active');
  assert.equal((await calls.get('b')).state, 'active');

  await calls.rejectOrEnd({ roomId: 'r1', fromUserId: 'a', toUserId: 'b' });
  assert.equal(await calls.get('a'), null);
  assert.equal(await calls.get('b'), null);
});
