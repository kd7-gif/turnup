import { useCallback, useEffect, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { IconArrowLeft, IconCash, IconEdit, IconExternalLink, IconPlus, IconScan, IconTicket, IconTrash, IconUserCheck } from '@tabler/icons-react';
import { api, dayLabel, naira, timeLabel } from '../../api/client.js';
import { Stat, STATUS } from './HostDashboard.jsx';

export default function HostEvent() {
  const { slug } = useParams();
  const [data, setData] = useState(null);
  const [error, setError] = useState('');
  const [msg, setMsg] = useState({ text: '', bad: false });
  const [confirm, setConfirm] = useState('');
  const load = useCallback(() => api(`/host/events/${slug}`).then(setData).catch((e) => setError(e.message)), [slug]);
  useEffect(() => { load(); }, [load]);

  if (error) return <div className="container empty"><h1>Event not found</h1><p className="muted">{error}</p><Link to="/host" className="btn btn-primary">Dashboard</Link></div>;
  if (!data) return <div className="container ev-top"><div className="skeleton" style={{ minHeight: 420 }} /></div>;
  const { event: e, tiers, days, orders } = data;
  const past = new Date(e.ends_at) <= new Date();
  const [label, cls] = past && e.status === 'published' ? ['Ended', 'ended'] : STATUS[e.status];

  const setStatus = async (status) => {
    setConfirm('');
    try {
      await api(`/host/events/${slug}`, { method: 'PATCH', body: { status } });
      setMsg({ text: status === 'published' ? 'Your event is live.' : status === 'draft' ? 'Moved back to drafts.' : 'Event cancelled. Ticket sales have stopped.', bad: false });
      load();
    } catch (err) { setMsg({ text: err.message, bad: true }); }
  };
  const max = Math.max(1, ...days.map((d) => d.tickets));

  return (
    <div className="container ev-top host-event">
      <Link to="/host" className="back"><IconArrowLeft size={18} aria-hidden="true" /> Dashboard</Link>
      <div className="dash-head">
        <div style={{ minWidth: 0 }}>
          <p className="small muted"><span className={`pill ${cls}`}>{label}</span> {dayLabel(e.starts_at)} · {timeLabel(e.starts_at)} · {e.venue}, {e.area}</p>
          <h1 className="ev-title" style={{ fontSize: 'clamp(28px, 4.2vw, 42px)' }}>{e.title}</h1>
        </div>
        <div className="ev-actions">
          {e.status !== 'cancelled' && <Link to={`/host/e/${slug}/edit`} className="btn btn-ghost btn-sm"><IconEdit size={18} aria-hidden="true" /> Edit</Link>}
          <Link to={`/e/${slug}`} className="btn btn-ghost btn-sm"><IconExternalLink size={18} aria-hidden="true" /> {e.status === 'draft' ? 'Preview' : 'View'}</Link>
          {e.status === 'published' && <Link to={`/door/${slug}`} className="btn btn-ghost btn-sm"><IconScan size={18} aria-hidden="true" /> Door</Link>}
          {e.status === 'draft' && <button type="button" className="btn btn-primary btn-sm" onClick={() => setStatus('published')}>Publish</button>}
        </div>
      </div>
      {msg.text && <p className={`notice ${msg.bad ? 'error' : 'info'}`} role="status">{msg.text}</p>}

      <div className="stats">
        <Stat icon={IconTicket} label="Tickets sold" value={`${e.sold} / ${e.capacity}`} sub={e.held > 0 ? `${e.held} in checkout now` : null} />
        <Stat icon={IconCash} label="Revenue" value={naira(e.revenue)} sub="After discounts, before payout" />
        <Stat icon={IconUserCheck} label="Checked in" value={e.checked_in} />
      </div>

      <div className="dash-grid">
        <div className="dash-col">
          <section className="panel">
            <h2>Sales, last 14 days</h2>
            <div className="chart" role="img" aria-label={`Tickets sold per day: ${days.map((d) => `${d.day} ${d.tickets}`).join(', ')}`}>
              {days.map((d) => (
                <div key={d.day} className="bar-col" title={`${dayLabel(d.day)}: ${d.tickets} tickets`}>
                  <span className="bar-val">{d.tickets || ''}</span>
                  <span className="bar" style={{ height: `${(d.tickets / max) * 100}%` }} />
                  <span className="bar-day">{new Date(d.day).toLocaleDateString('en-GB', { day: 'numeric', timeZone: 'UTC' })}</span>
                </div>
              ))}
            </div>
          </section>

          <TierTable slug={slug} tiers={tiers} reload={load} locked={e.status === 'cancelled'} />

          <section className="panel">
            <h2>Orders</h2>
            {orders.length === 0 ? <p className="muted small">No orders yet.</p> : (
              <div className="table-wrap">
                <table className="table">
                  <thead><tr><th>Buyer</th><th>Tickets</th><th>Amount</th><th>When</th></tr></thead>
                  <tbody>
                    {orders.map((o) => (
                      <tr key={o.order_number}>
                        <td><strong>{o.buyer}</strong><br /><span className="faint small">{o.order_number}{o.status === 'pending' ? ' · paying now' : ''}</span></td>
                        <td>{o.items}</td>
                        <td className="price">{naira(o.amount)}</td>
                        <td className="small">{dayLabel(o.paid_at || o.created_at)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </section>
        </div>

        <aside className="panel">
          <h2>Event status</h2>
          <p className="muted small">
            {e.status === 'draft' ? 'Only you and your co-hosts can see this event. Publish it to start selling.'
              : e.status === 'cancelled' ? 'This event is cancelled. Ticket sales have stopped.'
                : past ? 'This event has ended.' : 'This event is live and selling tickets.'}
          </p>
          {e.status === 'published' && !past && (confirm === 'cancel' ? (
            <div className="k-confirm">
              <p className="small">Cancel {e.title}? Ticket sales stop straight away and this cannot be undone. Refunds are handled through Paystack.</p>
              <div className="ev-actions">
                <button type="button" className="btn btn-ghost btn-sm" onClick={() => setConfirm('')}>Keep it</button>
                <button type="button" className="btn btn-danger btn-sm" onClick={() => setStatus('cancelled')}>Yes, cancel event</button>
              </div>
            </div>
          ) : (
            <div className="ev-actions" style={{ flexDirection: 'column' }}>
              {e.sold === 0 && <button type="button" className="btn btn-ghost btn-sm" onClick={() => setStatus('draft')}>Unpublish (back to draft)</button>}
              <button type="button" className="btn btn-ghost btn-sm danger-text" onClick={() => setConfirm('cancel')}>Cancel event</button>
            </div>
          ))}
        </aside>
      </div>
    </div>
  );
}

function TierTable({ slug, tiers, reload, locked }) {
  const [edit, setEdit] = useState(null);
  const [adding, setAdding] = useState(false);
  const [err, setErr] = useState('');
  const save = async () => {
    setErr('');
    try {
      const body = { name: edit.name, price: Number(edit.price), quantity: Number(edit.quantity), admits: Number(edit.admits), max_per_order: Number(edit.max_per_order), description: edit.description || '' };
      if (edit.id) await api(`/host/events/${slug}/tiers/${edit.id}`, { method: 'PATCH', body });
      else await api(`/host/events/${slug}/tiers`, { method: 'POST', body });
      setEdit(null); setAdding(false); reload();
    } catch (e) { setErr(e.fields ? Object.values(e.fields).join(' ') || e.message : e.message); }
  };
  const remove = async (t) => {
    try { await api(`/host/events/${slug}/tiers/${t.id}`, { method: 'DELETE' }); reload(); } catch (e) { setErr(e.message); }
  };
  const row = (k, props = {}) => <input aria-label={k} value={edit[k]} onChange={(e) => setEdit({ ...edit, [k]: e.target.value })} {...props} />;

  return (
    <section className="panel">
      <div className="row-head" style={{ marginBottom: 8 }}>
        <h2>Ticket types</h2>
        {!locked && !edit && <button type="button" className="btn btn-ghost btn-sm" onClick={() => { setAdding(true); setEdit({ name: '', price: '', quantity: '', admits: 1, max_per_order: 10, description: '' }); }}><IconPlus size={16} aria-hidden="true" /> Add</button>}
      </div>
      {err && <p className="notice error small" role="alert">{err}</p>}
      <div className="table-wrap">
        <table className="table">
          <thead><tr><th>Type</th><th>Price</th><th>Sold</th><th>Left</th><th>Sales</th><th /></tr></thead>
          <tbody>
            {tiers.map((t) => edit?.id === t.id ? (
              <tr key={t.id} className="editing">
                <td>{row('name')}</td><td>{row('price', { inputMode: 'numeric' })}</td>
                <td>{t.sold}{t.held ? ` (+${t.held})` : ''}</td>
                <td>{row('quantity', { inputMode: 'numeric', title: 'Total available' })}</td><td />
                <td className="actions"><button type="button" className="btn btn-primary btn-sm" onClick={save}>Save</button><button type="button" className="btn btn-ghost btn-sm" onClick={() => { setEdit(null); setErr(''); }}>Cancel</button></td>
              </tr>
            ) : (
              <tr key={t.id}>
                <td><strong>{t.name}</strong>{t.admits > 1 && <span className="faint small"> · admits {t.admits}</span>}</td>
                <td className="price">{t.price ? naira(t.price) : 'Free'}</td>
                <td>{t.sold}{t.held ? <span className="faint small"> +{t.held} paying</span> : ''}</td>
                <td>{t.quantity - t.sold - t.held} <span className="faint small">of {t.quantity}</span></td>
                <td className="price">{naira(t.gross)}</td>
                <td className="actions">{!locked && !edit && <>
                  <button type="button" className="icon-btn" aria-label={`Edit ${t.name}`} onClick={() => setEdit({ ...t })}><IconEdit size={16} /></button>
                  {t.sold + t.held === 0 && <button type="button" className="icon-btn" aria-label={`Delete ${t.name}`} onClick={() => remove(t)}><IconTrash size={16} /></button>}
                </>}</td>
              </tr>
            ))}
            {adding && edit && !edit.id && (
              <tr className="editing">
                <td>{row('name', { placeholder: 'VIP' })}</td><td>{row('price', { inputMode: 'numeric', placeholder: '0' })}</td><td>0</td>
                <td>{row('quantity', { inputMode: 'numeric', placeholder: '50' })}</td><td />
                <td className="actions"><button type="button" className="btn btn-primary btn-sm" onClick={save}>Add</button><button type="button" className="btn btn-ghost btn-sm" onClick={() => { setEdit(null); setAdding(false); setErr(''); }}>Cancel</button></td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
      <p className="faint small">You can raise or lower how many are available, but never below what is already sold or being paid for.</p>
    </section>
  );
}
