import crypto from 'node:crypto';
import { query, withTransaction } from '../db.js';
import { HttpError } from '../utils/http.js';

/** How long tickets are held for someone at checkout before they go back on sale. */
export const HOLD_MINUTES = 10;

const ALPHABET = '23456789ABCDEFGHJKLMNPQRSTUVWXYZ'; // no 0/O or 1/I mix-ups
const randomCode = (length) => [...crypto.randomBytes(length)].map((b) => ALPHABET[b % ALPHABET.length]).join('');

/** Short, readable order numbers like TU-7K3Q9P. */
export const newOrderNumber = () => `TU-${randomCode(6)}`;

/** The secret on each ticket, shown as a QR code at the door. 16 characters: about 80 bits, so it cannot be guessed. */
export const newTicketCode = () => randomCode(16);

/**
 * Creates an order and holds its tickets for HOLD_MINUTES, all in one transaction.
 *
 * The hold is a single conditional UPDATE per ticket type:
 *     UPDATE ticket_tiers SET held = held + n WHERE id = ? AND sold + held + n <= quantity
 * The database checks and changes the row in one step while it is locked, so two buyers can never
 * both take the last ticket. If any ticket type cannot be held, the whole order is rolled back.
 * Ticket types are locked in id order, so two orders for the same types cannot deadlock each other.
 * A promo code with limited uses is reserved the same way.
 */
export async function createOrderWithHold({ orderNumber, userId, quote }) {
  return withTransaction(async (conn) => {
    const [res] = await conn.query(
      `INSERT INTO orders (order_number, user_id, event_id, subtotal, discount, fee, total, promo_code_id, expires_at)
       VALUES (?,?,?,?,?,?,?,?, UTC_TIMESTAMP() + INTERVAL ? MINUTE)`,
      [orderNumber, userId, quote.event.id, quote.subtotal, quote.discount, quote.fee, quote.total, quote.promo?.id ?? null, HOLD_MINUTES]
    );
    const orderId = res.insertId;
    for (const l of [...quote.lines].sort((a, b) => a.tier_id - b.tier_id)) {
      const [held] = await conn.query(
        'UPDATE ticket_tiers SET held = held + ? WHERE id = ? AND sold + held + ? <= quantity', [l.quantity, l.tier_id, l.quantity]
      );
      if (held.affectedRows === 0) {
        const [[t]] = await conn.query('SELECT quantity - sold - held AS left_now FROM ticket_tiers WHERE id = ?', [l.tier_id]);
        throw new HttpError(409, t.left_now > 0
          ? `Only ${t.left_now} ${l.name} ${t.left_now === 1 ? 'ticket is' : 'tickets are'} left. Lower the number and try again.`
          : `${l.name} just sold out.`);
      }
      await conn.query('INSERT INTO order_items (order_id, tier_id, name, price, quantity, admits) VALUES (?,?,?,?,?,?)',
        [orderId, l.tier_id, l.name, l.price, l.quantity, l.admits]);
    }
    if (quote.promo) {
      const [used] = await conn.query(
        'UPDATE promo_codes SET used = used + 1 WHERE id = ? AND (max_uses IS NULL OR used < max_uses)', [quote.promo.id]
      );
      if (used.affectedRows === 0) throw new HttpError(422, 'That promo code was just used up. Remove it and try again.', { promo: 'Fully used.' });
    }
    return orderId;
  });
}

/** Gives back what an unpaid order was holding (tickets and promo use). Call inside a transaction with the order locked. */
async function releaseHold(conn, order) {
  const [items] = await conn.query('SELECT tier_id, quantity FROM order_items WHERE order_id = ? ORDER BY tier_id', [order.id]);
  for (const it of items) await conn.query('UPDATE ticket_tiers SET held = held - ? WHERE id = ?', [it.quantity, it.tier_id]);
  if (order.promo_code_id) await conn.query('UPDATE promo_codes SET used = used - 1 WHERE id = ? AND used > 0', [order.promo_code_id]);
}

/**
 * Puts the tickets from unpaid orders older than HOLD_MINUTES back on sale. Runs every 30 seconds and
 * before anything that reads stock. SKIP LOCKED means it never waits for (or fights with) an order that
 * is being paid at this very moment; that order is simply looked at again next time.
 */
