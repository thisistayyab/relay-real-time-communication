import { createServer } from 'node:http'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import express from 'express'
import { Server } from 'socket.io'
import { getCorsOrigin, getHostname, getPort, isDev } from './config.ts'
import { RoomStore } from './rooms.ts'
import { attachSockets } from './sockets.ts'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const clientDist = path.resolve(__dirname, '../dist')

function applySecurityHeaders(req: express.Request, res: express.Response, next: express.NextFunction): void {
  res.setHeader('X-Content-Type-Options', 'nosniff')
  res.setHeader('X-Frame-Options', 'DENY')
  res.setHeader('Referrer-Policy', 'strict-origin-when-cross-origin')
  res.setHeader('Permissions-Policy', 'camera=(), microphone=(), geolocation=()')
  if (!isDev()) {
    res.setHeader(
      'Content-Security-Policy',
      "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data: blob:; media-src blob:; connect-src 'self' ws: wss:; font-src 'self'; frame-ancestors 'none'; base-uri 'self'; form-action 'self'",
    )
  }
  const forwarded = req.header('x-forwarded-proto')
  if (forwarded === 'https') {
    res.setHeader('Strict-Transport-Security', 'max-age=63072000; includeSubDomains; preload')
  }
  next()
}

function health(_req: express.Request, res: express.Response): void {
  res.status(200).json({
    status: 'healthy',
    uptime: process.uptime(),
    timestamp: new Date().toISOString(),
  })
}

async function main(): Promise<void> {
  const app = express()
  const httpServer = createServer(app)
  const corsOrigin = getCorsOrigin()

  const io = new Server(httpServer, {
    cors: {
      origin: corsOrigin,
      methods: ['GET', 'POST'],
    },
    transports: ['websocket', 'polling'],
    pingInterval: 25_000,
    pingTimeout: 20_000,
  })

  const rooms = new RoomStore()
  attachSockets(io, rooms)

  app.disable('x-powered-by')
  app.set('trust proxy', 1)
  app.use(applySecurityHeaders)
  app.get('/health', health)

  if (isDev()) {
    const { createServer: createViteServer } = await import('vite')
    const vite = await createViteServer({
      appType: 'spa',
      server: {
        middlewareMode: true,
        ws: { server: httpServer },
      },
    })
    app.use(vite.middlewares)
  } else {
    const assets = path.join(clientDist, 'assets')
    app.use('/assets', express.static(assets, { maxAge: '1y', immutable: true, index: false }))
    app.use(express.static(clientDist, { index: false, maxAge: '1h' }))
    app.use((req, res, next) => {
      if (req.method !== 'GET' && req.method !== 'HEAD') {
        next()
        return
      }
      if (req.path.startsWith('/socket.io') || req.path === '/health') {
        next()
        return
      }
      res.setHeader('Cache-Control', 'no-cache')
      res.sendFile(path.join(clientDist, 'index.html'), (sendError) => {
        if (sendError) next(sendError)
      })
    })
  }

  app.use((error: unknown, _req: express.Request, res: express.Response, _next: express.NextFunction) => {
    console.error(`[${new Date().toISOString()}] Request error:`, error)
    if (!res.headersSent) {
      res.status(500).json({ message: 'Internal server error' })
    }
  })

  const port = getPort()
  const hostname = getHostname()

  await new Promise<void>((resolve, reject) => {
    httpServer.once('error', reject)
    httpServer.listen(port, hostname, () => resolve())
  })

  console.log(`Ready on http://${hostname}:${port}`)
  console.log(`Environment: ${process.env.NODE_ENV || 'development'}`)

  const shutdown = () => {
    console.log('Shutting down...')
    io.close()
    httpServer.close(() => process.exit(0))
    setTimeout(() => process.exit(1), 8_000).unref()
  }

  process.once('SIGTERM', shutdown)
  process.once('SIGINT', shutdown)
}

main().catch((error) => {
  console.error('Failed to start server:', error)
  process.exit(1)
})
