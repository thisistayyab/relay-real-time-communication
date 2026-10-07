import type { Socket } from 'socket.io-client'
import { getIceServers } from './ice-servers.ts'
import type { FileMetadata } from '../types.ts'

const CHUNK_SIZE = 16 * 1024
const BUFFER_HIGH = 8 * 1024 * 1024
const FILE_ID_LENGTH = 36
const CHUNK_HEADER = 1 + FILE_ID_LENGTH + 1
const PEER_RETRY_LIMIT = 3
const PEER_RETRY_BASE_DELAY_MS = 1_500

type ControlMessage =
  | { type: 'metadata'; metadata: FileMetadata }
  | { type: 'complete'; fileId: string }

export type MeshCallbacks = {
  onPeerState: (connectedPeers: number, label: string) => void
  onFileMetadata: (metadata: FileMetadata) => void
  onFileChunk: (fileId: string, data: ArrayBuffer, progress: number) => void
  onFileComplete: (fileId: string) => void
  onChannelOpen?: (peerId: string) => void
}

type PeerLink = {
  id: string
  pc: RTCPeerConnection
  channel: RTCDataChannel | null
  iceQueue: RTCIceCandidateInit[]
  remoteReady: boolean
}

function encodeChunk(fileId: string, progress: number, payload: ArrayBuffer): ArrayBuffer {
  const body = new Uint8Array(payload)
  const out = new Uint8Array(CHUNK_HEADER + body.byteLength)
  out[0] = 1
  const id = fileId.padEnd(FILE_ID_LENGTH, ' ').slice(0, FILE_ID_LENGTH)
  for (let i = 0; i < FILE_ID_LENGTH; i += 1) {
    out[1 + i] = id.charCodeAt(i)
  }
  out[1 + FILE_ID_LENGTH] = Math.max(0, Math.min(100, progress))
  out.set(body, CHUNK_HEADER)
  return out.buffer
}

function decodeChunk(buffer: ArrayBuffer): { fileId: string; progress: number; payload: ArrayBuffer } | null {
  if (buffer.byteLength < CHUNK_HEADER) return null
  const view = new Uint8Array(buffer)
  if (view[0] !== 1) return null
  let fileId = ''
  for (let i = 0; i < FILE_ID_LENGTH; i += 1) {
    fileId += String.fromCharCode(view[1 + i])
  }
  return {
    fileId: fileId.trim(),
    progress: view[1 + FILE_ID_LENGTH],
    payload: buffer.slice(CHUNK_HEADER),
  }
}

function shouldInitiate(localId: string, remoteId: string): boolean {
  return localId > remoteId
}

async function waitForBuffer(channel: RTCDataChannel): Promise<void> {
  while (channel.readyState === 'open' && channel.bufferedAmount > BUFFER_HIGH) {
    await new Promise<void>((resolve) => {
      const cleanup = () => {
        channel.removeEventListener('bufferedamountlow', onLow)
        channel.removeEventListener('close', onClose)
      }
      const onLow = () => {
        cleanup()
        resolve()
      }
      const onClose = () => {
        cleanup()
        resolve()
      }
      channel.addEventListener('bufferedamountlow', onLow)
      channel.addEventListener('close', onClose)
    })
  }
}

export class WebRTCMesh {
  private readonly peers = new Map<string, PeerLink>()
  private readonly retryAttempts = new Map<string, number>()
  private readonly retryTimers = new Map<string, ReturnType<typeof setTimeout>>()
  private readonly socket: Socket
  private readonly roomId: string
  private readonly callbacks: MeshCallbacks
  private localId: string
  private disposed = false

  constructor(socket: Socket, roomId: string, callbacks: MeshCallbacks) {
    this.socket = socket
    this.roomId = roomId
    this.callbacks = callbacks
    this.localId = socket.id ?? ''
    this.bindSignaling()
  }

  private bindSignaling(): void {
    this.socket.on('webrtc-offer', this.onOffer)
    this.socket.on('webrtc-answer', this.onAnswer)
    this.socket.on('webrtc-ice-candidate', this.onRemoteIce)
  }

  async connectToKnownPeers(peerIds: string[]): Promise<void> {
    this.localId = this.socket.id ?? this.localId
    await Promise.all(peerIds.filter((id) => id !== this.localId).map((id) => this.ensurePeer(id)))
  }

  async handleUserJoined(peerId: string): Promise<void> {
    await this.ensurePeer(peerId)
  }

