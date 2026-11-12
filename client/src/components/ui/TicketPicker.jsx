import { useEffect, useMemo, useState } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import { IconDiscount2, IconMinus, IconPlus, IconTicket, IconUsers } from '@tabler/icons-react';
import { api, dayLabel, naira } from '../../api/client.js';
import { useAuth } from '../../context/AuthContext.jsx';

const keyFor = (slug) => `turnup.picked.${slug}`;
const load = (slug) => { try { return JSON.parse(sessionStorage.getItem(keyFor(slug))) || {}; } catch { return {}; } };
const save = (slug, v) => { try { sessionStorage.setItem(keyFor(slug), JSON.stringify(v)); } catch { /* not important */ } };

/** Choose ticket types and quantities, apply a promo code and check out. Prices come from the server. */
export default function TicketPicker({ event, tiers, ended }) {
  const { user } = useAuth();
  const navigate = useNavigate();
  const location = useLocation();
  const saved = useMemo(() => load(event.slug), [event.slug]);
  const [qty, setQty] = useState(saved.qty || {});
  const [promoInput, setPromoInput] = useState(saved.promo || '');
  const [promo, setPromo] = useState(saved.promo || '');
  const [quote, setQuote] = useState(null);
  const [error, setError] = useState('');
  const [promoError, setPromoError] = useState('');
  const [busy, setBusy] = useState(false);

  const items = Object.entries(qty).filter(([, n]) => n > 0).map(([tier_id, quantity]) => ({ tier_id: Number(tier_id), quantity }));
  const key = JSON.stringify(items) + promo;
  const allFree = tiers.every((t) => t.price === 0);

  // Keep the choice if the visitor has to log in first
  useEffect(() => { save(event.slug, { qty, promo }); }, [event.slug, qty, promo]);

  // Ask the server for the price whenever the choice changes
  useEffect(() => {
    if (!items.length) { setQuote(null); setError(''); return undefined; }
    let stale = false;
    const t = setTimeout(async () => {
      try {
        const q = await api('/orders/quote', { method: 'POST', body: { event_slug: event.slug, items, promo_code: promo || undefined } });
        if (!stale) { setQuote(q); setError(''); setPromoError(''); }
      } catch (e) {
        if (stale) return;
        if (e.fields?.promo) { setPromoError(e.message); setPromo(''); } else { setError(e.message); setQuote(null); }
      }
    }, 200);
    return () => { stale = true; clearTimeout(t); };
  }, [key]); // eslint-disable-line react-hooks/exhaustive-deps

  const change = (tier, delta) => {
    const next = Math.max(0, Math.min((qty[tier.id] || 0) + delta, Math.min(tier.max_per_order, tier.remaining)));
    setQty({ ...qty, [tier.id]: next });
  };

  const checkout = async () => {
    if (!user) return navigate('/login', { state: { from: location.pathname } });
    setBusy(true);
    setError('');
    try {
      const res = await api('/orders', { method: 'POST', body: { event_slug: event.slug, items, promo_code: promo || undefined } });
      save(event.slug, {});
      if (res.payment.mode === 'paystack') { window.location.assign(res.payment.authorization_url); return; }
      navigate(`/orders/${res.order_number}`);
    } catch (e) {
      setError(e.message);
      setBusy(false);
    }
  };

  if (ended) return <p className="notice info">Ticket sales have closed for this event.</p>;

  const count = quote?.ticket_count || 0;
  return (
    <div className="picker">
      <ul className="tier-list">
        {tiers.map((t) => {
          const off = t.sold_out || t.sales_ended;
          const n = qty[t.id] || 0;
          const max = Math.min(t.max_per_order, t.remaining);
          return (
            <li key={t.id} className={`tier ${off ? 'off' : ''} ${n ? 'picked' : ''}`}>
              <div className="tier-text">
                <strong>{t.name}</strong>
                <span className="price">{t.price === 0 ? 'Free' : naira(t.price)}</span>
                {t.description && <p>{t.description}</p>}
                <div className="tier-tags">
                  {t.admits > 1 && <span className="tag cobalt"><IconUsers size={12} aria-hidden="true" /> Admits {t.admits}</span>}
                  {t.sold_out ? <span className="tag">Sold out</span>
                    : t.sales_ended ? <span className="tag">Sales ended</span>
                      : t.remaining <= 25 ? <span className="tag hot">Only {t.remaining} left</span> : null}
                  {!off && t.sales_end && <span className="tag sun">Ends {dayLabel(t.sales_end)}</span>}
                </div>
              </div>
              {!off && (
                <div className="stepper" role="group" aria-label={`${t.name} quantity`}>
                  <button type="button" onClick={() => change(t, -1)} disabled={n === 0} aria-label={`Remove one ${t.name}`}><IconMinus size={16} /></button>
                  <span aria-live="polite">{n}</span>
                  <button type="button" onClick={() => change(t, 1)} disabled={n >= max} aria-label={`Add one ${t.name}`}><IconPlus size={16} /></button>
                </div>
              )}
            </li>
          );
        })}
      </ul>

      {!allFree && (
        <form className="promo" onSubmit={(e) => { e.preventDefault(); setPromoError(''); setPromo(promoInput.trim().toUpperCase()); }}>
          <IconDiscount2 size={20} aria-hidden="true" />
          <label htmlFor="promo" className="sr-only">Promo code</label>
          <input id="promo" value={promoInput} onChange={(e) => setPromoInput(e.target.value)} placeholder="Promo code" autoComplete="off"
            aria-invalid={promoError ? 'true' : 'false'} aria-describedby={promoError ? 'promo-err' : undefined} />
          {promo && quote?.promo ? (
            <button type="button" className="promo-btn" onClick={() => { setPromo(''); setPromoInput(''); }}>Remove</button>
          ) : (
            <button type="submit" className="promo-btn" disabled={!promoInput.trim()}>Apply</button>
          )}
        </form>
      )}
      {promoError && <p id="promo-err" className="field-error" role="alert">{promoError}</p>}

      {quote && (
        <dl className="totals">
          <div><dt>{quote.ticket_count} {quote.ticket_count === 1 ? 'ticket' : 'tickets'}{quote.people > quote.ticket_count ? ` · admits ${quote.people}` : ''}</dt><dd>{naira(quote.subtotal)}</dd></div>
          {quote.discount > 0 && <div className="good"><dt>{quote.promo.code} · {quote.promo.label}</dt><dd>−{naira(quote.discount)}</dd></div>}
          {quote.fee > 0 && <div><dt>Booking fee</dt><dd>{naira(quote.fee)}</dd></div>}
          <div className="grand"><dt>Total</dt><dd>{quote.total === 0 ? 'Free' : naira(quote.total)}</dd></div>
        </dl>
      )}
      {error && <p className="notice error" role="alert">{error}</p>}

      <button type="button" className="btn btn-primary btn-block btn-lg" onClick={checkout} disabled={!quote || busy}>
        <IconTicket size={20} aria-hidden="true" />
        {busy ? 'One moment…' : !count ? (allFree ? 'Choose your RSVP' : 'Choose your tickets')
          : quote.total === 0 ? `RSVP · ${count} ${count === 1 ? 'spot' : 'spots'}` : `Get tickets · ${naira(quote.total)}`}
      </button>
      <p className="faint small center">{allFree ? 'Free. You will get a QR ticket for the door.' : 'Payments are processed securely by Paystack.'}</p>
    </div>
  );
}
