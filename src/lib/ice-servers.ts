function extraIceServers(): RTCIceServer[] {
  const turnUrl = import.meta.env.VITE_TURN_URL as string | undefined
  const username = import.meta.env.VITE_TURN_USERNAME as string | undefined
  const credential = import.meta.env.VITE_TURN_CREDENTIAL as string | undefined
  if (turnUrl && username && credential) {
    const urls = turnUrl.includes(',') ? turnUrl.split(',').map((u) => u.trim()) : turnUrl
    return [{ urls, username, credential }]
  }
  return []
}

export function getIceServers(): RTCIceServer[] {
  return [
    { urls: 'stun:stun.l.google.com:19302' },
    { urls: 'stun:stun1.l.google.com:19302' },
    { urls: 'stun:stun2.l.google.com:19302' },
    { urls: 'stun:stun.cloudflare.com:3478' },
    { urls: 'stun:stun.nextcloud.com:443' },
    ...extraIceServers(),
  ]
}
