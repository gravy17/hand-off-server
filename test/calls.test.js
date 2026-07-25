'use strict';

const { test } = require('node:test');
const assert = require('node:assert/strict');
const { createCallRegistry } = require('../src/realtime/calls');

test('call registry enforces one call and accept rules', () => {
  const calls = createCallRegistry();
  calls.beginInvite({ roomId: 'r1', fromUserId: 'a', toUserId: 'b' });

  assert.throws(
    () => calls.beginInvite({ roomId: 'r1', fromUserId: 'a', toUserId: 'c' }),
    (err) => err.code === 'CALL_BUSY'
  );

  assert.throws(
    () => calls.accept({ roomId: 'r1', fromUserId: 'a', toUserId: 'b' }),
    (err) => err.code === 'CALL_STATE'
  );

  calls.accept({ roomId: 'r1', fromUserId: 'b', toUserId: 'a' });
  assert.equal(calls.get('a').state, 'active');
  assert.equal(calls.get('b').state, 'active');

  calls.rejectOrEnd({ roomId: 'r1', fromUserId: 'a', toUserId: 'b' });
  assert.equal(calls.get('a'), null);
  assert.equal(calls.get('b'), null);
});
