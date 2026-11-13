import { useEffect, useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { IconCash, IconCalendarEvent, IconPlus, IconTicket, IconUsers } from '@tabler/icons-react';
import { api, dayLabel, naira, timeLabel } from '../../api/client.js';
import PromoCodes from './PromoCodes.jsx';
import { useLiveEvent } from '../../context/RealtimeContext.jsx';
import LiveBadge from '../../components/ui/LiveBadge.jsx';
import Team from './Team.jsx';

export const STATUS = { published: ['Live', 'live'], draft: ['Draft', 'draft'], cancelled: ['Cancelled', 'cancelled'] };

export default function HostDashboard() {
  const [params, setParams] = useSearchParams();
  const [data, setData] = useState(null);
  const [error, setError] = useState('');
  const tab = params.get('tab') || 'events';
  const hostSlug = params.get('host') || '';

  const load = () => api(`/host/overview${hostSlug ? `?host=${hostSlug}` : ''}`).then(setData).catch((e) => setError(e.message));
  useEffect(() => { load(); }, [hostSlug]); // eslint-disable-line react-hooks/exhaustive-deps
  useLiveEvent('sales:changed', () => load()); // a sale anywhere updates the numbers and the feed

  if (error) return <div className="container empty"><h1>Host tools</h1><p className="muted">{error}</p></div>;
  if (!data) return <div className="container ev-top"><div className="skeleton" style={{ minHeight: 420 }} /></div>;
  const { host, hosts, totals, events, recent } = data;
  const set = (k, v) => { const p = new URLSearchParams(params); p.set(k, v); setParams(p); };

  return (
    <div className="container ev-top host-dash">
      <div className="dash-head">
        <div>
          <p className="eyebrow">Host dashboard</p>
          {hosts.length > 1 ? (
            <select className="host-switch" aria-label="Choose a host" value={host.slug} onChange={(e) => set('host', e.target.value)}>
              {hosts.map((h) => <option key={h.slug} value={h.slug}>{h.name}</option>)}
            </select>
          ) : <h1 className="ev-title" style={{ fontSize: 'clamp(30px, 4.5vw, 44px)' }}>{host.name}</h1>}
          <p className="muted small">{host.role === 'owner' ? 'You own this host' : 'You are a co-host'} · <Link to={`/h/${host.slug}`} className="link">Public page</Link></p>
        </div>
        <Link to={`/host/new?host=${host.slug}`} className="btn btn-primary"><IconPlus size={20} aria-hidden="true" /> Create event</Link>
      </div>

      <div className="stats">
        <Stat icon={IconCash} label="Revenue, last 30 days" value={naira(totals.revenue_30d)} />
        <Stat icon={IconTicket} label="Tickets sold" value={Number(totals.tickets_sold).toLocaleString('en-NG')} />
        <Stat icon={IconCalendarEvent} label="Upcoming events" value={totals.upcoming} />
        <Stat icon={IconUsers} label="Followers" value={totals.followers} />
      </div>

      <div className="chips" role="tablist" aria-label="Sections">
        {[['events', 'Events'], ['promos', 'Promo codes'], ['team', 'Team']].map(([k, label]) => (
          <button key={k} type="button" role="tab" aria-selected={tab === k} className={`chip ${tab === k ? 'on' : ''}`} onClick={() => set('tab', k)}>{label}</button>
        ))}
      </div>

      {tab === 'events' && (
        <div className="dash-grid">
          <section>
            {events.length === 0 ? (
              <div className="empty"><h2>Create your first event</h2><p className="muted">Set a date, add ticket types and publish when you are ready.</p>
                <Link to={`/host/new?host=${host.slug}`} className="btn btn-primary">Create event</Link></div>
            ) : (
              <ul className="dash-events">
                {events.map((e) => {
                  const pct = e.capacity ? Math.round((e.sold / e.capacity) * 100) : 0;
                  const [label, cls] = e.past && e.status === 'published' ? ['Ended', 'ended'] : STATUS[e.status];
                  return (
                    <li key={e.id}>
                      <Link to={`/host/e/${e.slug}`} className="dash-event">
                        <img src={e.image_url} alt="" />
                        <div className="dash-event-text">
                          <p className="small muted"><span className={`pill ${cls}`}>{label}</span> {dayLabel(e.starts_at)} · {timeLabel(e.starts_at)}</p>
                          <h3>{e.title}</h3>
                          <div className="meter" aria-label={`${e.sold} of ${e.capacity} sold`}><span style={{ width: `${pct}%` }} /></div>
                          <p className="small"><strong>{e.sold}</strong> of {e.capacity} sold{e.held > 0 ? ` · ${e.held} in checkout` : ''}</p>
                        </div>
                        <div className="dash-event-money"><strong className="price">{naira(e.revenue)}</strong><span className="muted small">revenue</span></div>
                      </Link>
                    </li>
                  );
                })}
              </ul>
            )}
          </section>
          <aside className="panel">
            <h2>Latest sales</h2>
            <LiveBadge fallback="Refresh to see new sales" />
            {recent.length === 0 ? <p className="muted small">Sales will appear here as they happen.</p> : (
              <ul className="feed">
                {recent.map((o) => (
                  <li key={o.order_number}>
                    <div><strong>{o.buyer}</strong><span className="muted small">{o.tickets} × {o.title}</span></div>
                    <span className="price">{naira(o.amount)}</span>
                  </li>
                ))}
              </ul>
            )}
          </aside>
        </div>
      )}
      {tab === 'promos' && <PromoCodes host={host} events={events} />}
      {tab === 'team' && <Team host={host} />}
    </div>
  );
}

export function Stat({ icon: Icon, label, value, sub }) {
  return (
    <div className="stat">
      <span className="stat-icon"><Icon size={20} aria-hidden="true" /></span>
      <div><p className="stat-value">{value}</p><p className="muted small">{label}</p>{sub && <p className="faint small">{sub}</p>}</div>
    </div>
  );
}
