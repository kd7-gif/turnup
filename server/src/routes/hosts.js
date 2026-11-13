import { Router } from 'express';
import { query } from '../db.js';
import { requireAuth } from '../middleware/auth.js';
import { HttpError, asyncRoute, cleanString } from '../utils/http.js';
import { personalise } from './events.js';

const router = Router();

async function findHost(slug) {
  const [host] = await query(
    `SELECT h.id, h.name, h.slug, h.bio, h.image_url, h.verified,
            (SELECT COUNT(*) FROM host_follows f WHERE f.host_id = h.id) AS followers,
            (SELECT COUNT(*) FROM events e WHERE e.host_id = h.id AND e.status = 'published') AS events_hosted
     FROM hosts h WHERE h.slug = ?`,
    [cleanString(slug, 140)]
  );
  if (!host) throw new HttpError(404, 'We could not find that host.');
  host.verified = Boolean(host.verified);
  return host;
}

// GET /api/hosts/:slug -> host profile with upcoming events
router.get(
  '/:slug',
  asyncRoute(async (req, res) => {
    const host = await findHost(req.params.slug);
    const events = await query(
      `SELECT e.id, e.title, e.slug, e.category, e.summary, e.venue, e.area, e.city, e.starts_at, e.ends_at, e.image_url,
              ? AS host_name, ? AS host_slug, ? AS host_verified,
              (SELECT MIN(t.price) FROM ticket_tiers t WHERE t.event_id = e.id AND t.sold + t.held < t.quantity
                 AND (t.sales_end IS NULL OR t.sales_end > UTC_TIMESTAMP())) AS from_price,
              (SELECT MAX(t.price) FROM ticket_tiers t WHERE t.event_id = e.id) AS max_price,
              (SELECT COALESCE(SUM(t.quantity - t.sold - t.held), 0) FROM ticket_tiers t WHERE t.event_id = e.id) AS tickets_left,
              (SELECT COUNT(*) FROM attendees a WHERE a.event_id = e.id) AS going_count
       FROM events e WHERE e.host_id = ? AND e.status = 'published' AND e.ends_at > UTC_TIMESTAMP() ORDER BY e.starts_at`,
      [host.name, host.slug, host.verified, host.id]
    );
    host.following = req.user
      ? (await query('SELECT 1 FROM host_follows WHERE user_id = ? AND host_id = ?', [req.user.id, host.id])).length > 0
      : false;
    res.json({ host, events: await personalise(events, req.user?.id) });
  })
);

router.post('/:slug/follow', requireAuth(), asyncRoute(async (req, res) => {
  const host = await findHost(req.params.slug);
  await query('INSERT IGNORE INTO host_follows (user_id, host_id) VALUES (?, ?)', [req.user.id, host.id]);
  res.json({ following: true });
}));
router.delete('/:slug/follow', requireAuth(), asyncRoute(async (req, res) => {
  const host = await findHost(req.params.slug);
  await query('DELETE FROM host_follows WHERE user_id = ? AND host_id = ?', [req.user.id, host.id]);
  res.json({ following: false });
}));

export default router;
