export const ROOM_CODE_PATTERN = /^[A-Z0-9]{6}$/

export const MAX_TEXT_LENGTH = 100_000
export const MAX_FILE_SIZE_BYTES = 100 * 1024 * 1024
export const MAX_FILES_PER_ROOM = 40

export type FileMetadata = {
  id: string
  name: string
  size: number
  type: string
  senderSocketId: string
}

export type TransferStatus = 'uploading' | 'downloading' | 'completed' | 'error'

export type SharedFile = FileMetadata & {
  progress: number
  status: TransferStatus
  blobUrl?: string
  error?: string
  local?: boolean
}
