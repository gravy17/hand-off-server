# hand-off-server

Authenticated, room-scoped **WebRTC signaling** server for the hand-off app.

This is **not** a TURN server. It relays signaling (presence + call setup) only. For NAT traversal, run [coturn](https://github.com/coturn/coturn) (or another TURN provider) separately and mint short-lived credentials from your app backend.

## What changed (v2)

- JWT auth on the Socket.IO handshake
- Room isolation from token claims (`roomId`)
- Server-authoritative presence (no client `REGISTER_USR` bus)
- Allowlisted call signaling events (`call:*`, `signal:ice`)
- CORS allowlist, payload size limits, basic event rate limiting
- Health endpoints and structured logs

## Quick start

```bash
npm install
export ROOM_TOKEN_SECRET='replace-me'
export ALLOWED_ORIGINS='http://localhost:3000'
npm start
```

Dev defaults (non-production only): if `ROOM_TOKEN_SECRET` is unset, a local development secret is used and CORS may allow any origin.

## Environment

| Variable | Required | Default | Description |
|---|---|---|---|
| `PORT` | no | `8989` | HTTP / Socket.IO port |
| `NODE_ENV` | no | `development` | Set `production` to enforce secrets/origins |
| `ROOM_TOKEN_SECRET` | production | dev secret | HS256 secret for room JWTs |
| `MINT_SECRET` | no | same as room secret in dev | Protects `POST /v1/rooms/:roomId/token` |
| `ALLOWED_ORIGINS` | production | none | Comma-separated browser origins |
| `MAX_ROOM_SIZE` | no | `8` | Max sockets per room |
| `MAX_PAYLOAD_BYTES` | no | `16384` | Max signal/candidate JSON size |
| `TOKEN_TTL_SECONDS` | no | `900` | Default mint TTL |
| `RATE_LIMIT_EVENTS_PER_SEC` | no | `20` | Per-socket signaling event budget |

## Auth / tokens

Clients must connect with a short-lived room JWT:

```js
import { io } from 'socket.io-client';

const socket = io(SERVER_URL, {
  auth: { token },
});
```

Token claims:

```json
{
  "sub": "user-123",
  "name": "Ada",
  "roomId": "room-abc",
  "role": "member"
}
```

Mint via your app backend (preferred), CLI, or the protected helper endpoint:

```bash
# CLI
npm run mint-token -- --userId=user-123 --roomId=room-abc --name=Ada

# HTTP helper
curl -X POST "$SERVER/v1/rooms/room-abc/token" \
  -H 'content-type: application/json' \
  -H "x-mint-secret: $MINT_SECRET" \
  -d '{"userId":"user-123","name":"Ada"}'
```

## Socket events

### Server → client

- `room:joined` `{ roomId, self, members }`
- `presence:update` `{ roomId, members, reason, userId }`
- `call:incoming` `{ fromUserId, fromName, signal }`
- `call:accepted` `{ fromUserId, signal }`
- `call:rejected` `{ fromUserId }`
- `call:ended` `{ fromUserId }`
- `signal:ice` `{ fromUserId, candidate }`
- `error:client` `{ code, message }`

### Client → server

- `call:invite` `{ toUserId, signal }`
- `call:accept` `{ toUserId, signal }`
- `call:reject` `{ toUserId }`
- `call:end` `{ toUserId }`
- `signal:ice` `{ toUserId, candidate }`

`fromUserId` is always taken from the verified token, never from the client payload.

## HTTP

- `GET /` — liveness string
- `GET /healthz` — process up
- `GET /readyz` — accepting traffic
- `POST /v1/rooms/:roomId/token` — mint helper (requires `x-mint-secret`)

## Scripts

```bash
npm start          # production entry
npm run dev        # node --watch
npm test           # integration tests
npm run mint-token # mint a JWT locally
```

## Security notes

- Do not deploy publicly without `ROOM_TOKEN_SECRET` and `ALLOWED_ORIGINS`
- Keep `MINT_SECRET` private; prefer minting tokens in your main app API
- Pair this service with TURN credentials from coturn (or equivalent), not open relays
