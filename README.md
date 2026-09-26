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

| Variable | Meaning | Default |
| --- | --- | --- |
| `PORT` | Listen port | `5173` |
| `BIND_HOST` | Bind address | `127.0.0.1` in dev, `0.0.0.0` in production |
| `CORS_ORIGIN` | Socket.IO origins | echo origin in dev, same-origin in production |
| `VITE_TURN_URL` / `VITE_TURN_USERNAME` / `VITE_TURN_CREDENTIAL` | Optional TURN | unset |
