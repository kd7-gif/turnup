import crypto from 'node:crypto';
import { query, withTransaction } from '../db.js';

const ALPHABET = '23456789ABCDEFGHJKLMNPQRSTUVWXYZ'; // no 0/O or 1/I mix-ups
const randomCode = (length) => [...crypto.randomBytes(length)].map((b) => ALPHABET[b % ALPHABET.length]).join('');

/** Short, readable order numbers like TU-7K3Q9P. */
export const newOrderNumber = () => `TU-${randomCode(6)}`;

/** The secret on each ticket, shown as a QR code at the door. 16 characters: about 80 bits, so it cannot be guessed. */
export const newTicketCode = () => randomCode(16);

/**
 * Confirms a paid (or free) order exactly once, however many times Paystack, the webhook or the
 * simulator reports it. Inside one transaction it:
 *   1. locks the order so two confirmations cannot run at the same time,
 *   2. takes the tickets from each ticket type only if there are enough left (never oversells),
 *   3. counts the promo code use, issues one ticket per ticket bought and marks the buyer as going.
 * If a ticket type sold out between checkout and payment, the order is marked failed so it can be refunded.
 * Returns 'paid', 'failed' or 'unchanged'.
 */
class SoldOut extends Error {}

export async function confirmOrder(orderId, amountPaid) {
  try {
    return await withTransaction(async (conn) => {
      const [[order]] = await conn.query('SELECT * FROM orders WHERE id = ? FOR UPDATE', [orderId]);
      if (!order || order.status !== 'pending') return 'unchanged';
      if (amountPaid !== order.total) return 'unchanged'; // never accept a different amount from what we charged

      const [items] = await conn.query('SELECT * FROM order_items WHERE order_id = ?', [orderId]);
      for (const it of items) {
        const [res] = await conn.query(
          'UPDATE ticket_tiers SET sold = sold + ? WHERE id = ? AND sold + ? <= quantity', [it.quantity, it.tier_id, it.quantity]
        );
        if (res.affectedRows === 0) throw new SoldOut(it.name); // rolls back anything this order already took
      }
      if (order.promo_code_id) await conn.query('UPDATE promo_codes SET used = used + 1 WHERE id = ?', [order.promo_code_id]);
      for (const it of items) {
        for (let i = 0; i < it.quantity; i++) {
          await conn.query('INSERT INTO tickets (order_id, event_id, tier_id, user_id, code, admits) VALUES (?,?,?,?,?,?)',
            [orderId, order.event_id, it.tier_id, order.user_id, newTicketCode(), it.admits]);
        }
      }
      await conn.query('INSERT IGNORE INTO attendees (event_id, user_id) VALUES (?, ?)', [order.event_id, order.user_id]);
      await conn.query("UPDATE orders SET status = 'paid', paid_at = UTC_TIMESTAMP() WHERE id = ?", [orderId]);
      return 'paid';
    });
  } catch (err) {
    if (!(err instanceof SoldOut)) throw err;
    await query("UPDATE orders SET status = 'failed', failure = ? WHERE id = ? AND status = 'pending'",
      [`${err.message} sold out before your payment finished. You have not been given tickets and will be refunded.`, orderId]);
    return 'failed';
  }
}

/** An order with its event, line items and (once paid) tickets, as the buyer sees it. */
export async function loadOrder(orderNumber, userId) {
  const [order] = await query(
    `SELECT o.*, e.title, e.slug, e.venue, e.area, e.city, e.starts_at, e.ends_at, e.image_url, h.name AS host_name
     FROM orders o JOIN events e ON e.id = o.event_id JOIN hosts h ON h.id = e.host_id
     WHERE o.order_number = ? AND o.user_id = ?`,
    [orderNumber, userId]
  );
  if (!order) return null;
  const [items, tickets, promo] = await Promise.all([
    query('SELECT tier_id, name, price, quantity, admits FROM order_items WHERE order_id = ? ORDER BY id', [order.id]),
    query(`SELECT t.code, t.admits, t.status, t.checked_in_at, tt.name AS tier_name
           FROM tickets t JOIN ticket_tiers tt ON tt.id = t.tier_id WHERE t.order_id = ? ORDER BY t.id`, [order.id]),
    order.promo_code_id ? query('SELECT code FROM promo_codes WHERE id = ?', [order.promo_code_id]) : [],
  ]);
  return {
    order_number: order.order_number, status: order.status, failure: order.failure,
    subtotal: order.subtotal, discount: order.discount, fee: order.fee, total: order.total, promo_code: promo[0]?.code || null,
    paid_at: order.paid_at, created_at: order.created_at,
    event: { title: order.title, slug: order.slug, venue: order.venue, area: order.area, city: order.city, starts_at: order.starts_at,
      ends_at: order.ends_at, image_url: order.image_url, host_name: order.host_name },
    items, tickets,
  };
}
