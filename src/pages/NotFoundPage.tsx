import { Link } from 'react-router-dom'

export function NotFoundPage() {
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
