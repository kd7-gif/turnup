import { useEffect, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import {
  IconArrowLeft, IconCalendarEvent, IconCircleCheckFilled, IconMapPin, IconShare, IconTicket, IconUsers,
} from '@tabler/icons-react';
import { api, dayLabel, naira, timeLabel, whenLabel } from '../api/client.js';
import { useAuth } from '../context/AuthContext.jsx';
import { Faces } from '../components/ui/Avatar.jsx';
import SaveButton from '../components/ui/SaveButton.jsx';
import { goingText } from '../components/ui/EventCard.jsx';
import TicketPicker from '../components/ui/TicketPicker.jsx';

export default function EventPage() {
  const { slug } = useParams();
  const { user } = useAuth();
  const [data, setData] = useState(null);
  const [error, setError] = useState('');
  const [toast, setToast] = useState('');

  useEffect(() => {
    setData(null);
    setError('');
    api(`/events/${slug}`).then(setData).catch((e) => setError(e.message));
  }, [slug, user]);

  useEffect(() => {
    if (!toast) return undefined;
    const t = setTimeout(() => setToast(''), 2200);
    return () => clearTimeout(t);
  }, [toast]);

  if (error) {
    return (
      <div className="container empty">
        <h1>Event not found</h1>
        <p className="muted">{error}</p>
        <Link to="/" className="btn btn-primary">Find something else</Link>
      </div>
    );
  }
  if (!data) return <div className="container ev-top"><div className="skeleton" style={{ minHeight: 420 }} /></div>;

  const { event: e, host, tiers, going_preview: goingPreview } = data;
  const when = whenLabel(e.starts_at, e.ends_at);

  const share = async () => {
    const url = window.location.href;
    try {
      if (navigator.share) { await navigator.share({ title: e.title, url }); return; }
      await navigator.clipboard.writeText(url);
      setToast('Link copied');
    } catch { /* the visitor closed the share sheet */ }
  };

  return (
    <article className="container ev-top">
      <Link to="/" className="back"><IconArrowLeft size={18} aria-hidden="true" /> All events</Link>
      {e.draft && <p className="notice info" style={{ marginTop: 12 }}>This is a preview of a draft. Only you and your co-hosts can see it until you publish.</p>}
      {e.cancelled && <p className="notice error" style={{ marginTop: 12 }}>This event has been cancelled.</p>}
      <div className="ev-hero">
        <img src={e.image_url} alt={e.title} />
        <span className={`when-pill ${when === 'Happening now' ? 'now' : ''}`}>{when}</span>
      </div>

      <div className="ev-layout">
        <div className="ev-main">
          <div>
            <p className="eyebrow">{e.category}</p>
            <h1 className="ev-title">{e.title}</h1>
            <p className="muted" style={{ fontSize: 19, marginTop: 8 }}>{e.summary}</p>
          </div>

          <div className="ev-actions">
            <SaveButton slug={e.slug} title={e.title} saved={e.saved} className="btn btn-ghost" withLabel />
            <button type="button" className="btn btn-ghost" onClick={share}><IconShare size={20} aria-hidden="true" /> Share</button>
          </div>

          <div className="ev-facts">
            <div className="fact">
              <span className="fact-icon"><IconCalendarEvent size={22} aria-hidden="true" /></span>
              <div><b>{dayLabel(e.starts_at)}</b><span>{timeLabel(e.starts_at)} to {timeLabel(e.ends_at)}</span></div>
            </div>
            <div className="fact">
              <span className="fact-icon"><IconMapPin size={22} aria-hidden="true" /></span>
              <div><b>{e.venue}</b><span>{e.area}, {e.city}</span></div>
            </div>
          </div>

          {(e.friends_count > 0 || e.going_count > 0) && (
            <div className="going-panel">
              <Faces names={e.friends_count > 0 ? e.friends_going : goingPreview.slice(0, 4)} />
              <p>{e.friends_count > 0 ? `${goingText(e)} · ${e.going_count} going in total` : `${e.going_count} people are going`}</p>
            </div>
          )}

          <section className="ev-section">
            <h2>About this event</h2>
            <p className="ev-desc">{e.description}</p>
          </section>

          <section className="ev-section">
            <h2>Hosted by</h2>
            <div className="host-card">
              {host.image_url && <img src={host.image_url} alt="" />}
              <div className="host-card-text">
                <Link to={`/h/${host.slug}`}>{host.name} {host.verified && <IconCircleCheckFilled size={18} className="verified" aria-label="Verified host" />}</Link>
                <p className="muted small"><IconUsers size={15} aria-hidden="true" style={{ verticalAlign: '-2px' }} /> {host.followers} followers</p>
              </div>
              <Link to={`/h/${host.slug}`} className="btn btn-ghost btn-sm">View host</Link>
            </div>
          </section>
        </div>

        <aside className="tickets" id="tickets" aria-label="Tickets">
          <Countdown starts={e.starts_at} ends={e.ends_at} />
          <h2 style={{ fontSize: 22, fontWeight: 800 }}><IconTicket size={22} aria-hidden="true" style={{ verticalAlign: '-4px' }} /> Tickets</h2>
          <TicketPicker event={e} tiers={tiers} ended={new Date(e.ends_at) <= new Date() || e.cancelled} />
        </aside>
      </div>
      <div className="ticket-bar">
        <div><strong>{e.is_free ? 'Free' : e.from_price == null ? 'Sold out' : `From ${naira(e.from_price)}`}</strong><span>{dayLabel(e.starts_at)} · {timeLabel(e.starts_at)}</span></div>
        <a href="#tickets" className="btn btn-primary">{e.is_free ? 'RSVP' : 'Get tickets'}</a>
      </div>
      {toast && <div className="toast" role="status">{toast}</div>}
    </article>
  );
}

/** Live countdown to the start, ticking every second. */
function Countdown({ starts, ends }) {
  const [now, setNow] = useState(Date.now());
  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(t);
  }, []);
  const left = new Date(starts).getTime() - now;
  if (left <= 0) {
    return <div className="countdown live" role="timer">{new Date(ends).getTime() > now ? 'Happening now' : 'This event has ended'}</div>;
  }
  const parts = [
    [Math.floor(left / 86400000), 'days'],
    [Math.floor(left / 3600000) % 24, 'hours'],
    [Math.floor(left / 60000) % 60, 'mins'],
    [Math.floor(left / 1000) % 60, 'secs'],
  ];
  return (
    <div className="countdown" role="timer" aria-label={`Starts in ${parts[0][0]} days and ${parts[1][0]} hours`}>
      {parts.map(([n, label]) => <div key={label}><b>{String(n).padStart(2, '0')}</b><span>{label}</span></div>)}
    </div>
  );
}
