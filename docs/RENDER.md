# Deploy on Render (free Redis / Key Value)

Render offers a **free** Redis-compatible [Key Value](https://render.com/docs/key-value) tier:

| | Free Key Value |
|---|---|
| Price | **$0/month** |
| RAM | 25 MB |
| Connections | 50 |
| Persistence | **None** (data lost on restart/maintenance) |
| Limit | 1 free KV instance per workspace |

That is enough for Socket.IO multi-instance signaling on this app: each web service uses ~3 Redis connections (pub + sub + data).

## Setup

1. In the Render dashboard, create **Key Value** → plan **Free** (same region as the web service).
2. Create / update the **Web Service** for this repo:
   - Runtime: Node
   - Build: `npm install`
   - Start: `npm start` (or `node src/index.js`)
3. Link the Key Value instance so Render injects `REDIS_URL` (or paste the **Internal Redis URL**).
4. Set required env vars:

```bash
NODE_ENV=production
ROOM_TOKEN_SECRET=...
ALLOWED_ORIGINS=https://your-app.example
MINT_SECRET=...
REDIS_URL=<from Key Value>
# optional
TURN_SHARED_SECRET=...
TURN_URLS=turn:...
```

5. Scale to 2+ instances only when `REDIS_URL` is set. Without Redis, stay on a single instance.

## What Redis enables here

When `REDIS_URL` is present the server:

- Attaches `@socket.io/redis-adapter` so room/socket emits cross instances
- Stores **presence** and **call state** in Redis so peers on different dynos see each other

Without `REDIS_URL`, everything stays in-process memory (fine for one instance).

## Free-tier caveats

- Free Key Value can restart and wipe state; clients should reconnect (they already re-join via JWT).
- Free web services may spin down when idle — expect cold starts.
- 50 Redis connections ≈ a handful of Node instances; do not run a large fleet on free KV.
- For production durability, upgrade Key Value to a paid plan with persistence.

## Blueprint sketch

```yaml
# render.yaml (optional)
services:
  - type: web
    name: hand-off-signaling
    runtime: node
    buildCommand: npm install
    startCommand: npm start
    envVars:
      - key: NODE_ENV
        value: production
      - key: ROOM_TOKEN_SECRET
        sync: false
      - key: ALLOWED_ORIGINS
        sync: false
      - key: REDIS_URL
        fromService:
          type: keyvalue
          name: hand-off-kv
          property: connectionString

  - type: keyvalue
    name: hand-off-kv
    plan: free
    maxmemoryPolicy: allkeys-lru
```
