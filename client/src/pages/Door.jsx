import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { IconScan } from '@tabler/icons-react';
import { api, dayLabel, timeLabel, whenLabel } from '../api/client.js';

/** The events this person can check guests in for. */
export default function Door() {
  const [items, setItems] = useState(null);
  const [error, setError] = useState('');
  useEffect(() => { api('/checkin/events').then((d) => setItems(d.items)).catch((e) => setError(e.message)); }, []);

  return (
    <div className="container ev-top">
      <p className="eyebrow">Door</p>
      <h1 className="ev-title" style={{ fontSize: 'clamp(32px, 5vw, 48px)' }}>Check guests in</h1>
      <p className="muted" style={{ marginTop: 6 }}>Pick an event, then scan each guest’s QR code at the door.</p>
      {error && <p className="notice error" role="alert">{error}</p>}
      {!items ? <div className="skeleton" style={{ minHeight: 200, marginTop: 24 }} />
        : items.length === 0 ? (
          <div className="empty"><h2>No events to check in</h2><p className="muted">When a host adds you to their door team, their events appear here.</p></div>
        ) : (
          <ul className="door-list">
            {items.map((e) => {
              const pct = e.expected ? Math.round((e.checked_in / e.expected) * 100) : 0;
              return (
                <li key={e.id}>
                  <Link to={`/door/${e.slug}`} className="door-card">
                    <img src={e.image_url} alt="" />
                    <div className="door-card-text">
                      <p className="e-card-meta">{whenLabel(e.starts_at, e.ends_at)} · {e.host_name}</p>
                      <h2>{e.title}</h2>
                      <p className="muted small">{dayLabel(e.starts_at)} · {timeLabel(e.starts_at)} · {e.venue}</p>
                      <div className="meter" aria-label={`${e.checked_in} of ${e.expected} guests checked in`}><span style={{ width: `${pct}%` }} /></div>
                      <p className="small"><strong>{e.checked_in}</strong> of {e.expected} in</p>
                    </div>
                    <span className="btn btn-primary btn-sm door-go"><IconScan size={18} aria-hidden="true" /> Scan</span>
                  </Link>
                </li>
              );
            })}
          </ul>
        )}
    </div>
  );
}
