import { Router } from 'express';
import { query } from '../db.js';
import { requireAuth } from '../middleware/auth.js';
import { asyncRoute } from '../utils/http.js';
import { personalise } from './events.js';

const router = Router();
router.use(requireAuth());

// GET /api/me/saved -> upcoming events the signed-in user saved
router.get(
  '/saved',
  asyncRoute(async (req, res) => {
    const rows = await query(
      `SELECT e.id, e.title, e.slug, e.category, e.summary, e.venue, e.area, e.city, e.starts_at, e.ends_at, e.image_url,
              h.name AS host_name, h.slug AS host_slug, h.verified AS host_verified,
              (SELECT MIN(t.price) FROM ticket_tiers t WHERE t.event_id = e.id AND t.sold < t.quantity
                 AND (t.sales_end IS NULL OR t.sales_end > UTC_TIMESTAMP())) AS from_price,
              (SELECT MAX(t.price) FROM ticket_tiers t WHERE t.event_id = e.id) AS max_price,
              (SELECT COALESCE(SUM(t.quantity - t.sold), 0) FROM ticket_tiers t WHERE t.event_id = e.id) AS tickets_left,
              (SELECT COUNT(*) FROM attendees a WHERE a.event_id = e.id) AS going_count
       FROM saved_events s JOIN events e ON e.id = s.event_id JOIN hosts h ON h.id = e.host_id
       WHERE s.user_id = ? AND e.ends_at > UTC_TIMESTAMP() ORDER BY e.starts_at`,
      [req.user.id]
    );
    res.json({ items: await personalise(rows, req.user.id) });
  })
);

// GET /api/me/tickets -> the signed-in user's tickets, grouped by order, upcoming first
router.get(
  '/tickets',
  asyncRoute(async (req, res) => {
    const orders = await query(
      `SELECT o.id, o.order_number, o.total, o.paid_at, e.title, e.slug, e.venue, e.area, e.city, e.starts_at, e.ends_at, e.image_url,
              h.name AS host_name
       FROM orders o JOIN events e ON e.id = o.event_id JOIN hosts h ON h.id = e.host_id
       WHERE o.user_id = ? AND o.status = 'paid' ORDER BY e.starts_at`,
      [req.user.id]
    );
    const tickets = orders.length ? await query(
      `SELECT t.order_id, t.code, t.admits, t.status, tt.name AS tier_name FROM tickets t
       JOIN ticket_tiers tt ON tt.id = t.tier_id WHERE t.order_id IN (?) ORDER BY t.id`, [orders.map((o) => o.id)]
    ) : [];
    const now = new Date();
    const items = orders.map(({ id, ...o }) => ({ ...o, tickets: tickets.filter((t) => t.order_id === id).map(({ order_id, ...t }) => t) }));
    res.json({
      upcoming: items.filter((o) => new Date(o.ends_at) > now),
      past: items.filter((o) => new Date(o.ends_at) <= now).reverse(),
    });
  })
);

export default router;
