'use strict';

const express = require('express');

function createHealthRouter({ getReady, getRedisReady }) {
  const router = express.Router();

  router.get('/healthz', (_req, res) => {
    res.status(200).json({ ok: true });
  });

  router.get('/readyz', async (_req, res) => {
    if (!getReady()) {
      res.status(503).json({ ok: false, reason: 'not_listening' });
      return;
    }

    try {
      if (getRedisReady) {
        const redisOk = await getRedisReady();
        if (!redisOk) {
          res.status(503).json({ ok: false, reason: 'redis' });
          return;
        }
      }
      res.status(200).json({ ok: true });
    } catch (err) {
      res.status(503).json({ ok: false, reason: 'redis', error: err.message });
    }
  });

  return router;
}

module.exports = { createHealthRouter };
