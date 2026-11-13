import { Router } from 'express';
import { query } from '../db.js';
import { requireAuth } from '../middleware/auth.js';
import { releaseExpiredHolds } from '../services/orders.js';
import { HttpError, asyncRoute, cleanString } from '../utils/http.js';

const router = Router();

// Card fields plus the numbers every list needs: cheapest ticket, tickets left and people going
const CARD = `e.id, e.title, e.slug, e.category, e.summary, e.venue, e.area, e.city, e.starts_at, e.ends_at, e.image_url,
  h.name AS host_name, h.slug AS host_slug, h.verified AS host_verified,
  (SELECT MIN(t.price) FROM ticket_tiers t WHERE t.event_id = e.id AND t.sold + t.held < t.quantity
     AND (t.sales_end IS NULL OR t.sales_end > UTC_TIMESTAMP())) AS from_price,
  (SELECT MAX(t.price) FROM ticket_tiers t WHERE t.event_id = e.id) AS max_price,
  (SELECT COALESCE(SUM(t.quantity - t.sold - t.held), 0) FROM ticket_tiers t WHERE t.event_id = e.id) AS tickets_left,
  (SELECT COUNT(*) FROM attendees a WHERE a.event_id = e.id) AS going_count`;

const LAGOS_MS = 3600000; // Lagos is UTC+1 all year

/** UTC start and end for "today", "weekend", "week" and "month" as people in Lagos mean them. */
export function windowFor(when, now = new Date()) {
  const lagos = new Date(now.getTime() + LAGOS_MS);
  const day = (offset) => new Date(Date.UTC(lagos.getUTCFullYear(), lagos.getUTCMonth(), lagos.getUTCDate() + offset) - LAGOS_MS);
  if (when === 'today') return [now, day(1)];
  if (when === 'week') return [now, day(7)];
  if (when === 'month') return [now, day(30)];
  if (when === 'weekend') {
    const dow = lagos.getUTCDay(); // 0 Sunday ... 6 Saturday
    const toFriday = dow === 0 ? -2 : 5 - dow; // on Saturday and Sunday this is the current weekend
    const start = new Date(day(toFriday).getTime() + 17 * 3600000); // Friday 5pm
    return [start < now ? now : start, day(dow === 0 ? 1 : toFriday + 3)];
  }
  return [now, null];
}

/** Adds friends going (up to 3 names) and saved state for a signed-in guest. */
export async function personalise(events, userId) {
  for (const e of events) {
    e.host_verified = Boolean(e.host_verified);
    e.is_free = e.max_price === 0;
    e.sold_out = Number(e.tickets_left) === 0;
    e.friends_going = [];
    e.friends_count = 0;
    e.saved = false;
  }
  if (!userId || !events.length) return events;
  const ids = events.map((e) => e.id);
  const [friends, saved] = await Promise.all([
    query(`SELECT a.event_id, u.full_name FROM attendees a
           JOIN friendships f ON f.friend_id = a.user_id AND f.user_id = ?
           JOIN users u ON u.id = a.user_id
           WHERE a.event_id IN (?) ORDER BY a.created_at`, [userId, ids]),
    query('SELECT event_id FROM saved_events WHERE user_id = ? AND event_id IN (?)', [userId, ids]),
  ]);
  const savedSet = new Set(saved.map((s) => s.event_id));
  for (const e of events) {
    const mine = friends.filter((f) => f.event_id === e.id);
    e.friends_count = mine.length;
    e.friends_going = mine.slice(0, 3).map((f) => f.full_name.split(' ')[0]);
    e.saved = savedSet.has(e.id);
  }
  return events;
}

// GET /api/events?city=Lagos&category=Music&q=jazz&when=weekend&free=1
router.get(
  '/',
  asyncRoute(async (req, res) => {
    const where = ["e.status = 'published'", 'e.ends_at > UTC_TIMESTAMP()'];
    const params = [];
    const city = cleanString(req.query.city, 60);
    const category = cleanString(req.query.category, 40);
    const q = cleanString(req.query.q, 80);
    const when = cleanString(req.query.when, 10);

    if (city) { where.push('e.city = ?'); params.push(city); }
    if (category) { where.push('e.category = ?'); params.push(category); }
    if (q) {
      where.push('(e.title LIKE ? OR e.summary LIKE ? OR e.venue LIKE ? OR e.area LIKE ? OR h.name LIKE ?)');
      params.push(...Array(5).fill(`%${q}%`));
    }
    if (when) {
      const [from, to] = windowFor(when);
      where.push('e.starts_at < ?'); params.push(to || new Date('2100-01-01'));
      where.push('e.ends_at > ?'); params.push(from);
    }
    if (req.query.free === '1') where.push('NOT EXISTS (SELECT 1 FROM ticket_tiers t WHERE t.event_id = e.id AND t.price > 0)');

    const rows = await query(
      `SELECT ${CARD} FROM events e JOIN hosts h ON h.id = e.host_id WHERE ${where.join(' AND ')} ORDER BY e.starts_at LIMIT 100`,
      params
    );
    res.json({ items: await personalise(rows, req.user?.id) });
  })
);

