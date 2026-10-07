import { useCallback, useEffect, useRef, useState } from 'react'
import { io, type Socket } from 'socket.io-client'
import { WebRTCMesh } from '../lib/webrtc-mesh.ts'
import { generateFileId, isValidRoomCode } from '../lib/room-code.ts'
import {
  MAX_FILE_SIZE_BYTES,
  MAX_FILES_PER_ROOM,
  MAX_TEXT_LENGTH,
  type FileMetadata,
  type SharedFile,
} from '../types.ts'

type RoomSnapshot = {
  text: string
  files: FileMetadata[]
  peers: string[]
}

function revokeUrl(url?: string): void {
  if (url) URL.revokeObjectURL(url)
}

export function useShareRoom(roomCode: string) {
  const [text, setText] = useState('')
  const [files, setFiles] = useState<SharedFile[]>([])
  const [isConnected, setIsConnected] = useState(false)
  const [connectionStatus, setConnectionStatus] = useState('Connecting…')
  const [peerLabel, setPeerLabel] = useState('waiting for peer')
  const [connectedPeers, setConnectedPeers] = useState(0)
  const [error, setError] = useState<string | null>(null)
  const [copied, setCopied] = useState(false)

  const socketRef = useRef<Socket | null>(null)
  const meshRef = useRef<WebRTCMesh | null>(null)
  const localFilesRef = useRef(new Map<string, File>())
  const deliveredRef = useRef(new Map<string, Set<string>>())
  const objectUrlsRef = useRef(new Set<string>())
  const filesCountRef = useRef(0)
  const buffersRef = useRef(
    new Map<string, { chunks: ArrayBuffer[]; received: number; meta: FileMetadata }>(),
  )
  const textTimerRef = useRef<number | null>(null)
  const copiedTimerRef = useRef<number | null>(null)
  const valid = isValidRoomCode(roomCode)

  useEffect(() => {
    filesCountRef.current = files.length
  }, [files.length])

  useEffect(() => {
    if (!valid) return

    const socket = io({
      transports: ['websocket', 'polling'],
      autoConnect: true,
      reconnectionDelayMax: 5_000,
    })
    socketRef.current = socket

    const trackUrl = (url: string) => {
      objectUrlsRef.current.add(url)
      return url
    }

    const mesh = new WebRTCMesh(socket, roomCode, {
      onPeerState: (count, label) => {
        setConnectedPeers(count)
        setPeerLabel(label)
      },
      onFileMetadata: (metadata) => {
        if (metadata.senderSocketId === socket.id) return
        setFiles((current) => {
          if (current.some((file) => file.id === metadata.id)) return current
          return [...current, { ...metadata, progress: 0, status: 'downloading' }]
        })
        if (!buffersRef.current.has(metadata.id)) {
          buffersRef.current.set(metadata.id, { chunks: [], received: 0, meta: metadata })
        }
      },
      onFileChunk: (fileId, data, progress) => {
        const buffer = buffersRef.current.get(fileId)
        if (buffer) {
          buffer.chunks.push(data)
          buffer.received += data.byteLength
        }
        setFiles((current) =>
          current.map((file) =>
            file.id === fileId ? { ...file, progress, status: 'downloading' as const } : file,
          ),
        )
      },
      onFileComplete: (fileId) => {
        const buffer = buffersRef.current.get(fileId)
        if (!buffer) return
        const blob = new Blob(buffer.chunks, { type: buffer.meta.type || 'application/octet-stream' })
        const blobUrl = trackUrl(URL.createObjectURL(blob))
        buffersRef.current.delete(fileId)
        setFiles((current) =>
          current.map((file) => {
            if (file.id !== fileId) return file
            if (file.blobUrl) {
              revokeUrl(file.blobUrl)
              objectUrlsRef.current.delete(file.blobUrl)
            }
            return { ...file, blobUrl, progress: 100, status: 'completed' as const }
          }),
        )
      },
      onChannelOpen: (peerId) => {
        void (async () => {
          for (const [fileId, file] of localFilesRef.current) {
            const delivered = deliveredRef.current.get(fileId) ?? new Set<string>()
            if (delivered.has(peerId)) continue
            try {
              await mesh.sendFile(file, fileId, { peerId, announce: false })
              delivered.add(peerId)
              deliveredRef.current.set(fileId, delivered)
            } catch (sendError) {
              console.error('Failed to send file to new peer', sendError)
            }
          }
        })()
      },
    })
    meshRef.current = mesh

    socket.on('connect', () => {
      setIsConnected(true)
      setConnectionStatus('Connected')
      setError(null)
      socket.emit('join-room', roomCode)
    })

    socket.on('disconnect', () => {
      setIsConnected(false)
      setConnectionStatus('Disconnected')
      setPeerLabel('disconnected')
      setConnectedPeers(0)
    })

    socket.on('connect_error', () => {
      setConnectionStatus('Reconnecting…')
      setError('Lost contact with the relay server — retrying. If it just went to sleep, this can take up to a minute.')
    })

    socket.on('error-message', ({ message }: { message: string }) => {
      setError(message)
    })

    socket.on('room-state', async (state: RoomSnapshot) => {
      setText(state.text || '')
      setFiles((current) => {
        const local = current.filter((file) => file.local)
        const remote = (state.files || [])
          .filter((meta) => !local.some((file) => file.id === meta.id))
          .map((meta) => ({
            ...meta,
            progress: 0,
            status: 'downloading' as const,
          }))
        return [...local, ...remote]
      })
      await mesh.connectToKnownPeers(state.peers || [])
    })

    socket.on('text-update', (next: string) => {
      setText(next)
    })

    socket.on('user-joined', (socketId: string) => {
      void mesh.handleUserJoined(socketId)
    })

    socket.on('user-left', (socketId: string) => {
      mesh.handleUserLeft(socketId)
    })

    socket.on(
      'file-metadata',
      ({ fileMetadata, senderSocketId }: { fileMetadata: FileMetadata; senderSocketId: string }) => {
        if (senderSocketId === socket.id) return
        setFiles((current) => {
          if (current.some((file) => file.id === fileMetadata.id)) return current
          return [...current, { ...fileMetadata, progress: 0, status: 'downloading' }]
        })
        if (!buffersRef.current.has(fileMetadata.id)) {
          buffersRef.current.set(fileMetadata.id, { chunks: [], received: 0, meta: fileMetadata })
        }
      },
    )

    socket.on('file-delete', (fileId: string) => {
      localFilesRef.current.delete(fileId)
      deliveredRef.current.delete(fileId)
      buffersRef.current.delete(fileId)
      setFiles((current) => {
        const target = current.find((file) => file.id === fileId)
        if (target?.blobUrl) {
          revokeUrl(target.blobUrl)
          objectUrlsRef.current.delete(target.blobUrl)
        }
        return current.filter((file) => file.id !== fileId)
      })
    })

    const objectUrls = objectUrlsRef.current
    const localFiles = localFilesRef.current
    const delivered = deliveredRef.current
    const buffers = buffersRef.current

    return () => {
      if (textTimerRef.current) window.clearTimeout(textTimerRef.current)
      mesh.cleanup()
      meshRef.current = null
      socket.removeAllListeners()
      socket.disconnect()
      socketRef.current = null
      for (const url of objectUrls) revokeUrl(url)
      objectUrls.clear()
      localFiles.clear()
      delivered.clear()
      buffers.clear()
    }
  }, [roomCode, valid])

  const updateText = useCallback(
    (next: string) => {
      if (next.length > MAX_TEXT_LENGTH) {
        setError(`Text cannot exceed ${MAX_TEXT_LENGTH.toLocaleString()} characters.`)
        return
      }
      setText(next)
      setError(null)
      if (textTimerRef.current) window.clearTimeout(textTimerRef.current)
      textTimerRef.current = window.setTimeout(() => {
        const socket = socketRef.current
        if (socket?.connected) {
          socket.emit('text-update', { roomId: roomCode, text: next })
        }
      }, 80)
    },
    [roomCode],
  )

  const uploadFiles = useCallback(
    async (selected: FileList | File[]) => {
      const socket = socketRef.current
      const mesh = meshRef.current
      if (!socket?.connected || !mesh) {
        setError('Connect to the room before sharing files.')
        return
      }

      for (const file of Array.from(selected)) {
        if (file.size > MAX_FILE_SIZE_BYTES) {
          setError(`${file.name} is larger than 100 MB.`)
          continue
        }
        if (filesCountRef.current >= MAX_FILES_PER_ROOM) {
          setError('This room already has the maximum number of files.')
          break
        }

        const fileId = generateFileId()
        const blobUrl = URL.createObjectURL(file)
        objectUrlsRef.current.add(blobUrl)
        localFilesRef.current.set(fileId, file)
        filesCountRef.current += 1
        const hasPeers = mesh.openChannels().length > 0
        setFiles((current) => [
          ...current,
          {
            id: fileId,
            name: file.name,
            size: file.size,
            type: file.type || 'application/octet-stream',
            senderSocketId: socket.id ?? '',
            progress: hasPeers ? 0 : 100,
            status: hasPeers ? 'uploading' : 'completed',
            blobUrl,
            local: true,
          },
        ])

        const metadata: FileMetadata = {
          id: fileId,
          name: file.name,
          size: file.size,
          type: file.type || 'application/octet-stream',
          senderSocketId: socket.id ?? '',
        }
        socket.emit('file-metadata', { roomId: roomCode, fileMetadata: metadata })

        if (!hasPeers) continue

        try {
          const peerIds = mesh.openPeerIds()
          await mesh.sendFile(file, fileId, { announce: false })
          deliveredRef.current.set(fileId, new Set(peerIds))
          setFiles((current) =>
            current.map((item) =>
              item.id === fileId ? { ...item, progress: 100, status: 'completed' as const } : item,
            ),
          )
        } catch (sendError) {
          console.error(sendError)
          setFiles((current) =>
            current.map((item) =>
              item.id === fileId
                ? { ...item, status: 'error' as const, error: 'Transfer failed' }
                : item,
            ),
          )
        }
      }
    },
    [roomCode],
  )

  const deleteFile = useCallback(
    (fileId: string) => {
      const socket = socketRef.current
      if (!socket?.connected) return
      socket.emit('file-delete', { roomId: roomCode, fileId })
    },
    [roomCode],
  )

  const copyShareLink = useCallback(async () => {
    const link = `${window.location.origin}/r/${roomCode}`
    try {
      await navigator.clipboard.writeText(link)
      setCopied(true)
      if (copiedTimerRef.current) window.clearTimeout(copiedTimerRef.current)
      copiedTimerRef.current = window.setTimeout(() => setCopied(false), 2000)
    } catch {
      setError('Could not copy the link. Copy it from the address bar.')
    }
  }, [roomCode])

  return {
    valid,
    text,
    files,
    isConnected,
    connectionStatus,
    peerLabel,
    connectedPeers,
    error,
    copied,
    updateText,
    uploadFiles,
    deleteFile,
    copyShareLink,
  }
}
