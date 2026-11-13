import { query } from '../db.js';
import { HttpError, cleanString } from '../utils/http.js';

/** Booking fee on paid tickets: 2.5% plus ₦100, capped at ₦3,000 an order. Free tickets have no fee. */
export const bookingFee = (amount) => (amount <= 0 ? 0 : Math.min(Math.round(amount * 0.025) + 100, 3000));

/** Finds a usable promo code for this event, or explains why it cannot be used. */
export async function findPromo(event, rawCode) {
  const code = cleanString(rawCode, 30).toUpperCase();
  if (!code) return null;
  const [promo] = await query(
    `SELECT * FROM promo_codes WHERE host_id = ? AND code = ? AND active AND (event_id IS NULL OR event_id = ?)`,
    [event.host_id, code, event.id]
  );
  if (!promo) throw new HttpError(422, 'That promo code is not valid for this event.', { promo: 'Not valid for this event.' });
  if (promo.expires_at && new Date(promo.expires_at) <= new Date()) throw new HttpError(422, 'That promo code has expired.', { promo: 'Expired.' });
  if (promo.max_uses != null && promo.used >= promo.max_uses) throw new HttpError(422, 'That promo code has been fully used.', { promo: 'Fully used.' });
  return promo;
}

/**
 * Works out the price of an order on the server. The browser only sends ticket types and quantities;
 * prices, discounts and fees always come from the database.
 */
export async function priceOrder({ eventSlug, items, promoCode }) {
  const [event] = await query(
    "SELECT id, host_id, title, slug, status, starts_at, ends_at FROM events WHERE slug = ?", [cleanString(eventSlug, 160)]
  );
  if (!event || event.status === 'draft') throw new HttpError(404, 'We could not find that event.');
  if (event.status === 'cancelled') throw new HttpError(409, 'This event has been cancelled.');
  if (new Date(event.ends_at) <= new Date()) throw new HttpError(409, 'This event has already ended.');

  if (!Array.isArray(items) || !items.length) throw new HttpError(422, 'Choose at least one ticket.');
  const wanted = new Map();
  for (const it of items.slice(0, 20)) {
    const id = Number(it?.tier_id);
    const qty = Number(it?.quantity);
    if (!Number.isInteger(id) || id <= 0) throw new HttpError(422, 'One of the tickets you chose is not valid.');
    if (!Number.isInteger(qty) || qty < 0 || qty > 50) throw new HttpError(422, 'Choose a quantity between 1 and 50.');
    if (qty > 0) wanted.set(id, (wanted.get(id) || 0) + qty);
  }
  if (!wanted.size) throw new HttpError(422, 'Choose at least one ticket.');

  const tiers = await query(
    `SELECT id, name, price, quantity, sold, held, max_per_order, admits, sales_end FROM ticket_tiers WHERE event_id = ? AND id IN (?)`,
    [event.id, [...wanted.keys()]]
  );
  if (tiers.length !== wanted.size) throw new HttpError(422, 'Some of those tickets are not for this event. Refresh and try again.');

  const lines = tiers.map((t) => {
    const quantity = wanted.get(t.id);
    if (t.sales_end && new Date(t.sales_end) <= new Date()) throw new HttpError(409, `${t.name} tickets are no longer on sale.`);
    if (quantity > t.max_per_order) throw new HttpError(422, `You can buy up to ${t.max_per_order} ${t.name} tickets in one order.`);
    const left = t.quantity - t.sold - t.held;
    if (left <= 0) throw new HttpError(409, `${t.name} is sold out.`);
    if (quantity > left) throw new HttpError(409, `Only ${left} ${t.name} ${left === 1 ? 'ticket is' : 'tickets are'} left.`);
    return { tier_id: t.id, name: t.name, price: t.price, quantity, admits: t.admits };
  });

  const subtotal = lines.reduce((n, l) => n + l.price * l.quantity, 0);
  let discount = 0;
  let promo = null;
  if (promoCode && subtotal > 0) {
    promo = await findPromo(event, promoCode);
    discount = promo.kind === 'percent' ? Math.round((subtotal * promo.value) / 100) : Math.min(promo.value, subtotal);
  }
  const afterDiscount = subtotal - discount;
  const fee = bookingFee(afterDiscount);
  return {
    event, lines, subtotal, discount, fee, total: afterDiscount + fee,
    promo: promo ? { id: promo.id, code: promo.code, label: promo.kind === 'percent' ? `${promo.value}% off` : `₦${promo.value.toLocaleString('en-NG')} off` } : null,
    ticket_count: lines.reduce((n, l) => n + l.quantity, 0),
    people: lines.reduce((n, l) => n + l.quantity * l.admits, 0),
  };
}
