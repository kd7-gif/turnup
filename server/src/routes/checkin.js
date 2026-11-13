import { Router } from 'express';
import rateLimit from 'express-rate-limit';
import { query, withTransaction } from '../db.js';
import { requireAuth } from '../middleware/auth.js';
import { asyncRoute, cleanString, HttpError } from '../utils/http.js';
import { eventForStaff } from '../services/access.js';

const router = Router();
router.use(requireAuth());

// Plenty for a busy door (two scans a second) but stops anyone trying to guess ticket codes
const scanLimiter = rateLimit({ windowMs: 60 * 1000, limit: 120, standardHeaders: true, legacyHeaders: false,
  keyGenerator: (req) => `user:${req.user.id}` });

/** QR codes contain "TURNUP:<code>". Staff may also type the code, with or without spaces. */
export const normaliseCode = (raw) => String(raw || '').toUpperCase().replace(/^TURNUP:/, '').replace(/[^0-9A-Z]/g, '').slice(0, 40);

async function counts(eventId) {
  const [row] = await query(
    `SELECT COALESCE(SUM(admits), 0) AS expected,
            COALESCE(SUM(CASE WHEN status = 'used' THEN admits ELSE 0 END), 0) AS checked_in,
            COUNT(*) AS tickets
     FROM tickets WHERE event_id = ? AND status <> 'cancelled'`, [eventId]);
  return row;
}

const firstName = (name) => (name || '').split(' ')[0];

// GET /api/checkin/events -> events this person can check guests in for, soonest first
router.get(
  '/events',
  asyncRoute(async (req, res) => {
    const admin = req.user.role === 'admin';
    const rows = await query(
      `SELECT e.id, e.title, e.slug, e.venue, e.area, e.city, e.starts_at, e.ends_at, e.image_url, h.name AS host_name,
              CASE WHEN h.owner_id = ? OR ? THEN 'owner' ELSE s.role END AS role,
              (SELECT COALESCE(SUM(t.admits), 0) FROM tickets t WHERE t.event_id = e.id AND t.status <> 'cancelled') AS expected,
              (SELECT COALESCE(SUM(t.admits), 0) FROM tickets t WHERE t.event_id = e.id AND t.status = 'used') AS checked_in
       FROM events e JOIN hosts h ON h.id = e.host_id
       LEFT JOIN host_staff s ON s.host_id = h.id AND s.user_id = ?
       WHERE (h.owner_id = ? OR s.user_id IS NOT NULL OR ?) AND e.status = 'published' AND e.ends_at > UTC_TIMESTAMP() - INTERVAL 6 HOUR
       ORDER BY e.starts_at LIMIT 50`,
      [req.user.id, admin, req.user.id, req.user.id, admin]
    );
    res.json({ items: rows });
  })
);

// GET /api/checkin/:slug -> the event and how many people are in so far
router.get(
  '/:slug',
  asyncRoute(async (req, res) => {
    const { event, role } = await eventForStaff(req.user, req.params.slug);
    const recent = await query(
      `SELECT c.result, c.admits, c.created_at, u.full_name, tt.name AS tier_name
       FROM checkins c LEFT JOIN tickets t ON t.id = c.ticket_id LEFT JOIN users u ON u.id = t.user_id
       LEFT JOIN ticket_tiers tt ON tt.id = t.tier_id
       WHERE c.event_id = ? ORDER BY c.id DESC LIMIT 8`, [event.id]);
    res.json({ event, role, counts: await counts(event.id),
      recent: recent.map(({ full_name, ...r }) => ({ ...r, guest: full_name ? firstName(full_name) : null })) });
  })
);

/**
 * POST /api/checkin/:slug/scan { code } -> admit or refuse a ticket.
 * The ticket is used with one conditional update (status must still be 'valid'), so if two doors scan
 * the same screenshot at the same moment, only one of them admits it. Every scan is logged.
 */
