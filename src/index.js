'use strict';

const http = require('http');
const { loadConfig } = require('./config');
const { logger } = require('./utils/logger');
const { createHttpApp } = require('./http/app');
const { createSocketServer } = require('./realtime/io');

async function startServer(env = process.env) {
  const config = loadConfig(env);
  let ready = false;
  let pingRedis = async () => true;
  let closeRedis = async () => {};

  const app = createHttpApp({
    config,
    getReady: () => ready,
    getRedisReady: () => pingRedis(),
    logger,
  });

  const server = http.createServer(app);
  const socket = await createSocketServer(server, config, logger);
  const { io } = socket;
  pingRedis = socket.pingRedis;
  closeRedis = socket.closeRedis;

  await new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(config.port, () => {
      server.off('error', reject);
      resolve();
    });
  });

  ready = true;
  logger.info('signaling server listening', {
    port: config.port,
    nodeEnv: config.nodeEnv,
    redis: Boolean(config.redisUrl),
    turnEnabled: config.turnEnabled,
  });

  let shuttingDown = false;
  const shutdown = (signal) => {
    if (shuttingDown) return;
    shuttingDown = true;
    logger.info('shutdown requested', { signal });
    ready = false;

    const forceTimer = setTimeout(() => {
      logger.error('forced shutdown after timeout');
      process.exit(1);
    }, 10_000);
    forceTimer.unref();

    io.close(async () => {
      try {
        await closeRedis();
      } catch (err) {
        logger.error('error closing redis', { err });
      }

      if (!server.listening) {
        process.exit(0);
        return;
      }
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

  return { server, io, config, closeRedis };
}

if (require.main === module) {
  startServer().catch((err) => {
    logger.error('failed to start server', { err });
    process.exit(1);
  });
}

module.exports = { startServer };