  handleUserLeft(peerId: string): void {
    this.cancelPeerRetry(peerId)
    this.closePeer(peerId)
    this.emitPeerState()
  }

  private async ensurePeer(peerId: string): Promise<PeerLink | null> {
    if (this.disposed || peerId === this.localId) return null
    const existing = this.peers.get(peerId)
    if (existing) return existing

    const pc = new RTCPeerConnection({ iceServers: getIceServers() })
    const link: PeerLink = {
      id: peerId,
      pc,
      channel: null,
      iceQueue: [],
      remoteReady: false,
    }
    this.peers.set(peerId, link)
    this.setupPeer(link)

    if (shouldInitiate(this.localId, peerId)) {
      const channel = pc.createDataChannel('files', { ordered: true })
      this.attachChannel(link, channel)
      const offer = await pc.createOffer()
      await pc.setLocalDescription(offer)
      this.socket.emit('webrtc-offer', {
        roomId: this.roomId,
        offer,
        targetSocketId: peerId,
      })
    }

    this.emitPeerState()
    return link
  }

  private setupPeer(link: PeerLink): void {
    link.pc.onicecandidate = (event) => {
      if (!event.candidate) return
      this.socket.emit('webrtc-ice-candidate', {
        roomId: this.roomId,
        candidate: event.candidate,
        targetSocketId: link.id,
      })
    }

    link.pc.onconnectionstatechange = () => {
      const state = link.pc.connectionState
      if (state === 'connected') {
        this.retryAttempts.delete(link.id)
      } else if (state === 'failed') {
        this.schedulePeerRetry(link.id)
      } else if (state === 'closed') {
        this.closePeer(link.id)
      }
      this.emitPeerState()
    }

    link.pc.ondatachannel = (event) => {
      this.attachChannel(link, event.channel)
    }
  }

  /**
   * ICE gave up on this peer. Tear the link down and rebuild it from scratch
   * a bounded number of times instead of staying broken until a page reload.
   * Both sides run this; only the designated initiator re-offers, so the
   * retries converge without glare.
   */
  private schedulePeerRetry(peerId: string): void {
    if (this.disposed || this.retryTimers.has(peerId)) return
    const attempts = (this.retryAttempts.get(peerId) ?? 0) + 1
    if (attempts > PEER_RETRY_LIMIT) {
      this.closePeer(peerId)
      this.emitPeerState()
      return
    }
    this.retryAttempts.set(peerId, attempts)
    this.closePeer(peerId)
    this.emitPeerState()
    const timer = setTimeout(() => {
      this.retryTimers.delete(peerId)
      if (this.disposed) return
      void this.ensurePeer(peerId)
    }, PEER_RETRY_BASE_DELAY_MS * attempts)
    this.retryTimers.set(peerId, timer)
  }

  private cancelPeerRetry(peerId: string): void {
    const timer = this.retryTimers.get(peerId)
    if (timer) {
      clearTimeout(timer)
      this.retryTimers.delete(peerId)
    }
    this.retryAttempts.delete(peerId)
  }

  private attachChannel(link: PeerLink, channel: RTCDataChannel): void {
    channel.binaryType = 'arraybuffer'
    channel.bufferedAmountLowThreshold = 1024 * 1024
    link.channel = channel
    channel.onmessage = (event) => {
      this.handleChannelMessage(event.data)
    }
    channel.onopen = () => {
      this.retryAttempts.delete(link.id)
      this.emitPeerState()
      this.callbacks.onChannelOpen?.(link.id)
    }
    channel.onclose = () => this.emitPeerState()
  }

  private handleChannelMessage(data: unknown): void {
    if (typeof data === 'string') {
      try {
        const message = JSON.parse(data) as ControlMessage
        if (message.type === 'metadata') this.callbacks.onFileMetadata(message.metadata)
        if (message.type === 'complete') this.callbacks.onFileComplete(message.fileId)
      } catch (error) {
        console.error('Invalid control message', error)
      }
      return
    }

    if (data instanceof ArrayBuffer) {
      const chunk = decodeChunk(data)
      if (chunk) this.callbacks.onFileChunk(chunk.fileId, chunk.payload, chunk.progress)
    }
  }

  private onOffer = async ({ offer, senderSocketId }: { offer: RTCSessionDescriptionInit; senderSocketId: string }) => {
    const link = await this.ensurePeer(senderSocketId)
    if (!link) return
    await link.pc.setRemoteDescription(new RTCSessionDescription(offer))
    link.remoteReady = true
    await this.flushIce(link)
    const answer = await link.pc.createAnswer()
    await link.pc.setLocalDescription(answer)
    this.socket.emit('webrtc-answer', {
      roomId: this.roomId,
      answer,
      targetSocketId: senderSocketId,
    })
  }

