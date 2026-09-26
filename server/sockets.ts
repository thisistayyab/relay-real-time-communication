import type { Server, Socket } from 'socket.io'
import { LIMITS, RATE_LIMITS } from './config.ts'
import { SlidingWindowLimiter } from './rate-limit.ts'
import {
  isValidFileMetadata,
  isValidRoomCode,
  RoomStore,
} from './rooms.ts'

function log(message: string): void {
  console.log(`[${new Date().toISOString()}] ${message}`)
}

function inSameRoom(socket: Socket, target: Socket | undefined, roomId: string): boolean {
  return Boolean(target && socket.rooms.has(roomId) && target.rooms.has(roomId))
}

export function attachSockets(io: Server, rooms: RoomStore): void {
  const joinLimiter = new SlidingWindowLimiter(RATE_LIMITS.windowMs, RATE_LIMITS.joinPerWindow)
  const textLimiter = new SlidingWindowLimiter(RATE_LIMITS.windowMs, RATE_LIMITS.textPerWindow)
  const fileLimiter = new SlidingWindowLimiter(RATE_LIMITS.windowMs, RATE_LIMITS.filePerWindow)
  const signalLimiter = new SlidingWindowLimiter(RATE_LIMITS.windowMs, RATE_LIMITS.signalPerWindow)

  const pruneTimer = setInterval(() => {
    joinLimiter.prune()
    textLimiter.prune()
    fileLimiter.prune()
    signalLimiter.prune()
    const removed = rooms.prune()
    if (removed > 0) log(`Pruned ${removed} idle room(s)`)
  }, 60_000)
  pruneTimer.unref()

  io.on('connection', (socket: Socket) => {
    log(`Connected ${socket.id}`)

    socket.on('join-room', (roomId: unknown) => {
      if (!joinLimiter.allow(socket.id)) {
        socket.emit('error-message', { message: 'Too many join attempts. Slow down.' })
        return
      }
      if (!isValidRoomCode(roomId)) {
        socket.emit('error-message', { message: 'Invalid room code.' })
        return
      }

      const result = rooms.join(roomId, socket.id)
      if ('error' in result) {
        socket.emit('error-message', { message: result.error })
        return
      }

      const previousRooms = [...socket.rooms].filter((name) => name !== socket.id && name !== roomId)
      for (const previous of previousRooms) {
        socket.leave(previous)
        const leftover = rooms.get(previous)
        leftover?.sockets.delete(socket.id)
        socket.to(previous).emit('user-left', socket.id)
      }

      socket.join(roomId)
      const peers = [...result.sockets].filter((id) => id !== socket.id)
      socket.emit('room-state', {
        text: result.text,
        files: result.files,
        peers,
      })
      socket.to(roomId).emit('user-joined', socket.id)
      log(`${socket.id} joined ${roomId} (${result.sockets.size} in room)`)
    })

    socket.on('text-update', ({ roomId, text }: { roomId?: unknown; text?: unknown }) => {
      if (!textLimiter.allow(socket.id)) return
      if (!isValidRoomCode(roomId) || !socket.rooms.has(roomId)) return
      if (typeof text !== 'string') return
      if (text.length > LIMITS.maxTextLength) {
        socket.emit('error-message', { message: 'Shared text is too long.' })
        return
      }
      if (!rooms.setText(roomId, text)) return
      socket.to(roomId).emit('text-update', text)
    })

    socket.on('webrtc-offer', (payload: { roomId?: unknown; offer?: unknown; targetSocketId?: unknown }) => {
      relaySignal(socket, payload, 'webrtc-offer', { offer: payload.offer, senderSocketId: socket.id })
    })

    socket.on('webrtc-answer', (payload: { roomId?: unknown; answer?: unknown; targetSocketId?: unknown }) => {
      relaySignal(socket, payload, 'webrtc-answer', { answer: payload.answer, senderSocketId: socket.id })
    })

    socket.on('webrtc-ice-candidate', (payload: {
      roomId?: unknown
      candidate?: unknown
      targetSocketId?: unknown
    }) => {
      relaySignal(socket, payload, 'webrtc-ice-candidate', {
        candidate: payload.candidate,
        senderSocketId: socket.id,
      })
    })

    socket.on('file-metadata', ({ roomId, fileMetadata }: { roomId?: unknown; fileMetadata?: unknown }) => {
      if (!fileLimiter.allow(socket.id)) {
        socket.emit('error-message', { message: 'Too many file events.' })
        return
      }
      if (!isValidRoomCode(roomId) || !socket.rooms.has(roomId)) return
      if (!isValidFileMetadata(fileMetadata)) {
        socket.emit('error-message', { message: 'Invalid file metadata.' })
        return
      }

      const stored = {
        ...fileMetadata,
        senderSocketId: socket.id,
      }
      const added = rooms.addFile(roomId, stored)
      if ('error' in added) {
        socket.emit('error-message', { message: added.error })
        return
      }
      io.to(roomId).emit('file-metadata', { fileMetadata: stored, senderSocketId: socket.id })
    })

    socket.on('file-delete', ({ roomId, fileId }: { roomId?: unknown; fileId?: unknown }) => {
      if (!fileLimiter.allow(`${socket.id}:delete`)) return
      if (!isValidRoomCode(roomId) || !socket.rooms.has(roomId)) return
      if (typeof fileId !== 'string' || fileId.length === 0 || fileId.length > 80) return
      if (!rooms.removeFile(roomId, fileId)) return
      io.to(roomId).emit('file-delete', fileId)
    })

    socket.on('disconnect', () => {
      joinLimiter.clear(socket.id)
      textLimiter.clear(socket.id)
      fileLimiter.clear(socket.id)
      signalLimiter.clear(socket.id)
      const leftRooms = rooms.leave(socket.id)
      for (const roomId of leftRooms) {
        socket.to(roomId).emit('user-left', socket.id)
      }
      log(`Disconnected ${socket.id}`)
    })

    function relaySignal(
      from: Socket,
      payload: { roomId?: unknown; targetSocketId?: unknown },
      event: 'webrtc-offer' | 'webrtc-answer' | 'webrtc-ice-candidate',
      data: Record<string, unknown>,
    ): void {
      if (!signalLimiter.allow(from.id)) return
      const { roomId, targetSocketId } = payload
      if (!isValidRoomCode(roomId) || !from.rooms.has(roomId)) return
      if (typeof targetSocketId !== 'string' || targetSocketId === from.id) return
      const target = io.sockets.sockets.get(targetSocketId)
      if (!inSameRoom(from, target, roomId)) return
      target!.emit(event, data)
    }
  })
}
