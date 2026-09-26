import { useEffect, useRef, useState } from 'react'
import { Link, useParams } from 'react-router-dom'
import { Brand } from '../components/Brand.tsx'
import { useShareRoom } from '../hooks/useShareRoom.ts'
import { formatFileSize } from '../lib/format.ts'
import { isValidRoomCode, normalizeRoomCode } from '../lib/room-code.ts'
import { MAX_TEXT_LENGTH } from '../types.ts'

export function RoomPage() {
  const params = useParams()
  const roomCode = normalizeRoomCode(params.code ?? '')
  const fileInputRef = useRef<HTMLInputElement>(null)
  const [dragOver, setDragOver] = useState(false)
  const room = useShareRoom(roomCode)

  useEffect(() => {
    document.title = isValidRoomCode(roomCode) ? `Room ${roomCode} — Relay` : 'Invalid Room — Relay'
    let metaRobots = document.querySelector<HTMLMetaElement>('meta[name="robots"]')
    const created = !metaRobots
    if (!metaRobots) {
      metaRobots = document.createElement('meta')
      metaRobots.name = 'robots'
      document.head.appendChild(metaRobots)
    }
    const previous = metaRobots.content
    metaRobots.content = 'noindex, nofollow'

    return () => {
      document.title = 'Relay — Real-Time Text & Peer-to-Peer File Transfer'
      if (metaRobots) {
        if (created) {
          metaRobots.remove()
        } else {
          metaRobots.content = previous
        }
      }
    }
  }, [roomCode])

  if (!isValidRoomCode(roomCode)) {
    return (
      <main className="blank">
        <div>
          <p className="kicker">Relay</p>
          <h1>That code is not a room.</h1>
          <p className="lede">Codes are six letters or numbers.</p>
          <Link to="/" className="btn btn-lime" style={{ display: 'inline-flex', marginTop: '1.4rem' }}>
            Back to start
          </Link>
        </div>
      </main>
    )
  }

  const takeFiles = (list: FileList | File[] | null) => {
    if (!list || (Array.isArray(list) ? list.length === 0 : list.length === 0)) return
    void room.uploadFiles(list)
  }

  return (
    <div className="shell">
      <header className="topbar">
        <div>
          <Brand />
          <div className="room-id" aria-label={`Room ${roomCode}`} style={{ marginTop: '0.7rem' }}>
            {[...roomCode].map((char, index) => (
              <span className="tile" key={`${char}-${index}`}>
                {char}
              </span>
            ))}
          </div>
          <div className="status">
            <span>
              <span className={`dot ${room.isConnected ? 'live' : 'wait'}`} />
              {room.connectionStatus}
            </span>
            <span>
              <span className={`dot ${room.connectedPeers > 0 ? 'live' : 'wait'}`} />
              {room.peerLabel}
            </span>
          </div>
        </div>
        <div className="actions">
          <button type="button" className="btn btn-lime" onClick={() => void room.copyShareLink()}>
            {room.copied ? 'Link copied' : 'Copy invite'}
          </button>
          <Link to="/" className="btn btn-ghost">
            Leave
          </Link>
        </div>
      </header>

      <main className="workspace">
        {room.error ? <p className="err" style={{ gridColumn: '1 / -1' }}>{room.error}</p> : null}

        <section className="pane">
          <div className="pane-head">
            <h2>Notepad</h2>
            <span className="muted">
              {room.text.length.toLocaleString()} / {MAX_TEXT_LENGTH.toLocaleString()}
            </span>
          </div>
          <textarea
            className="editor"
            value={room.text}
            onChange={(event) => room.updateText(event.target.value)}
            disabled={!room.isConnected}
            placeholder="Write here. Anyone in this room sees it as you type."
          />
        </section>

        <section className="pane">
          <div className="pane-head">
            <h2>Dropbox</h2>
            <span className="muted">Direct P2P · 100 MB max</span>
          </div>
          <input
            ref={fileInputRef}
            type="file"
            multiple
            hidden
            disabled={!room.isConnected}
            onChange={(event) => {
              takeFiles(event.target.files)
              event.target.value = ''
            }}
          />
          <div
            className={`drop${dragOver ? ' active' : ''}`}
            role="button"
            tabIndex={0}
            onClick={() => fileInputRef.current?.click()}
            onKeyDown={(event) => {
              if (event.key === 'Enter' || event.key === ' ') fileInputRef.current?.click()
            }}
            onDragOver={(event) => {
              event.preventDefault()
              setDragOver(true)
            }}
            onDragLeave={() => setDragOver(false)}
            onDrop={(event) => {
              event.preventDefault()
              setDragOver(false)
              takeFiles(event.dataTransfer.files)
            }}
          >
            <strong>Drop files, or click to choose</strong>
            Queued until another device is on the wire.
          </div>
          <div className="files">
            {room.files.length === 0 ? (
              <p className="muted" style={{ textAlign: 'center', padding: '2rem 0' }}>
                Nothing in the box yet.
              </p>
            ) : (
              room.files.map((file) => (
                <article className="file" key={file.id}>
                  <div>
                    <b>{file.name}</b>
                    <div className="meta">
                      <span>{formatFileSize(file.size)}</span>
                      <span
                        className={`chip ${file.status === 'completed' ? 'ok' : file.status === 'error' ? 'bad' : 'warn'}`}
                      >
                        {file.status}
                      </span>
                      {file.progress < 100 ? (
                        <span className="bar">
                          <span style={{ width: `${file.progress}%` }} />
                        </span>
                      ) : null}
                    </div>
                  </div>
                  <div className="actions">
                    {file.status === 'completed' && file.blobUrl ? (
                      <a href={file.blobUrl} download={file.name}>
                        Save
                      </a>
                    ) : null}
                    <button type="button" className="btn btn-danger" onClick={() => room.deleteFile(file.id)}>
                      Remove
                    </button>
                  </div>
                </article>
              ))
            )}
          </div>
        </section>
      </main>
    </div>
  )
}
