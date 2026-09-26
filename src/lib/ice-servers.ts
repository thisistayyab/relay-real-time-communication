function extraIceServers(): RTCIceServer[] {
  const turnUrl = import.meta.env.VITE_TURN_URL as string | undefined
  const username = import.meta.env.VITE_TURN_USERNAME as string | undefined
  const credential = import.meta.env.VITE_TURN_CREDENTIAL as string | undefined
  if (turnUrl && username && credential) {
    return [{ urls: turnUrl, username, credential }]
  }
  return []
}

export function getIceServers(): RTCIceServer[] {
  return [
    { urls: 'stun:stun.l.google.com:19302' },
    { urls: 'stun:stun1.l.google.com:19302' },
    ...extraIceServers(),
  ]
}
