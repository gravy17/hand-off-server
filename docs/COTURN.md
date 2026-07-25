# coturn integration

This signaling server can mint **ephemeral TURN credentials** using the coturn REST API auth pattern. It does **not** relay media itself.

## coturn config (sketch)

```
use-auth-secret
static-auth-secret=SUPER_SECRET_SHARED_WITH_SIGNALING
realm=turn.example.com
fingerprint
listening-port=3478
# tls-listening-port=5349
```

## Signaling env

```bash
TURN_SHARED_SECRET=SUPER_SECRET_SHARED_WITH_SIGNALING
TURN_URLS=turn:turn.example.com:3478,turns:turn.example.com:5349
TURN_TTL_SECONDS=300
```

When both `TURN_SHARED_SECRET` and `TURN_URLS` are set, `POST /v1/turn/credentials` is enabled.

## Client flow

1. Authenticate to signaling with a room JWT.
2. `POST /v1/turn/credentials` with `Authorization: Bearer <jwt>`.
3. Build `iceServers`:

```js
const turn = await fetch(`${SIGNALING_URL}/v1/turn/credentials`, {
  method: 'POST',
  headers: { Authorization: `Bearer ${token}` },
}).then((r) => r.json());

const pc = new RTCPeerConnection({
  iceServers: [
    { urls: 'stun:stun.l.google.com:19302' },
    { urls: turn.urls, username: turn.username, credential: turn.credential },
  ],
});
```

## Security notes

- Never ship `TURN_SHARED_SECRET` to browsers.
- Keep TTL short (60–300s).
- Prefer `turns:` (TLS) in production.
- Restrict coturn relay addresses and monitor bandwidth abuse.
