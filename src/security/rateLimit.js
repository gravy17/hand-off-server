'use strict';

function createEventRateLimiter({ limitPerSec }) {
  const buckets = new Map();

  return function allow(socketId) {
    const now = Date.now();
    const windowStart = now - 1000;
    let timestamps = buckets.get(socketId);

    if (!timestamps) {
      timestamps = [];
      buckets.set(socketId, timestamps);
    }

    while (timestamps.length && timestamps[0] < windowStart) {
      timestamps.shift();
    }

    if (timestamps.length >= limitPerSec) {
      return false;
    }

    timestamps.push(now);
    return true;
  };
}

module.exports = { createEventRateLimiter };
