import { useEffect } from 'react'
import { Link } from 'react-router-dom'

export function NotFoundPage() {
  useEffect(() => {
    document.title = '404 Not Found — Relay'
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
  }, [])
  return (
    <main className="blank">
      <div>
        <p className="kicker">Relay</p>
        <h1>No such path.</h1>
        <p className="lede">That URL is not a room and not a page.</p>
        <Link to="/" className="btn btn-lime" style={{ display: 'inline-flex', marginTop: '1.4rem' }}>
          Back to start
        </Link>
      </div>
    </main>
  )
}
