import { LIMITS, ROOM_CODE_PATTERN } from './config.ts'

export type FileMetadata = {
  id: string
  name: string
  size: number
  type: string
  senderSocketId: string
}

export type RoomState = {
  text: string
  files: FileMetadata[]
  sockets: Set<string>
  lastActivity: number
}

export function isValidRoomCode(code: unknown): code is string {
  return typeof code === 'string' && ROOM_CODE_PATTERN.test(code)
}

export function isValidFileMetadata(value: unknown): value is FileMetadata {
  if (!value || typeof value !== 'object') return false
  const meta = value as Record<string, unknown>
  return (
    typeof meta.id === 'string' &&
    meta.id.length > 0 &&
    meta.id.length <= 80 &&
    typeof meta.name === 'string' &&
    meta.name.length > 0 &&
    meta.name.length <= LIMITS.maxFileNameLength &&
    typeof meta.size === 'number' &&
    Number.isFinite(meta.size) &&
    meta.size >= 0 &&
    meta.size <= LIMITS.maxFileSizeBytes &&
    typeof meta.type === 'string' &&
    meta.type.length <= 200 &&
    typeof meta.senderSocketId === 'string'
  )
}

export class RoomStore {
  private readonly rooms = new Map<string, RoomState>()

  get(roomId: string): RoomState | undefined {
    return this.rooms.get(roomId)
  }

  ensure(roomId: string): RoomState | { error: string } {
    const existing = this.rooms.get(roomId)
    if (existing) return existing
    if (this.rooms.size >= LIMITS.maxRooms) {
      return { error: 'Server is at capacity. Try again later.' }
    }
    const created: RoomState = {
      text: '',
      files: [],
      sockets: new Set(),
      lastActivity: Date.now(),
    }
    this.rooms.set(roomId, created)
    return created
  }

  join(roomId: string, socketId: string): RoomState | { error: string } {
    const room = this.ensure(roomId)
    if ('error' in room) return room
    room.sockets.add(socketId)
    room.lastActivity = Date.now()
    return room
  }

  leave(socketId: string): string[] {
    const left: string[] = []
    for (const [roomId, room] of this.rooms) {
      if (room.sockets.delete(socketId)) {
        room.lastActivity = Date.now()
        left.push(roomId)
      }
    }
    return left
  }

  setText(roomId: string, text: string): boolean {
    const room = this.rooms.get(roomId)
    if (!room) return false
    room.text = text
    room.lastActivity = Date.now()
    return true
  }

  addFile(roomId: string, file: FileMetadata): { ok: true } | { error: string } {
    const room = this.rooms.get(roomId)
    if (!room) return { error: 'Room not found' }
    if (room.files.some((item) => item.id === file.id)) return { ok: true }
    if (room.files.length >= LIMITS.maxFilesPerRoom) {
      return { error: 'Room file limit reached' }
    }
    room.files.push(file)
    room.lastActivity = Date.now()
    return { ok: true }
  }

  removeFile(roomId: string, fileId: string): boolean {
    const room = this.rooms.get(roomId)
    if (!room) return false
    const next = room.files.filter((item) => item.id !== fileId)
    if (next.length === room.files.length) return false
    room.files = next
    room.lastActivity = Date.now()
    return true
  }

  prune(now = Date.now()): number {
    let removed = 0
    for (const [roomId, room] of this.rooms) {
      const idleFor = now - room.lastActivity
      const empty = room.sockets.size === 0
      const expired = empty
        ? idleFor > LIMITS.emptyRoomTtlMs
        : idleFor > LIMITS.idleRoomTtlMs
      if (expired) {
        this.rooms.delete(roomId)
        removed += 1
      }
    }
    return removed
  }

  snapshot(room: RoomState) {
    return {
      text: room.text,
      files: room.files,
      peers: [...room.sockets],
    }
  }
}
