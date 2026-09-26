export const ROOM_CODE_PATTERN = /^[A-Z0-9]{6}$/

export const LIMITS = {
  maxTextLength: 100_000,
  maxFilesPerRoom: 40,
  maxFileSizeBytes: 100 * 1024 * 1024,
  maxFileNameLength: 255,
  maxRooms: 5_000,
  emptyRoomTtlMs: 10 * 60 * 1000,
  idleRoomTtlMs: 60 * 60 * 1000,
} as const

export const RATE_LIMITS = {
  windowMs: 60_000,
  joinPerWindow: 20,
  textPerWindow: 400,
  filePerWindow: 60,
  signalPerWindow: 400,
} as const

/** Vite's default port. The Node server hosts Vite in middleware mode, so this is the only listener. */
export const DEFAULT_PORT = 5173

export function isDev(): boolean {
  return process.env.NODE_ENV !== 'production'
}

export function getPort(): number {
  const parsed = Number.parseInt(process.env.PORT ?? '', 10)
  return Number.isFinite(parsed) && parsed > 0 ? parsed : DEFAULT_PORT
}

export function getHostname(): string {
  const bindHost = process.env.BIND_HOST || process.env.LISTEN_HOST
  if (bindHost) return bindHost
  return isDev() ? '127.0.0.1' : '0.0.0.0'
}

export function getCorsOrigin(): string | string[] | boolean {
  const raw = process.env.CORS_ORIGIN?.trim()
  if (!raw) return isDev() ? true : false
  if (raw === '*') return '*'
  return raw.split(',').map((origin) => origin.trim()).filter(Boolean)
}
