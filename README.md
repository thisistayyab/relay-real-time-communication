# Relay

Live text and peer-to-peer files in a private room. Vite serves the UI. Node + Socket.IO stays in front so realtime is not a static export.

## Develop

```bash
npm install
npm run dev
```

Open http://127.0.0.1:5173 — Vite’s default port. The custom server listens there and mounts Vite in middleware mode (not a second process on another port).

## Production

```bash
npm run build
NODE_ENV=production BIND_HOST=0.0.0.0 npm start
```

Hosts should set `PORT`. If unset, the app still uses **5173**.

## Render Deployment

This project is configured for Render deployment via `render.yaml`. Key environment variables:

- `PORT`: Required by Render (default: 10000)
- `NODE_ENV`: Set to `production`
- `BIND_HOST`: Set to `0.0.0.0` for external access
- `CORS_ORIGIN`: Optional - leave unset for same-origin only

The free tier uses:
- 512MB RAM
- Shared CPU
- 0.1 CPU units

⚠️ **Note**: WebRTC peer-to-peer connections may be limited on the free tier due to:
- Low memory limits for multiple simultaneous connections
- Network restrictions that may affect STUN/TURN servers
- Instance spin-down during inactivity

| Variable | Meaning | Default |
| --- | --- | --- |
| `PORT` | Listen port | `5173` |
| `BIND_HOST` | Bind address | `127.0.0.1` in dev, `0.0.0.0` in production |
| `CORS_ORIGIN` | Socket.IO origins | echo origin in dev, same-origin in production |
| `VITE_TURN_URL` / `VITE_TURN_USERNAME` / `VITE_TURN_CREDENTIAL` | Dedicated TURN (username/credential optional) | unset — falls back to the free public Metered Open Relay TURN |

## Why a peer can get stuck on "connecting"

There are two distinct connections in the UI:

1. **Socket** — browser ↔ server. If this is stuck, the server is usually
   asleep or unreachable (see free-tier note below).
2. **Peer** — browser ↔ browser over WebRTC. If the socket is green but the
   peer dot stays "connecting", ICE could not find a working path.

STUN alone cannot punch through symmetric NAT / CGNAT (most mobile carriers).
A **TURN relay** is what makes cross-network transfers work. This app ships
with a best-effort free public TURN (Metered Open Relay) so transfers work
out of the box; for production reliability set `VITE_TURN_URL` (plus
`VITE_TURN_USERNAME` / `VITE_TURN_CREDENTIAL` if your provider requires
them) to a managed TURN service such as Metered, Cloudflare Realtime TURN,
or Twilio NTSB — then **rebuild**, since Vite inlines `VITE_*` at build time.
On ICE failure the mesh also rebuilds the peer link up to 3 times before
giving up, so transient network hiccups recover without a page reload.

## Keeping the Render free instance awake

Render free web services sleep after ~15 minutes without inbound traffic and
take about a minute to wake. During that window every request 503s, so the
socket shows "Reconnecting…" and **in-memory rooms vanish** when it restarts.
To avoid it, point a free uptime pinger (e.g. cron-job.org or UptimeRobot)
at `https://your-app.onrender.com/health` on a 10-minute interval, or upgrade
to a paid plan that never sleeps.
