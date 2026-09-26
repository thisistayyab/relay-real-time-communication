import { ROOM_CODE_PATTERN } from '../types.ts'

const ALPHABET = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789'

export function generateRoomCode(): string {
  const bytes = new Uint8Array(6)
  crypto.getRandomValues(bytes)
  let code = ''
  for (const byte of bytes) {
    code += ALPHABET[byte % ALPHABET.length]
  }
  return code
}

export function normalizeRoomCode(value: string): string {
  return value.trim().toUpperCase().replace(/[^A-Z0-9]/g, '').slice(0, 6)
}

export function isValidRoomCode(code: string): boolean {
  return ROOM_CODE_PATTERN.test(code)
}

export function generateFileId(): string {
  return crypto.randomUUID()
}
