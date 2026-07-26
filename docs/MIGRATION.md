# Migration guide (v1 → v2) — clean break

v2 is a **breaking** rewrite. There is no compatibility mode for legacy Socket.IO events.

## Removed forever

| Legacy | Replacement |
|---|---|
| Unauthenticated connect | JWT in `auth.token` (or `Authorization: Bearer`) |
| `yourID` / `allUsers` | `room:joined` + `presence:update` |
| `hello` / `REGISTER_USR` / `REMOVE_USR` | Server-authoritative presence from token claims |
| `peer-msg` global bus | Removed (not replaced) |
| `callUser` / `hey` | `call:invite` / `call:incoming` |
| `acceptCall` / `callAccepted` | `call:accept` / `call:accepted` |
| Query-string `?token=` | Removed — use handshake `auth.token` |
| “TURN server” naming | This service is **signaling only** |

Emitting a legacy event returns `error:client` with code `LEGACY_EVENT`.

## Client checklist

1. Mint a short-lived room JWT from your app backend (or `POST /v1/rooms/:roomId/token` with `x-mint-secret` during bring-up).
2. Connect:

```js
import { io } from 'socket.io-client';

const socket = io(SIGNALING_URL, {
  auth: { token },
  transports: ['websocket'],
});

socket.on('room:joined', ({ roomId, self, members }) => { /* ... */ });
socket.on('presence:update', ({ members }) => { /* ... */ });
```

3. Use the call state machine (mesh-friendly — invite each peer independently):

```js
// caller (may invite bob and carol at the same time)
socket.emit('call:invite', { toUserId, signal: offer });

// callee
socket.on('call:incoming', async ({ fromUserId, signal }) => {
  const answer = await pc.createAnswer(/* remote = signal */);
  socket.emit('call:accept', { toUserId: fromUserId, signal: answer });
});

socket.on('call:accepted', ({ signal }) => { /* set remote answer */ });
socket.emit('signal:ice', { toUserId, candidate });

// mid-call renegotiation when replaceTrack is not enough
socket.emit('signal:sdp', { toUserId, signal: renegOffer });
socket.on('signal:sdp', ({ fromUserId, signal }) => { /* apply remote SDP */ });

socket.emit('call:end', { toUserId });

// optional pre-datachannel room chat
socket.emit('room:chat', { text: 'hello' });
socket.on('room:chat', ({ fromName, text }) => { /* ... */ });
```

4. For NAT traversal, fetch ephemeral TURN creds (if configured):

```http
POST /v1/turn/credentials
Authorization: Bearer <room JWT>
```

Use the JSON `{ urls, username, credential }` in your RTCPeerConnection `iceServers`.

## Server deploy checklist

- Set `ROOM_TOKEN_SECRET` and `ALLOWED_ORIGINS` (required in production)
- Run Node 20+
- Point the process at `node src/index.js` (Procfile already does)
- Optionally configure coturn + `TURN_SHARED_SECRET` / `TURN_URLS`
- Update clients **before** or **atomically with** cutting over the server URL
- Do not keep the old Heroku open-mesh process publicly reachable

## Token claims

```json
{
  "sub": "user-123",
  "name": "Ada",
  "roomId": "room-abc",
  "role": "member"
}
```

`sub` and `roomId` are required. Identity is always taken from the token, never from client payloads.