router.post(
  '/:slug/scan',
  scanLimiter,
  asyncRoute(async (req, res) => {
    const { event } = await eventForStaff(req.user, req.params.slug);
    const code = normaliseCode(req.body.code);
    const log = (result, ticketId = null, admits = 0) =>
      query('INSERT INTO checkins (event_id, ticket_id, staff_id, result, admits) VALUES (?,?,?,?,?)', [event.id, ticketId, req.user.id, result, admits]);

    const [ticket] = code.length >= 8 ? await query(
      `SELECT t.id, t.event_id, t.status, t.admits, t.checked_in_at, tt.name AS tier_name, u.full_name, e.title AS event_title,
              s.full_name AS checked_in_by_name
       FROM tickets t JOIN ticket_tiers tt ON tt.id = t.tier_id JOIN users u ON u.id = t.user_id JOIN events e ON e.id = t.event_id
       LEFT JOIN users s ON s.id = t.checked_in_by
       WHERE t.code = ?`, [code]) : [];

    if (!ticket || ticket.status === 'cancelled') {
      await log('invalid');
      return res.json({ result: 'invalid', message: 'This is not a valid Turnup ticket.', counts: await counts(event.id) });
    }
    const guest = { name: ticket.full_name, tier: ticket.tier_name, admits: ticket.admits };
    if (ticket.event_id !== event.id) {
      await log('wrong_event', ticket.id);
      return res.json({ result: 'wrong_event', message: `This ticket is for ${ticket.event_title}.`, guest, counts: await counts(event.id) });
    }

    const used = await query(
      "UPDATE tickets SET status = 'used', checked_in_at = UTC_TIMESTAMP(), checked_in_by = ? WHERE id = ? AND status = 'valid'",
      [req.user.id, ticket.id]
    );
    if (used.affectedRows === 1) {
      await log('admitted', ticket.id, ticket.admits);
      return res.json({ result: 'admitted', guest, counts: await counts(event.id) });
    }

    // Someone already used it: say when and who let them in, so the door can sort it out
    const [now] = await query(
      'SELECT t.checked_in_at, s.full_name AS by_name FROM tickets t LEFT JOIN users s ON s.id = t.checked_in_by WHERE t.id = ?', [ticket.id]);
    await log('already_used', ticket.id);
    res.json({ result: 'already_used', guest, checked_in_at: now.checked_in_at, checked_in_by: firstName(now.by_name),
      message: 'This ticket has already been used.', counts: await counts(event.id) });
  })
);

// POST /api/checkin/:slug/undo { code } -> undo a check-in made by mistake (owners and co-hosts only)
router.post(
  '/:slug/undo',
  asyncRoute(async (req, res) => {
    const { event } = await eventForStaff(req.user, req.params.slug, ['owner', 'cohost']);
    const code = normaliseCode(req.body.code);
    const result = await withTransaction(async (conn) => {
      const [[t]] = await conn.query("SELECT id FROM tickets WHERE code = ? AND event_id = ? AND status = 'used' FOR UPDATE", [code, event.id]);
      if (!t) return null;
      await conn.query("UPDATE tickets SET status = 'valid', checked_in_at = NULL, checked_in_by = NULL WHERE id = ?", [t.id]);
      await conn.query("INSERT INTO checkins (event_id, ticket_id, staff_id, result) VALUES (?, ?, ?, 'undone')", [event.id, t.id, req.user.id]);
      return t.id;
    });
    if (!result) throw new HttpError(404, 'That ticket is not checked in for this event.');
    res.json({ ok: true, counts: await counts(event.id) });
  })
);

// GET /api/checkin/:slug/guests?q=ada -> guest list for checking people in by name (for lost phones)
router.get(
  '/:slug/guests',
  asyncRoute(async (req, res) => {
    const { event } = await eventForStaff(req.user, req.params.slug);
    const q = cleanString(req.query.q, 60);
    const rows = await query(
      `SELECT t.code, t.status, t.admits, t.checked_in_at, tt.name AS tier_name, u.full_name, o.order_number
       FROM tickets t JOIN ticket_tiers tt ON tt.id = t.tier_id JOIN users u ON u.id = t.user_id JOIN orders o ON o.id = t.order_id
       WHERE t.event_id = ? AND t.status <> 'cancelled' ${q ? 'AND (u.full_name LIKE ? OR o.order_number LIKE ?)' : ''}
       ORDER BY t.status = 'used', u.full_name LIMIT 60`,
      q ? [event.id, `%${q}%`, `%${q}%`] : [event.id]
    );
    // Staff see the name and ticket type, never the buyer's email or phone
    res.json({ items: rows });
  })
);

export default router;
