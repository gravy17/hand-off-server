'use strict';

const crypto = require('crypto');

/**
 * coturn REST API style ephemeral credentials:
 *   username = `${expiryUnix}:${userId}`
 *   credential = base64(hmac_sha1(secret, username))
 */
function mintTurnCredentials({
  sharedSecret,
  urls,
  userId,
  ttlSeconds = 300,
  nowMs = Date.now(),
}) {
  if (!sharedSecret) {
    const err = new Error('TURN is not configured');
    err.code = 'TURN_DISABLED';
    throw err;
  }
  if (!Array.isArray(urls) || urls.length === 0) {
    const err = new Error('TURN urls are not configured');
    err.code = 'TURN_DISABLED';
    throw err;
  }
  if (!userId) {
    const err = new Error('userId is required');
    err.code = 'VALIDATION';
    throw err;
  }

  const ttl = Math.max(30, Number(ttlSeconds) || 300);
  const expiry = Math.floor(nowMs / 1000) + ttl;
  const username = `${expiry}:${userId}`;
  const credential = crypto
    .createHmac('sha1', sharedSecret)
    .update(username)
    .digest('base64');

  return {
    urls: [...urls],
    username,
    credential,
    ttl,
    expiresAt: expiry,
  };
}

module.exports = { mintTurnCredentials };