export async function releaseExpiredHolds() {
  return withTransaction(async (conn) => {
    const [orders] = await conn.query(
      `SELECT id, promo_code_id FROM orders WHERE status = 'pending' AND expires_at <= UTC_TIMESTAMP()
       ORDER BY id LIMIT 200 FOR UPDATE SKIP LOCKED`
    );
    for (const o of orders) await releaseHold(conn, o);
    if (orders.length) await conn.query("UPDATE orders SET status = 'expired' WHERE id IN (?)", [orders.map((o) => o.id)]);
    return orders.length;
  });
}

/** The buyer changed their mind: release the hold straight away instead of waiting ten minutes. */
export async function cancelOrder(orderId) {
  return withTransaction(async (conn) => {
    const [[order]] = await conn.query('SELECT * FROM orders WHERE id = ? FOR UPDATE', [orderId]);
    if (!order || order.status !== 'pending') return false;
    await releaseHold(conn, order);
    await conn.query("UPDATE orders SET status = 'cancelled' WHERE id = ?", [orderId]);
    return true;
  });
}

class SoldOut extends Error {}

/**
 * Confirms a paid (or free) order exactly once, however many times Paystack, the webhook or the
 * simulator reports it. The order row is locked first, so two confirmations cannot overlap.
 *   - Pending (still held): the held tickets simply become sold. This cannot fail.
 *   - Expired (paid after the hold ran out, which can happen with slow bank transfers): the tickets are
 *     taken again only if there are enough left, otherwise the order fails and the buyer is refunded.
 * Then it issues one ticket per ticket bought and marks the buyer as going.
 * Returns 'paid', 'failed' or 'unchanged'.
 */
export async function confirmOrder(orderId, amountPaid) {
  try {
    return await withTransaction(async (conn) => {
      const [[order]] = await conn.query('SELECT * FROM orders WHERE id = ? FOR UPDATE', [orderId]);
      if (!order || !['pending', 'expired'].includes(order.status)) return 'unchanged';
      if (amountPaid !== order.total) return 'unchanged'; // never accept a different amount from what we charged

      const [items] = await conn.query('SELECT * FROM order_items WHERE order_id = ? ORDER BY tier_id', [orderId]);
      for (const it of items) {
        if (order.status === 'pending') {
          await conn.query('UPDATE ticket_tiers SET held = held - ?, sold = sold + ? WHERE id = ?', [it.quantity, it.quantity, it.tier_id]);
        } else {
          const [res] = await conn.query(
            'UPDATE ticket_tiers SET sold = sold + ? WHERE id = ? AND sold + held + ? <= quantity', [it.quantity, it.tier_id, it.quantity]
          );
          if (res.affectedRows === 0) throw new SoldOut(it.name); // rolls back anything this order already took
        }
      }
      if (order.status === 'expired' && order.promo_code_id) {
        await conn.query('UPDATE promo_codes SET used = used + 1 WHERE id = ?', [order.promo_code_id]);
      }
      const rows = items.flatMap((it) => Array.from({ length: it.quantity },
        () => [orderId, order.event_id, it.tier_id, order.user_id, newTicketCode(), it.admits]));
      await conn.query('INSERT INTO tickets (order_id, event_id, tier_id, user_id, code, admits) VALUES ?', [rows]);
      await conn.query('INSERT IGNORE INTO attendees (event_id, user_id) VALUES (?, ?)', [order.event_id, order.user_id]);
      await conn.query("UPDATE orders SET status = 'paid', paid_at = UTC_TIMESTAMP() WHERE id = ?", [orderId]);
      return 'paid';
    });
  } catch (err) {
    if (!(err instanceof SoldOut)) throw err;
    await query("UPDATE orders SET status = 'failed', failure = ? WHERE id = ? AND status IN ('pending', 'expired')",
      [`${err.message} sold out after your 10-minute hold ended. You have not been given tickets and will be refunded.`, orderId]);
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
    paid_at: order.paid_at, created_at: order.created_at, expires_at: order.status === 'pending' ? order.expires_at : null,
    server_time: new Date(),
    event: { title: order.title, slug: order.slug, venue: order.venue, area: order.area, city: order.city, starts_at: order.starts_at,
      ends_at: order.ends_at, image_url: order.image_url, host_name: order.host_name },
    items, tickets,
  };
}
