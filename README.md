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
| `VITE_TURN_URL` / `VITE_TURN_USERNAME` / `VITE_TURN_CREDENTIAL` | Optional TURN | unset |
