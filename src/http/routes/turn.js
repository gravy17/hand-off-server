'use strict';

const express = require('express');
const { requireRoomToken } = require('../auth');
const { mintTurnCredentials } = require('../../turn/credentials');

function createTurnRouter({ config, logger }) {
  const router = express.Router();

  /**
   * POST /v1/turn/credentials
   * Authorization: Bearer <room JWT>
   * Returns ephemeral coturn REST credentials for the authenticated user.
   */
  router.post('/v1/turn/credentials', requireRoomToken(config), (req, res) => {
    if (!config.turnEnabled) {
      res.status(503).json({ error: 'TURN credential vending is disabled', code: 'TURN_DISABLED' });
      return;
    }

    try {
      const creds = mintTurnCredentials({
        sharedSecret: config.turnSharedSecret,
        urls: config.turnUrls,
        userId: req.auth.userId,
        ttlSeconds: config.turnTtlSeconds,
      });
      res.status(200).json(creds);
    } catch (err) {
      logger.error('failed to mint TURN credentials', { err });
      res.status(500).json({ error: 'failed to mint TURN credentials' });
    }
  });

  return router;
}

module.exports = { createTurnRouter };