// GET /api/events/filters -> cities and categories that have upcoming events
router.get(
  '/filters',
  asyncRoute(async (_req, res) => {
    const live = "status = 'published' AND ends_at > UTC_TIMESTAMP()";
    const [cities, categories] = await Promise.all([
      query(`SELECT city, COUNT(*) AS count FROM events WHERE ${live} GROUP BY city ORDER BY count DESC, city`),
      query(`SELECT category, COUNT(*) AS count FROM events WHERE ${live} GROUP BY category ORDER BY count DESC, category`),
    ]);
    res.json({ cities, categories });
  })
);

// GET /api/events/:slug -> the event with its host, ticket types and who is going
router.get(
  '/:slug',
  asyncRoute(async (req, res) => {
    await releaseExpiredHolds(); // so "tickets left" never counts abandoned checkouts
    const [event] = await query(
      `SELECT ${CARD}, e.description, e.status, h.id AS host_id, h.bio AS host_bio, h.image_url AS host_image,
              (SELECT COUNT(*) FROM host_follows f WHERE f.host_id = h.id) AS host_followers
       FROM events e JOIN hosts h ON h.id = e.host_id WHERE e.slug = ?`,
      [cleanString(req.params.slug, 160)]
    );
    if (!event || event.status === 'draft') throw new HttpError(404, 'We could not find that event.');
    await personalise([event], req.user?.id);

    const tiers = await query(
      `SELECT id, name, description, price, quantity - sold - held AS remaining, held AS in_checkout, max_per_order, admits, sales_end,
              (sales_end IS NOT NULL AND sales_end <= UTC_TIMESTAMP()) AS sales_ended
       FROM ticket_tiers WHERE event_id = ? ORDER BY position, id`,
      [event.id]
    );
    const going = await query(
      `SELECT u.full_name FROM attendees a JOIN users u ON u.id = a.user_id WHERE a.event_id = ? ORDER BY a.created_at DESC LIMIT 8`,
      [event.id]
    );
    let following = false;
    if (req.user) {
      following = (await query('SELECT 1 FROM host_follows WHERE user_id = ? AND host_id = ?', [req.user.id, event.host_id])).length > 0;
    }

    const { host_id, host_bio, host_image, host_followers, host_name, host_slug, host_verified, status, ...rest } = event;
    res.json({
      event: { ...rest, cancelled: status === 'cancelled' },
      host: { id: host_id, name: host_name, slug: host_slug, verified: host_verified, bio: host_bio, image_url: host_image,
        followers: host_followers, following },
      tiers: tiers.map((t) => ({ ...t, sales_ended: Boolean(t.sales_ended), sold_out: t.remaining <= 0 })),
      going_preview: going.map((g) => g.full_name.split(' ')[0]),
    });
  })
);

// POST and DELETE /api/events/:slug/save -> add to or remove from the signed-in user's saved list
async function eventId(slug) {
  const [e] = await query("SELECT id FROM events WHERE slug = ? AND status <> 'draft'", [cleanString(slug, 160)]);
  if (!e) throw new HttpError(404, 'We could not find that event.');
  return e.id;
}
router.post('/:slug/save', requireAuth(), asyncRoute(async (req, res) => {
  await query('INSERT IGNORE INTO saved_events (user_id, event_id) VALUES (?, ?)', [req.user.id, await eventId(req.params.slug)]);
  res.json({ saved: true });
}));
router.delete('/:slug/save', requireAuth(), asyncRoute(async (req, res) => {
  await query('DELETE FROM saved_events WHERE user_id = ? AND event_id = ?', [req.user.id, await eventId(req.params.slug)]);
  res.json({ saved: false });
}));

export default router;
