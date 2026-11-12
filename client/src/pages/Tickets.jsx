import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { IconTicket } from '@tabler/icons-react';
import { api } from '../api/client.js';
import TicketPass from '../components/ui/TicketPass.jsx';

export default function Tickets() {
  const [data, setData] = useState(null);
  const [tab, setTab] = useState('upcoming');
  const [error, setError] = useState('');
  useEffect(() => { api('/me/tickets').then(setData).catch((e) => setError(e.message)); }, []);

  const list = data?.[tab] || [];
  return (
    <div className="container ev-top">
      <h1 className="ev-title" style={{ fontSize: 'clamp(32px, 5vw, 48px)' }}>My tickets</h1>
      <div className="chips" role="tablist" aria-label="Ticket lists">
        {['upcoming', 'past'].map((t) => (
          <button key={t} type="button" role="tab" aria-selected={tab === t} className={`chip ${tab === t ? 'on' : ''}`} onClick={() => setTab(t)}>
            {t === 'upcoming' ? 'Upcoming' : 'Past'}{data ? ` · ${data[t].length}` : ''}
          </button>
        ))}
      </div>
      {error && <p className="notice error" role="alert">{error}</p>}
      {!data ? <div className="skeleton" style={{ minHeight: 220, marginTop: 24 }} />
        : list.length === 0 ? (
          <div className="empty">
            <span className="empty-icon"><IconTicket size={34} aria-hidden="true" /></span>
            <h2>{tab === 'upcoming' ? 'No plans yet' : 'No past events'}</h2>
            <p className="muted">{tab === 'upcoming' ? 'Tickets you buy or RSVP for will appear here with their QR codes.' : 'Events you went to will be listed here.'}</p>
            {tab === 'upcoming' && <Link to="/" className="btn btn-primary">Find the move</Link>}
          </div>
        ) : (
          <div className="ticket-groups">
            {list.map((o) => (
              <section key={o.order_number} className="ticket-group">
                <p className="faint small">Order <Link to={`/orders/${o.order_number}`} className="link">{o.order_number}</Link></p>
                <div className="passes">
                  {o.tickets.map((t, i) => <TicketPass key={t.code} event={o} ticket={t} index={i} total={o.tickets.length} />)}
                </div>
              </section>
            ))}
          </div>
        )}
    </div>
  );
}
