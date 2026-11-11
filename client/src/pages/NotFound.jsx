import { Link } from 'react-router-dom';

export default function NotFound() {
  return (
    <div className="container empty">
      <h1>This page left the party</h1>
      <p className="muted">The link may be old, or the event may have been removed.</p>
      <Link to="/" className="btn btn-primary">Find events</Link>
    </div>
  );
}
