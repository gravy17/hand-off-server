'use strict';

const express = require('express');
const cors = require('cors');
const helmet = require('helmet');
const { createHealthRouter } = require('./routes/health');
const { createRoomsRouter } = require('./routes/rooms');
const { createTurnRouter } = require('./routes/turn');

function createHttpApp({ config, getReady, logger }) {
  const app = express();

  app.disable('x-powered-by');
  app.use(
    helmet({
      contentSecurityPolicy: false,
      crossOriginEmbedderPolicy: false,
    })
  );
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
    res.status(200).json({
      service: 'hand-off-signaling',
      version: 2,
      turnEnabled: config.turnEnabled,
    });
  });

  app.use(createHealthRouter({ getReady }));
  app.use(createRoomsRouter({ config, logger }));
  app.use(createTurnRouter({ config, logger }));

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
