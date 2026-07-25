'use strict';

const express = require('express');
const cors = require('cors');
const { createHealthRouter } = require('./routes/health');
const { createRoomsRouter } = require('./routes/rooms');

function createHttpApp({ config, getReady, logger }) {
  const app = express();

  app.disable('x-powered-by');
  app.use(express.json({ limit: '32kb' }));

  app.use(
    cors({
      origin(origin, callback) {
        if (!origin) {
          callback(null, true);
          return;
        }
        if (!config.isProduction && config.allowedOrigins.length === 0) {
          callback(null, true);
          return;
        }
        if (config.allowedOrigins.includes(origin)) {
          callback(null, true);
          return;
        }
        callback(new Error('Not allowed by CORS'));
      },
    })
  );

  app.get('/', (_req, res) => {
    res
      .status(200)
      .type('text/plain')
      .send('HandOff signaling server is live');
  });

  app.use(createHealthRouter({ getReady }));
  app.use(createRoomsRouter({ config, logger }));

  app.use((err, _req, res, _next) => {
    if (err && err.message === 'Not allowed by CORS') {
      res.status(403).json({ error: 'origin not allowed' });
      return;
    }
    logger.error('http error', { err });
    res.status(500).json({ error: 'internal error' });
  });

  return app;
}

module.exports = { createHttpApp };
