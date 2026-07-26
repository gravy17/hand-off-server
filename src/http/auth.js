'use strict';

const { verifyRoomToken } = require('../security/tokens');

function extractBearer(header) {
  if (!header || typeof header !== 'string') {
    return undefined;
  }
  const [scheme, token] = header.split(' ');
  if (scheme?.toLowerCase() !== 'bearer' || !token) {
    return undefined;
  }
  return token;
}

function requireRoomToken(config) {
  return (req, res, next) => {
    try {
      const token = extractBearer(req.get('authorization'));
      req.auth = verifyRoomToken(token, config.roomTokenSecret);
      next();
    } catch (err) {
      res.status(401).json({ error: err.message || 'unauthorized', code: err.code || 'AUTH_INVALID' });
    }
  };
}

module.exports = { requireRoomToken, extractBearer };
