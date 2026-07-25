'use strict';

const express = require('express');
const { mintRoomToken } = require('../../security/tokens');

function createRoomsRouter({ config, logger }) {
  const router = express.Router();

  /**
   * Dev/ops helper for minting room tokens when no external app backend exists yet.
   * Protect with MINT_SECRET. Do not expose without that secret in production.
   *
   * POST /v1/rooms/:roomId/token
   * headers: x-mint-secret: <MINT_SECRET>
   * body: { userId, name?, role?, ttlSeconds? }
   */
  router.post('/v1/rooms/:roomId/token', (req, res) => {
    if (!config.mintSecret) {
      res.status(503).json({ error: 'token minting is disabled' });
      return;
    }

    const provided = req.get('x-mint-secret');
    if (!provided || provided !== config.mintSecret) {
      res.status(401).json({ error: 'unauthorized' });
      return;
    }

    const roomId = req.params.roomId;
    const { userId, name, role, ttlSeconds } = req.body || {};

    if (!userId || typeof userId !== 'string') {
      res.status(400).json({ error: 'userId is required' });
      return;
    }

    try {
      const token = mintRoomToken({
        secret: config.roomTokenSecret,
        userId,
        name,
        roomId,
        role,
        ttlSeconds: ttlSeconds || config.tokenTtlSeconds,
      });

      res.status(200).json({
        token,
        roomId,
        userId,
        expiresIn: ttlSeconds || config.tokenTtlSeconds,
      });
    } catch (err) {
      logger.error('failed to mint room token', { err });
      res.status(500).json({ error: 'failed to mint token' });
    }
  });

  return router;
}

module.exports = { createRoomsRouter };
