'use strict';

const { loadConfig } = require('../src/config');
const { mintRoomToken } = require('../src/security/tokens');

function usage() {
  console.error(
    'Usage: npm run mint-token -- --userId=<id> --roomId=<room> [--name=<name>] [--ttl=<seconds>]'
  );
  process.exit(1);
}

function parseArgs(argv) {
  const out = {};
  for (const arg of argv) {
    if (!arg.startsWith('--')) continue;
    const [key, ...rest] = arg.slice(2).split('=');
    out[key] = rest.join('=');
  }
  return out;
}

const args = parseArgs(process.argv.slice(2));
if (!args.userId || !args.roomId) {
  usage();
}

const config = loadConfig(process.env);
const token = mintRoomToken({
  secret: config.roomTokenSecret,
  userId: args.userId,
  name: args.name,
  roomId: args.roomId,
  ttlSeconds: args.ttl ? Number(args.ttl) : config.tokenTtlSeconds,
});

process.stdout.write(`${token}\n`);
