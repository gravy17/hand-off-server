# hand-off-server

Authenticated, room-scoped **WebRTC signaling** server for the hand-off app (v2).

This is **not** a TURN/media server. Signaling lives here; NAT traversal is handled by [coturn](./docs/COTURN.md) (or another TURN provider) via optional ephemeral credential vending.

> **Breaking change:** v1’s open Socket.IO bus (`hello`, `peer-msg`, `callUser`, …) is gone. See [docs/MIGRATION.md](./docs/MIGRATION.md).

## Features

- JWT auth on the Socket.IO handshake
- Room isolation from token `roomId`
- Server-authoritative presence (session takeover per user)
- Call state machine: invite → ringing → accept/reject/end (+ disconnect cleanup)
- Allowlisted events only; legacy events rejected with `LEGACY_EVENT`
- Helmet, CORS allowlist, payload limits, per-socket/invite/IP abuse controls
- Optional coturn REST credential endpoint
- Optional Redis / Render free Key Value for multi-instance (`REDIS_URL`)
- Health endpoints + structured JSON logs

## Quick start

```bash
npm install
export ROOM_TOKEN_SECRET='replace-me'
export ALLOWED_ORIGINS='http://localhost:3000'
npm start
```

```bash
npm test
npm run mint-token -- --userId=user-123 --roomId=room-abc --name=Ada
```

## Environment

| Variable | Required | Default | Description |
|---|---|---|---|
| `PORT` | no | `8989` | HTTP / Socket.IO port |
| `NODE_ENV` | no | `development` | `production` enforces secrets/origins |
| `ROOM_TOKEN_SECRET` | production | dev secret | HS256 secret for room JWTs |
| `MINT_SECRET` | no | room secret in dev | Protects token mint helper |
| `ALLOWED_ORIGINS` | production | none | Comma-separated browser origins |
| `MAX_ROOM_SIZE` | no | `8` | Max sockets per room |
| `MAX_PAYLOAD_BYTES` | no | `16384` | Max signal/candidate JSON size |
| `TOKEN_TTL_SECONDS` | no | `900` | Default mint TTL |
| `RATE_LIMIT_EVENTS_PER_SEC` | no | `20` | Per-socket signaling budget |
| `RATE_LIMIT_INVITES_PER_MIN` | no | `10` | Per-user invite budget |
| `MAX_CONNECTIONS_PER_IP` | no | `20` | Concurrent sockets per IP |
| `CONNECTION_RATE_PER_IP_PER_MIN` | no | `60` | New connects per IP per minute |
| `TURN_SHARED_SECRET` | no | unset | coturn static-auth-secret |
| `TURN_URLS` | with TURN secret | unset | Comma-separated TURN URLs |
| `TURN_TTL_SECONDS` | no | `300` | Ephemeral TURN credential TTL |
| `REDIS_URL` | multi-instance | unset | Render Key Value / Redis URL |

Copy `.env.example` as a template.

Multi-instance requires `REDIS_URL` (Socket.IO adapter + shared presence/calls). On Render you can use the **free** Key Value plan — see [docs/RENDER.md](./docs/RENDER.md).

## Socket API

Connect with:

```js
io(url, { auth: { token } })
```

### Server → client

- `room:joined` `{ roomId, self, members }`
- `presence:update` `{ roomId, members, reason, userId }`
- `call:incoming` `{ fromUserId, fromName, signal }`
- `call:accepted` `{ fromUserId, signal }`
- `call:rejected` `{ fromUserId }`
- `call:ended` `{ fromUserId, reason? }`
- `signal:ice` `{ fromUserId, candidate }`
- `error:client` `{ code, message }`

### Client → server

- `call:invite` `{ toUserId, signal }`
- `call:accept` `{ toUserId, signal }`
- `call:reject` `{ toUserId }`
- `call:end` `{ toUserId }`
- `signal:ice` `{ toUserId, candidate }`

Rules:

- `fromUserId` is always taken from the verified token
- One ringing/active call per user
- Only the callee may `call:accept`
- ICE is only relayed for an existing ringing/active call

## HTTP API

- `GET /` — service metadata
- `GET /healthz` — liveness
- `GET /readyz` — readiness
- `POST /v1/rooms/:roomId/token` — mint helper (`x-mint-secret`)
- `POST /v1/turn/credentials` — ephemeral TURN creds (`Authorization: Bearer <room JWT>`)

## Docs

- [Migration (clean break)](./docs/MIGRATION.md)
- [coturn setup](./docs/COTURN.md)
- [Render + free Redis/Key Value](./docs/RENDER.md)

## Scripts

```bash
npm start
npm run dev
npm test
npm run mint-token
```
