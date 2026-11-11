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

export default router;
