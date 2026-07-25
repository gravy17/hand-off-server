'use strict';

const express = require('express');

function createHealthRouter({ getReady }) {
  const router = express.Router();

  router.get('/healthz', (_req, res) => {
    res.status(200).json({ ok: true });
  });

  router.get('/readyz', (_req, res) => {
    if (getReady()) {
      res.status(200).json({ ok: true });
      return;
    }
    res.status(503).json({ ok: false });
  });

  return router;
}

module.exports = { createHealthRouter };
