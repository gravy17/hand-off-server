'use strict';

const http = require('http');
const { loadConfig } = require('./config');
const { logger } = require('./utils/logger');
const { createHttpApp } = require('./http/app');
const { createSocketServer } = require('./realtime/io');

function startServer(env = process.env) {
  const config = loadConfig(env);
  let ready = false;

  const app = createHttpApp({
    config,
    getReady: () => ready,
    logger,
  });

  const server = http.createServer(app);
  const { io } = createSocketServer(server, config, logger);

  server.listen(config.port, () => {
    ready = true;
    logger.info('signaling server listening', {
      port: config.port,
      nodeEnv: config.nodeEnv,
    });
  });

  const shutdown = (signal) => {
    logger.info('shutdown requested', { signal });
    ready = false;

    const forceTimer = setTimeout(() => {
      logger.error('forced shutdown after timeout');
      process.exit(1);
    }, 10_000);
    forceTimer.unref();

    io.close(() => {
      server.close((err) => {
        if (err) {
          logger.error('error during http close', { err });
          process.exit(1);
        }
        process.exit(0);
      });
    });
  };

  process.on('SIGTERM', () => shutdown('SIGTERM'));
  process.on('SIGINT', () => shutdown('SIGINT'));

  return { server, io, config };
}

if (require.main === module) {
  try {
    startServer();
  } catch (err) {
    logger.error('failed to start server', { err });
    process.exit(1);
  }
}

module.exports = { startServer };
