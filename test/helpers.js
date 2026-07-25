'use strict';

const http = require('http');
const { createHttpApp } = require('../src/http/app');
const { createSocketServer } = require('../src/realtime/io');
const { mintRoomToken } = require('../src/security/tokens');
const { logger } = require('../src/utils/logger');

async function listen(server) {
  await new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(0, '127.0.0.1', () => {
      server.off('error', reject);
      resolve();
    });
  });
  const address = server.address();
  return `http://127.0.0.1:${address.port}`;
}

async function startTestServer(overrides = {}) {
  const config = {
    nodeEnv: 'test',
    isProduction: false,
    port: 0,
    roomTokenSecret: 'test-secret',
    mintSecret: 'mint-secret',
    allowedOrigins: [],
    maxRoomSize: overrides.maxRoomSize || 8,
    maxPayloadBytes: overrides.maxPayloadBytes || 16384,
    tokenTtlSeconds: 900,
    rateLimitEventsPerSec: overrides.rateLimitEventsPerSec || 1000,
  };

  let ready = false;
  const app = createHttpApp({
    config,
    getReady: () => ready,
    logger,
  });
  const server = http.createServer(app);
  const { io, presence } = createSocketServer(server, config, logger);
  const url = await listen(server);
  ready = true;

  function tokenFor({ userId, roomId, name, role }) {
    return mintRoomToken({
      secret: config.roomTokenSecret,
      userId,
      roomId,
      name,
      role,
      ttlSeconds: 900,
    });
  }

  async function close() {
    ready = false;
    await new Promise((resolve) => {
      io.close(() => resolve());
    });
    // Socket.IO may already have closed the HTTP server.
    if (server.listening) {
      await new Promise((resolve, reject) => {
        server.close((err) => (err ? reject(err) : resolve()));
      });
    }
  }

  return { url, config, io, presence, tokenFor, close };
}

module.exports = { startTestServer };
