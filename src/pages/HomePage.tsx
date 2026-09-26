import { useEffect, useState, type FormEvent } from 'react'
import { useNavigate } from 'react-router-dom'
import { Brand } from '../components/Brand.tsx'
import { generateRoomCode, isValidRoomCode, normalizeRoomCode } from '../lib/room-code.ts'

export function HomePage() {
  const navigate = useNavigate()
  const [roomCode, setRoomCode] = useState('')
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    document.title = 'Relay — Real-Time Text & Peer-to-Peer File Transfer'
  }, [])

  const joinRoom = (event: FormEvent) => {
    event.preventDefault()
    const code = normalizeRoomCode(roomCode)
    if (!isValidRoomCode(code)) {
      setError('Need a 6-character code.')
      return
    }
    navigate(`/r/${code}`)
  }

  return (
    <div className="shell">
      <header className="topbar">
        <Brand />
        <span className="muted">No accounts · Direct device transfer</span>
      </header>

      <main className="home">
        <section>
          <p className="kicker">Realtime rooms</p>
          <h1 className="display">A private wire between screens.</h1>
          <p className="lede">
            Open a room, pass the code, and talk in one shared notepad. Files move
            peer-to-peer. The server never keeps them.
          </p>
          <ul className="facts">
            <li>
              <strong>Text</strong>
              <span>Live sync over the socket. Everyone sees the same draft.</span>
            </li>
            <li>
              <strong>Files</strong>
              <span>WebRTC between browsers. Metadata only on the server.</span>
            </li>
            <li>
              <strong>Access</strong>
              <span>Six-character codes. Walk away and the room expires.</span>
            </li>
          </ul>
        </section>

        <aside className="gate">
          <h2>Step in</h2>
          <p>Start a new room or drop in with a code you already have.</p>
          <button type="button" className="btn btn-lime" onClick={() => navigate(`/r/${generateRoomCode()}`)}>
            Open a room
          </button>
          <div className="split">
            <span />
            join existing
            <span />
          </div>
          <form className="join" onSubmit={joinRoom}>
            <label className="sr-only" htmlFor="room-code">
              Room code
            </label>
            <input
              id="room-code"
              className="field code-field"
              value={roomCode}
              onChange={(event) => {
                setRoomCode(normalizeRoomCode(event.target.value))
                setError(null)
              }}
              placeholder="CODE"
              autoComplete="off"
              spellCheck={false}
              maxLength={6}
            />
            <button type="submit" className="btn btn-ghost">
              Enter
            </button>
          </form>
          {error ? <p className="err">{error}</p> : null}
        </aside>
      </main>
    </div>
  )
}
