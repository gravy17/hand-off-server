'use strict';

const { createClient } = require('redis');
const { createAdapter } = require('@socket.io/redis-adapter');

/**
 * Create Redis clients for Socket.IO adapter + shared state.
 * Compatible with Render Key Value (free Redis-compatible Valkey).
 */
async function connectRedis(redisUrl, logger) {
  const pubClient = createClient({ url: redisUrl });
  const subClient = pubClient.duplicate();
  const dataClient = pubClient.duplicate();

  for (const client of [pubClient, subClient, dataClient]) {
    client.on('error', (err) => {
      logger.error('redis client error', { err });
    });
  }

  await Promise.all([pubClient.connect(), subClient.connect(), dataClient.connect()]);

  return {
    pubClient,
    subClient,
    dataClient,
    adapter: createAdapter(pubClient, subClient),
    async ping() {
      const pong = await dataClient.ping();
      return pong === 'PONG';
    },
    async close() {
      await Promise.allSettled([
        pubClient.quit(),
        subClient.quit(),
        dataClient.quit(),
      ]);
    },
  };
}

module.exports = { connectRedis };
