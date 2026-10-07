type TurnEnv = {
  urls: string[]
  username?: string
  credential?: string
}

/**
 * TURN configured through environment variables. Vite inlines these at build
 * time, so changing them requires a rebuild.
 *
 * The username/credential are optional: some TURN services (e.g. static-auth
 * or open endpoints) work with the URL alone.
 */
function envTurnServer(): TurnEnv | null {
  const turnUrl = import.meta.env.VITE_TURN_URL as string | undefined
  if (!turnUrl?.trim()) return null
  const username = import.meta.env.VITE_TURN_USERNAME as string | undefined
  const credential = import.meta.env.VITE_TURN_CREDENTIAL as string | undefined
  return {
    urls: turnUrl
      .split(',')
      .map((url) => url.trim())
      .filter(Boolean),
    username: username?.trim() || undefined,
    credential: credential?.trim() || undefined,
  }
}

/**
 * Free public TURN (Metered "Open Relay"). Best effort with no account
 * required — used only when no VITE_TURN_URL is configured. If it is ever
 * unreachable, ICE simply falls back to the other candidates.
 */
const PUBLIC_TURN: RTCIceServer = {
  urls: [
    'turn:openrelay.metered.ca:80',
    'turn:openrelay.metered.ca:443',
    'turn:openrelay.metered.ca:443?transport=tcp',
    'turn:openrelay.metered.ca:80?transport=tcp',
  ],
  username: 'openrelayproject',
  credential: 'openrelayproject',
}

export function getIceServers(): RTCIceServer[] {
  const turn = envTurnServer()
  const turnServers: RTCIceServer[] = turn ? [turn] : [PUBLIC_TURN]
  return [
    { urls: 'stun:stun.l.google.com:19302' },
    { urls: 'stun:stun.cloudflare.com:3478' },
    ...turnServers,
  ]
}
