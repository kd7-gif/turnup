import { useEffect, useRef, useState } from 'react';
import { Link, useParams, useSearchParams } from 'react-router-dom';
import { IconAlertTriangle, IconArrowLeft, IconCircleCheckFilled, IconClockHour4, IconCreditCard, IconLock } from '@tabler/icons-react';
import { api, dayLabel, naira, timeLabel } from '../api/client.js';
import TicketPass from '../components/ui/TicketPass.jsx';

export default function Order() {
  const { number } = useParams();
  const [params] = useSearchParams();
  const [data, setData] = useState(null);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const verified = useRef(false);

  useEffect(() => {
    api(`/orders/${number}`).then(async (d) => {
      setData(d);
      // Back from Paystack: confirm the payment with Paystack before showing tickets
      if (params.get('ref') && d.order.status === 'pending' && !verified.current) {
        verified.current = true;
        setBusy(true);
        try { setData({ ...d, ...(await api(`/orders/${number}/verify-payment`, { method: 'POST' })) }); } catch (e) { setError(e.message); }
        setBusy(false);
      }
    }).catch((e) => setError(e.message));
  }, [number]); // eslint-disable-line react-hooks/exhaustive-deps

  const cancel = async () => {
    setBusy(true);
    try { setData({ ...data, ...(await api(`/orders/${number}/cancel`, { method: 'POST' })) }); } catch (e) { setError(e.message); }
    setBusy(false);
  };

  const payTest = async () => {
    setBusy(true);
    setError('');
    try { setData({ ...data, ...(await api(`/orders/${number}/simulate-payment`, { method: 'POST' })) }); } catch (e) { setError(e.message); }
    setBusy(false);
  };

  if (error && !data) return <div className="container empty"><h1>Order not found</h1><p className="muted">{error}</p><Link to="/tickets" className="btn btn-primary">My tickets</Link></div>;
  if (!data) return <div className="container ev-top"><div className="skeleton" style={{ minHeight: 360 }} /></div>;
  const { order: o, payment_mode: mode } = data;
  const e = o.event;

  return (
    <div className="container ev-top order-page">
      <Link to={`/e/${e.slug}`} className="back"><IconArrowLeft size={18} aria-hidden="true" /> {e.title}</Link>

      {o.status === 'paid' ? (
        <section className="going-banner" aria-live="polite">
          <span className="going-banner-icon"><IconCircleCheckFilled size={34} aria-hidden="true" /></span>
          <div>
            <h1>You’re going!</h1>
            <p>{o.tickets.length} {o.tickets.length === 1 ? 'ticket' : 'tickets'} for {e.title} · {dayLabel(e.starts_at)} at {timeLabel(e.starts_at)}. Show the QR code at the door.</p>
          </div>
        </section>
      ) : o.status === 'expired' || o.status === 'cancelled' ? (
        <section className="going-banner muted-banner" role="status">
          <span className="going-banner-icon"><IconClockHour4 size={30} aria-hidden="true" /></span>
          <div>
            <h1>{o.status === 'expired' ? 'Your hold ran out' : 'Order cancelled'}</h1>
            <p>{o.status === 'expired' ? 'We held your tickets for 10 minutes, then put them back on sale.' : 'Your tickets went back on sale.'} You have not been charged.</p>
            <Link to={`/e/${e.slug}`} className="btn btn-dark btn-sm" style={{ marginTop: 12 }}>Choose tickets again</Link>
          </div>
        </section>
      ) : o.status === 'failed' ? (
        <section className="going-banner bad" role="alert">
          <span className="going-banner-icon"><IconAlertTriangle size={30} aria-hidden="true" /></span>
          <div><h1>We couldn’t issue your tickets</h1><p>{o.failure}</p></div>
        </section>
      ) : (
        <div className="order-head">
          <p className="eyebrow">Order {o.order_number}</p>
          <h1 className="ev-title" style={{ fontSize: 'clamp(30px, 4.5vw, 44px)' }}>Complete your order</h1>
        </div>
      )}

      <div className="order-layout">
        <div className="order-main">
          {o.status === 'paid' ? (
            <div className="passes">
              {o.tickets.map((t, i) => <TicketPass key={t.code} event={e} ticket={t} index={i} total={o.tickets.length} />)}
            </div>
          ) : (
            <div className="order-event">
              <img src={e.image_url} alt="" />
              <div>
                <h2>{e.title}</h2>
                <p className="muted">{dayLabel(e.starts_at)} · {timeLabel(e.starts_at)} · {e.venue}, {e.area}</p>
              </div>
            </div>
          )}
        </div>

        <aside className="order-summary">
          <h2>Summary</h2>
          <dl className="totals">
            {o.items.map((it) => (
              <div key={it.tier_id}><dt>{it.quantity} × {it.name}</dt><dd>{it.price === 0 ? 'Free' : naira(it.price * it.quantity)}</dd></div>
            ))}
            {o.discount > 0 && <div className="good"><dt>Promo {o.promo_code}</dt><dd>−{naira(o.discount)}</dd></div>}
            {o.fee > 0 && <div><dt>Booking fee</dt><dd>{naira(o.fee)}</dd></div>}
            <div className="grand"><dt>{o.status === 'paid' ? 'Paid' : 'Total'}</dt><dd>{o.total === 0 ? 'Free' : naira(o.total)}</dd></div>
          </dl>

          {o.status === 'pending' && o.expires_at && (
            <HoldTimer expiresAt={o.expires_at} serverTime={o.server_time} onExpire={() => api(`/orders/${number}`).then(setData).catch(() => {})} />
          )}
          {o.status === 'pending' && (
            mode === 'simulated' ? (
              <>
                <p className="notice info small">This is a demo, so no real money moves. The test payment below confirms the order exactly as Paystack would.</p>
                <button type="button" className="btn btn-primary btn-block btn-lg" onClick={payTest} disabled={busy}>
                  <IconCreditCard size={20} aria-hidden="true" /> {busy ? 'Paying…' : `Pay ${naira(o.total)} (test payment)`}
                </button>
              </>
            ) : (
              <p className="notice info small">{busy ? 'Checking your payment with Paystack…' : 'Waiting for Paystack to confirm your payment. Refresh in a moment.'}</p>
            )
          )}
          {o.status === 'pending' && (
            <button type="button" className="btn btn-ghost btn-block btn-sm" onClick={cancel} disabled={busy}>Cancel and release tickets</button>
          )}
          {error && <p className="notice error" role="alert">{error}</p>}
          <p className="faint small"><IconLock size={14} aria-hidden="true" style={{ verticalAlign: '-2px' }} /> Order {o.order_number}</p>
          {o.status === 'paid' && <Link to="/tickets" className="btn btn-ghost btn-block">All my tickets</Link>}
        </aside>
      </div>
    </div>
  );
}

/** Counts down the 10-minute hold, corrected for any difference between this device's clock and the server's. */
function HoldTimer({ expiresAt, serverTime, onExpire }) {
  const [skew] = useState(() => new Date(serverTime).getTime() - Date.now());
  const [now, setNow] = useState(Date.now());
  const fired = useRef(false);
  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(t);
  }, []);
  const left = Math.max(0, new Date(expiresAt).getTime() - (now + skew));
  useEffect(() => {
    if (left === 0 && !fired.current) { fired.current = true; setTimeout(onExpire, 1500); }
  }, [left, onExpire]);
  const m = Math.floor(left / 60000);
  const s = Math.floor(left / 1000) % 60;
  return (
    <div className={`hold ${left < 120000 ? 'urgent' : ''}`} role="timer" aria-live={left < 60000 ? 'polite' : 'off'}>
      <IconClockHour4 size={22} aria-hidden="true" />
      <div>
        <strong>{left ? `${m}:${String(s).padStart(2, '0')}` : '0:00'}</strong>
        <span>{left ? 'Your tickets are held for you. Pay before the timer runs out.' : 'Time is up. Releasing your tickets…'}</span>
      </div>
    </div>
  );
}
