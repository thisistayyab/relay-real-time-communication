import { Link } from 'react-router-dom'

export function Brand() {
  return (
    <Link to="/" className="brand">
      <img src="/favicon.svg" alt="" className="brand-mark" width={28} height={28} />
      Relay
    </Link>
  )
}
