import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { IconHeart } from '@tabler/icons-react';
import { api } from '../api/client.js';
import EventCard from '../components/ui/EventCard.jsx';

export default function Saved() {
  const [items, setItems] = useState(null);
  const [error, setError] = useState('');
  useEffect(() => { api('/me/saved').then((d) => setItems(d.items)).catch((e) => setError(e.message)); }, []);

  return (
    <div className="container ev-top">
      <h1 className="ev-title" style={{ fontSize: 'clamp(32px, 5vw, 48px)' }}>Saved</h1>
      {error && <p className="notice error" role="alert">{error}</p>}
      {!items ? <div className="grid" style={{ marginTop: 24 }}>{[0, 1, 2].map((i) => <div key={i} className="skeleton" />)}</div>
        : items.length === 0 ? (
          <div className="empty">
            <span className="empty-icon"><IconHeart size={34} aria-hidden="true" /></span>
            <h2>Save events you like</h2>
            <p className="muted">Tap the heart on any event and it will wait for you here.</p>
            <Link to="/" className="btn btn-primary">Find events</Link>
          </div>
        ) : <div className="grid" style={{ marginTop: 24 }}>{items.map((e) => <EventCard key={e.id} e={e} />)}</div>}
    </div>
  );
}
