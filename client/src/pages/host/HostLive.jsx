import { useCallback, useEffect, useRef, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { IconAlertTriangle, IconArrowLeft, IconBolt, IconCheck, IconFlame, IconShieldX, IconX } from '@tabler/icons-react';
import { api, timeLabel } from '../../api/client.js';
import { useLiveEvent } from '../../context/RealtimeContext.jsx';
import LiveBadge from '../../components/ui/LiveBadge.jsx';

const POLL_MS = 30000; // backup only: updates normally arrive instantly over the live connection

/** The night-of screen: who is in, how fast people are arriving, and every scan as it happens. */
export default function HostLive() {
  const { slug } = useParams();
  const [data, setData] = useState(null);
  const [error, setError] = useState('');
  const [fresh, setFresh] = useState(new Set());
  const seen = useRef(null);
  const timer = useRef(null);

  const load = useCallback(async () => {
    try {
      const d = await api(`/host/events/${slug}/live`);
      // Highlight scans that arrived since the last refresh
      if (seen.current) setFresh(new Set(d.feed.filter((f) => !seen.current.has(f.id)).map((f) => f.id)));
      seen.current = new Set(d.feed.map((f) => f.id));
      setData(d);
    } catch (e) { setError(e.message); }
  }, [slug]);

  useEffect(() => {
    load();
    const t = setInterval(load, POLL_MS);
    return () => clearInterval(t);
  }, [load]);

  // Many scans can land in the same second at a busy door: refresh at most twice a second
  useLiveEvent('checkin:changed', (msg) => {
    if (msg.event !== slug || timer.current) return;
    timer.current = setTimeout(() => { timer.current = null; load(); }, 400);
  });

  if (error) return <div className="container empty"><h1>Live check-in</h1><p className="muted">{error}</p><Link to="/host" className="btn btn-primary">Dashboard</Link></div>;
  if (!data) return <div className="container ev-top"><div className="skeleton" style={{ minHeight: 480 }} /></div>;
  const { event, counts, tiers, arrivals, refused, staff, feed } = data;
  const pct = counts.expected ? Math.round((counts.checked_in / counts.expected) * 100) : 0;
  const refusedTotal = refused.already_used + refused.wrong_event + refused.invalid;
  const max = Math.max(1, ...arrivals.map((a) => a.admits));

  return (
    <div className="container ev-top live-page">
      <Link to={`/host/e/${slug}`} className="back"><IconArrowLeft size={18} aria-hidden="true" /> Back to event</Link>
      <div className="dash-head">
        <div>
          <p className="eyebrow">Live check-in</p>
          <h1 className="ev-title" style={{ fontSize: 'clamp(28px, 4.2vw, 42px)' }}>{event.title}</h1>
          <LiveBadge fallback="Reconnecting… refreshing every 30 seconds meanwhile" />
        </div>
        <Link to={`/door/${slug}`} className="btn btn-ghost btn-sm">Open the scanner</Link>
      </div>

      <div className="live-top">
        <div className="ring-card">
          <Ring pct={pct} />
          <div>
            <p className="ring-num" aria-live="polite"><strong>{counts.checked_in}</strong> in</p>
            <p className="muted">of {counts.expected} expected · {counts.expected - counts.checked_in} still to arrive</p>
          </div>
        </div>
        <div className="live-cards">
          <div className="live-card"><IconBolt size={22} aria-hidden="true" /><div><strong>+{counts.last_15_min}</strong><span>in the last 15 minutes</span></div></div>
          <div className="live-card"><IconFlame size={22} aria-hidden="true" /><div><strong>{counts.peak ? counts.peak.admits : 0}</strong><span>{counts.peak ? `busiest 15 minutes, from ${timeLabel(counts.peak.at)}` : 'busiest 15 minutes'}</span></div></div>
          <div className={`live-card ${refusedTotal ? 'warn' : ''}`}><IconShieldX size={22} aria-hidden="true" /><div><strong>{refusedTotal}</strong>
            <span>refused: {refused.already_used} reused, {refused.wrong_event} wrong event, {refused.invalid} fake</span></div></div>
        </div>
      </div>

      <div className="dash-grid">
        <div className="dash-col">
          <section className="panel">
            <h2>Arrivals every 15 minutes</h2>
            <div className="chart live-chart" style={{ gridTemplateColumns: `repeat(${arrivals.length}, 1fr)` }}
              role="img" aria-label={`Arrivals per 15 minutes: ${arrivals.map((a) => `${timeLabel(a.at)} ${a.admits}`).join(', ')}`}>
              {arrivals.map((a, i) => (
                <div key={a.at} className="bar-col" title={`${timeLabel(a.at)}: ${a.admits} people`}>
                  <span className="bar-val">{a.admits || ''}</span>
                  <span className={`bar ${i === arrivals.length - 1 ? 'now' : ''}`} style={{ height: `${(a.admits / max) * 100}%` }} />
                  <span className="bar-day">{i % Math.ceil(arrivals.length / 8) === 0 ? timeLabel(a.at) : ''}</span>
                </div>
              ))}
            </div>
          </section>

          <section className="panel">
            <h2>By ticket type</h2>
            <ul className="tier-bars">
              {tiers.filter((t) => Number(t.expected) > 0).map((t) => {
                const p = Math.round((t.checked_in / t.expected) * 100);
                return (
                  <li key={t.name}>
                    <div className="tier-bars-label"><strong>{t.name}</strong><span className="muted small">{t.checked_in} of {t.expected}{t.admits > 1 ? ' people' : ''}</span></div>
                    <div className="meter big"><span style={{ width: `${p}%` }} /></div>
                  </li>
                );
              })}
            </ul>
          </section>

          {staff.length > 0 && (
            <section className="panel">
              <h2>Door team</h2>
              <ul className="feed">
                {staff.map((s) => (
                  <li key={s.name}><div><strong>{s.name}</strong><span className="muted small">{s.scans} scans</span></div><span className="price">{s.admitted} let in</span></li>
                ))}
              </ul>
            </section>
          )}
        </div>

        <aside className="panel">
          <h2>Latest scans</h2>
          {feed.length === 0 ? <p className="muted small">Scans will appear here the moment the door starts letting people in.</p> : (
            <ul className="scan-feed">
              {feed.map((f) => {
                const Icon = f.result === 'admitted' ? IconCheck : f.result === 'undone' ? IconArrowLeft : f.result === 'invalid' ? IconAlertTriangle : IconX;
                return (
                  <li key={f.id} className={`${f.result} ${fresh.has(f.id) ? 'fresh' : ''}`}>
                    <span className="scan-icon"><Icon size={16} aria-hidden="true" /></span>
                    <div>
                      <strong>{f.guest || 'Unknown code'}</strong>
                      <span className="muted small">
                        {f.result === 'admitted' ? `${f.tier}${f.admits > 1 ? ` · ${f.admits} people` : ''}`
                          : f.result === 'already_used' ? 'Tried to use a ticket again'
                            : f.result === 'wrong_event' ? 'Ticket for another event'
                              : f.result === 'undone' ? 'Check-in undone' : 'Not a real ticket'} · {f.staff}
                      </span>
                    </div>
                    <time className="faint small">{timeLabel(f.created_at)}</time>
                  </li>
                );
              })}
            </ul>
          )}
        </aside>
      </div>
    </div>
  );
}

function Ring({ pct }) {
  const r = 52;
  const c = 2 * Math.PI * r;
  return (
    <svg className="ring" viewBox="0 0 120 120" role="img" aria-label={`${pct}% of guests checked in`}>
      <circle cx="60" cy="60" r={r} className="ring-track" />
      <circle cx="60" cy="60" r={r} className="ring-fill" strokeDasharray={c} strokeDashoffset={c * (1 - pct / 100)} />
      <text x="60" y="66" textAnchor="middle" className="ring-text">{pct}%</text>
    </svg>
  );
}