  private onAnswer = async ({ answer, senderSocketId }: { answer: RTCSessionDescriptionInit; senderSocketId: string }) => {
    const link = this.peers.get(senderSocketId)
    if (!link) return
    await link.pc.setRemoteDescription(new RTCSessionDescription(answer))
    link.remoteReady = true
    await this.flushIce(link)
  }

  private onRemoteIce = async ({
    candidate,
    senderSocketId,
  }: {
    candidate: RTCIceCandidateInit
    senderSocketId: string
  }) => {
    const link = this.peers.get(senderSocketId)
    if (!link) return
    if (!link.remoteReady) {
      link.iceQueue.push(candidate)
      return
    }
    await link.pc.addIceCandidate(new RTCIceCandidate(candidate))
  }

  private async flushIce(link: PeerLink): Promise<void> {
    const queued = link.iceQueue.splice(0)
    for (const candidate of queued) {
      await link.pc.addIceCandidate(new RTCIceCandidate(candidate))
    }
  }

  openChannels(): RTCDataChannel[] {
    return [...this.peers.values()]
      .map((peer) => peer.channel)
      .filter((channel): channel is RTCDataChannel => channel?.readyState === 'open')
  }

  openPeerIds(): string[] {
    return [...this.peers.entries()]
      .filter(([, peer]) => peer.channel?.readyState === 'open')
      .map(([id]) => id)
  }

  connectedPeerCount(): number {
    return [...this.peers.values()].filter((peer) => peer.pc.connectionState === 'connected').length
  }

  channelFor(peerId: string): RTCDataChannel | null {
    const channel = this.peers.get(peerId)?.channel
    return channel?.readyState === 'open' ? channel : null
  }

  async sendFile(
    file: File,
    fileId: string,
    options: { peerId?: string; announce?: boolean } = {},
  ): Promise<void> {
    const channels = options.peerId
      ? [this.channelFor(options.peerId)].filter((channel): channel is RTCDataChannel => channel !== null)
      : this.openChannels()

    if (channels.length === 0) {
      throw new Error('No peer is connected yet')
    }

    const metadata: FileMetadata = {
      id: fileId,
      name: file.name,
      size: file.size,
      type: file.type || 'application/octet-stream',
      senderSocketId: this.socket.id ?? '',
    }

    const control = JSON.stringify({ type: 'metadata', metadata } satisfies ControlMessage)
    const complete = JSON.stringify({ type: 'complete', fileId } satisfies ControlMessage)

    if (options.announce !== false) {
      this.socket.emit('file-metadata', { roomId: this.roomId, fileMetadata: metadata })
    }

    for (const channel of channels) {
      channel.send(control)
    }

    let offset = 0
    while (offset < file.size) {
      const slice = file.slice(offset, offset + CHUNK_SIZE)
      const payload = await slice.arrayBuffer()
      offset += payload.byteLength
      const progress = Math.min(100, Math.round((offset / file.size) * 100))
      const packet = encodeChunk(fileId, progress, payload)
      for (const channel of channels) {
        if (channel.readyState !== 'open') continue
        await waitForBuffer(channel)
        channel.send(packet)
      }
    }

    for (const channel of channels) {
      if (channel.readyState !== 'open') continue
      channel.send(complete)
    }
  }

  private emitPeerState(): void {
    const connected = this.connectedPeerCount()
    const open = this.openChannels().length
    const label =
      connected > 0 && open > 0
        ? `connected (${connected})`
        : this.peers.size > 0
          ? 'connecting'
          : 'waiting for peer'
    this.callbacks.onPeerState(connected, label)
  }

  private closePeer(peerId: string): void {
    const link = this.peers.get(peerId)
    if (!link) return
    link.channel?.close()
    link.pc.close()
    this.peers.delete(peerId)
  }

  cleanup(): void {
    this.disposed = true
    for (const peerId of [...this.retryTimers.keys()]) this.cancelPeerRetry(peerId)
    this.socket.off('webrtc-offer', this.onOffer)
    this.socket.off('webrtc-answer', this.onAnswer)
    this.socket.off('webrtc-ice-candidate', this.onRemoteIce)
    for (const id of [...this.peers.keys()]) this.closePeer(id)
  }
}
