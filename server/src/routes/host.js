// Host dashboard API: everything a host (or co-host) needs to run their events.
// Owners and co-hosts can manage events, ticket types and promo codes; only owners manage the team.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { Router } from 'express';
import { query, withTransaction } from '../db.js';
import { requireAuth } from '../middleware/auth.js';
import { HttpError, asyncRoute, cleanString, isEmail } from '../utils/http.js';
import { eventForStaff } from '../services/access.js';
import { slugify } from '../utils/slug.js';

const router = Router();
router.use(requireAuth());

export const CATEGORIES = ['Music', 'Parties', 'Food and drink', 'Comedy', 'Art and culture', 'Tech and business', 'Fitness', 'Games and hangouts'];
export const CITIES = ['Lagos', 'Abuja', 'Ibadan'];
const LAGOS_MS = 3600000; // Lagos is UTC+1 all year

// Hosts pick a cover from the photo library (uploads would need file storage, which a demo does not have)
const photoDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../../client/public/img/events');
const PHOTOS = fs.existsSync(photoDir) ? fs.readdirSync(photoDir).filter((f) => f.endsWith('.webp')).map((f) => `/img/events/${f}`) : [];

/** "2026-11-20T21:00" typed in Lagos time -> a UTC Date, or null if it is not a real date. */
export function fromLagosInput(value) {
  const m = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})$/.exec(String(value || ''));
  if (!m) return null;
  const [, y, mo, d, h, mi] = m.map(Number);
  const date = new Date(Date.UTC(y, mo - 1, d, h, mi) - LAGOS_MS);
  return Number.isNaN(date.getTime()) || new Date(date.getTime() + LAGOS_MS).getUTCDate() !== d ? null : date;
}

/** The hosts this person owns or co-hosts, with their role. */
async function myHosts(user) {
  if (user.role === 'admin') return query("SELECT id, name, slug, image_url, 'owner' AS role FROM hosts ORDER BY name");
  return query(
    `SELECT h.id, h.name, h.slug, h.image_url, 'owner' AS role FROM hosts h WHERE h.owner_id = ?
     UNION SELECT h.id, h.name, h.slug, h.image_url, 'cohost' AS role FROM hosts h JOIN host_staff s ON s.host_id = h.id
       WHERE s.user_id = ? AND s.role = 'cohost' AND h.owner_id <> ?
     ORDER BY name`,
    [user.id, user.id, user.id]
  );
}

async function hostFor(user, slug, roles = ['owner', 'cohost']) {
  const host = (await myHosts(user)).find((h) => h.slug === slug);
  if (!host || !roles.includes(host.role)) throw new HttpError(404, 'We could not find that host in your account.');
  return host;
}

// Sales numbers shared by the overview and the event page. Revenue is what the host earns: ticket prices
// after discounts, without Turnup's booking fee.
const EVENT_STATS = `
  (SELECT COALESCE(SUM(t.sold), 0) FROM ticket_tiers t WHERE t.event_id = e.id) AS sold,
  (SELECT COALESCE(SUM(t.held), 0) FROM ticket_tiers t WHERE t.event_id = e.id) AS held,
  (SELECT COALESCE(SUM(t.quantity), 0) FROM ticket_tiers t WHERE t.event_id = e.id) AS capacity,
  (SELECT COALESCE(SUM(o.subtotal - o.discount), 0) FROM orders o WHERE o.event_id = e.id AND o.status = 'paid') AS revenue,
  (SELECT COALESCE(SUM(k.admits), 0) FROM tickets k WHERE k.event_id = e.id AND k.status = 'used') AS checked_in`;

// GET /api/host/overview?host=slug -> hosts, headline numbers and every event
router.get(
  '/overview',
  asyncRoute(async (req, res) => {
    const hosts = await myHosts(req.user);
    if (!hosts.length) throw new HttpError(403, 'You do not run any hosts yet.');
    const host = hosts.find((h) => h.slug === req.query.host) || hosts[0];
    const events = await query(
      `SELECT e.id, e.title, e.slug, e.category, e.city, e.area, e.venue, e.starts_at, e.ends_at, e.image_url, e.status, ${EVENT_STATS}
       FROM events e WHERE e.host_id = ? ORDER BY e.ends_at < UTC_TIMESTAMP(), e.starts_at`,
      [host.id]
    );
    const [totals] = await query(
      `SELECT COALESCE(SUM(o.subtotal - o.discount), 0) AS revenue_30d, COUNT(*) AS orders_30d
       FROM orders o JOIN events e ON e.id = o.event_id
       WHERE e.host_id = ? AND o.status = 'paid' AND o.paid_at > UTC_TIMESTAMP() - INTERVAL 30 DAY`, [host.id]);
    const [{ followers }] = await query('SELECT COUNT(*) AS followers FROM host_follows WHERE host_id = ?', [host.id]);
    const recent = await query(
      `SELECT o.order_number, o.subtotal - o.discount AS amount, o.paid_at, u.full_name, e.title,
              (SELECT SUM(oi.quantity) FROM order_items oi WHERE oi.order_id = o.id) AS tickets
       FROM orders o JOIN events e ON e.id = o.event_id JOIN users u ON u.id = o.user_id
       WHERE e.host_id = ? AND o.status = 'paid' ORDER BY o.paid_at DESC LIMIT 8`, [host.id]);
    const now = new Date();
    res.json({
      hosts, host,
      totals: { ...totals, followers, tickets_sold: events.reduce((n, e) => n + Number(e.sold), 0),
        upcoming: events.filter((e) => new Date(e.ends_at) > now && e.status === 'published').length },
      events: events.map((e) => ({ ...e, past: new Date(e.ends_at) <= now })),
      recent: recent.map(({ full_name, ...o }) => ({ ...o, buyer: full_name })),
    });
  })
);

// GET /api/host/options -> categories, cities and the photo library for the event form
router.get('/options', (_req, res) => res.json({ categories: CATEGORIES, cities: CITIES, photos: PHOTOS }));

/** Checks and cleans the event form. `partial` allows sending only the fields being changed. */
function readEvent(body, partial = false) {
  const out = {};
  const fields = {};
  const has = (k) => !partial || body[k] !== undefined;
  if (has('title')) { out.title = cleanString(body.title, 140); if (out.title.length < 4) fields.title = 'Give the event a name (at least 4 characters).'; }
  if (has('category')) { out.category = body.category; if (!CATEGORIES.includes(out.category)) fields.category = 'Choose a category.'; }
  if (has('summary')) { out.summary = cleanString(body.summary, 200); if (out.summary.length < 10) fields.summary = 'Add a one-line summary (at least 10 characters).'; }
  if (has('description')) { out.description = cleanString(body.description, 5000); if (out.description.length < 20) fields.description = 'Describe the event (at least 20 characters).'; }
  if (has('venue')) { out.venue = cleanString(body.venue, 140); if (out.venue.length < 2) fields.venue = 'Enter the venue.'; }
  if (has('area')) { out.area = cleanString(body.area, 80); if (out.area.length < 2) fields.area = 'Enter the area, such as Lekki or Wuse 2.'; }
  if (has('city')) { out.city = body.city; if (!CITIES.includes(out.city)) fields.city = 'Choose a city.'; }
  if (has('image_url')) { out.image_url = body.image_url; if (!PHOTOS.includes(out.image_url)) fields.image_url = 'Choose a cover photo.'; }
  if (has('starts_at')) { out.starts_at = fromLagosInput(body.starts_at); if (!out.starts_at) fields.starts_at = 'Enter a start date and time.'; }
  if (has('ends_at')) { out.ends_at = fromLagosInput(body.ends_at); if (!out.ends_at) fields.ends_at = 'Enter an end date and time.'; }
  return { out, fields };
}

function checkTimes(starts, ends, fields, isNew) {
  if (!starts || !ends) return;
  if (ends <= starts) fields.ends_at = 'The event must end after it starts.';
  else if (ends - starts > 7 * 86400000) fields.ends_at = 'Events can last up to 7 days.';
  if (isNew && starts < new Date()) fields.starts_at = 'Choose a time in the future.';
  if (starts > new Date(Date.now() + 2 * 365 * 86400000)) fields.starts_at = 'Events can be listed up to two years ahead.';
}

/** Checks one ticket type. Returns the cleaned type and adds any problems to `fields` under `prefix`. */
function readTier(t, fields, prefix) {
  const tier = {
    name: cleanString(t?.name, 60),
    description: cleanString(t?.description, 200),
    price: Number(t?.price),
    quantity: Number(t?.quantity),
    max_per_order: Number(t?.max_per_order ?? 10),
    admits: Number(t?.admits ?? 1),
    sales_end: t?.sales_end ? fromLagosInput(t.sales_end) : null,
  };
  if (tier.name.length < 2) fields[`${prefix}.name`] = 'Name this ticket type.';
  if (!Number.isInteger(tier.price) || tier.price < 0 || tier.price > 10000000) fields[`${prefix}.price`] = 'Enter a price in naira (0 for free).';
  else if (tier.price > 0 && tier.price < 100) fields[`${prefix}.price`] = 'Paid tickets must be at least ₦100.';
  if (!Number.isInteger(tier.quantity) || tier.quantity < 1 || tier.quantity > 100000) fields[`${prefix}.quantity`] = 'Enter how many are available (1 to 100,000).';
  if (!Number.isInteger(tier.max_per_order) || tier.max_per_order < 1 || tier.max_per_order > 50) fields[`${prefix}.max_per_order`] = 'Between 1 and 50.';
  if (!Number.isInteger(tier.admits) || tier.admits < 1 || tier.admits > 50) fields[`${prefix}.admits`] = 'Between 1 and 50 people.';
  if (t?.sales_end && !tier.sales_end) fields[`${prefix}.sales_end`] = 'Enter a valid date and time.';
  return tier;
}

async function uniqueSlug(title) {
  const base = slugify(title).slice(0, 120) || 'event';
  for (let n = 1; ; n++) {
    const candidate = n === 1 ? base : `${base}-${n}`;
    if (!(await query('SELECT 1 FROM events WHERE slug = ?', [candidate])).length) return candidate;
  }
}

// POST /api/host/events -> create an event with its ticket types (as a draft or published)
router.post(
  '/events',
  asyncRoute(async (req, res) => {
    const host = await hostFor(req.user, req.body.host_slug);
    const { out, fields } = readEvent(req.body);
    checkTimes(out.starts_at, out.ends_at, fields, true);
    const rawTiers = Array.isArray(req.body.tiers) ? req.body.tiers.slice(0, 10) : [];
    if (!rawTiers.length) fields.tiers = 'Add at least one ticket type.';
    const tiers = rawTiers.map((t, i) => readTier(t, fields, `tiers.${i}`));
    if (Object.keys(fields).length) throw new HttpError(422, 'Check the highlighted fields.', fields);

    const status = req.body.publish ? 'published' : 'draft';
    const slug = await uniqueSlug(out.title);
    await withTransaction(async (conn) => {
      const [r] = await conn.query(
        `INSERT INTO events (host_id, title, slug, category, summary, description, venue, area, city, starts_at, ends_at, image_url, status)
         VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?)`,
        [host.id, out.title, slug, out.category, out.summary, out.description, out.venue, out.area, out.city, out.starts_at, out.ends_at, out.image_url, status]
      );
      for (const [pos, t] of tiers.entries()) {
        await conn.query(`INSERT INTO ticket_tiers (event_id, name, description, price, quantity, max_per_order, admits, sales_end, position)
                          VALUES (?,?,?,?,?,?,?,?,?)`, [r.insertId, t.name, t.description, t.price, t.quantity, t.max_per_order, t.admits, t.sales_end, pos]);
      }
    });
    res.status(201).json({ slug, status });
  })
);

// GET /api/host/events/:slug -> everything about one event for its host: sales by day, ticket types, orders, promo codes
router.get(
  '/events/:slug',
  asyncRoute(async (req, res) => {
    const { event: base, role } = await eventForStaff(req.user, req.params.slug, ['owner', 'cohost']);
    const [event] = await query(
      `SELECT e.*, h.name AS host_name, h.slug AS host_slug, ${EVENT_STATS} FROM events e JOIN hosts h ON h.id = e.host_id WHERE e.id = ?`, [base.id]);
    const [tiers, daily, orders, promos] = await Promise.all([
      query(`SELECT t.*, (SELECT COALESCE(SUM(oi.price * oi.quantity), 0) FROM order_items oi JOIN orders o ON o.id = oi.order_id
                            WHERE oi.tier_id = t.id AND o.status = 'paid') AS gross
             FROM ticket_tiers t WHERE t.event_id = ? ORDER BY t.position, t.id`, [event.id]),
      query(`SELECT DATE(o.paid_at + INTERVAL 1 HOUR) AS day, SUM(oi.quantity) AS tickets
             FROM orders o JOIN order_items oi ON oi.order_id = o.id
             WHERE o.event_id = ? AND o.status = 'paid' AND o.paid_at > UTC_TIMESTAMP() - INTERVAL 14 DAY
             GROUP BY day ORDER BY day`, [event.id]),
      query(`SELECT o.order_number, o.status, o.subtotal - o.discount AS amount, o.paid_at, o.created_at, u.full_name AS buyer,
                    (SELECT GROUP_CONCAT(CONCAT(oi.quantity, ' × ', oi.name) SEPARATOR ', ') FROM order_items oi WHERE oi.order_id = o.id) AS items
             FROM orders o JOIN users u ON u.id = o.user_id WHERE o.event_id = ? AND o.status IN ('paid', 'pending')
             ORDER BY o.created_at DESC LIMIT 25`, [event.id]),
      query(`SELECT id, code, kind, value, max_uses, used, expires_at, active, event_id FROM promo_codes
             WHERE host_id = ? AND (event_id IS NULL OR event_id = ?) ORDER BY id DESC`, [event.host_id, event.id]),
    ]);
    // Fill in days with no sales so the chart has no gaps
    const byDay = new Map(daily.map((d) => [new Date(d.day).toISOString().slice(0, 10), Number(d.tickets)]));
    const days = Array.from({ length: 14 }, (_, i) => {
      const d = new Date(Date.now() + LAGOS_MS - (13 - i) * 86400000).toISOString().slice(0, 10);
      return { day: d, tickets: byDay.get(d) || 0 };
    });
    res.json({ event, role, tiers, days, orders, promos: promos.map((p) => ({ ...p, active: Boolean(p.active), all_events: p.event_id == null })) });
  })
);

// PATCH /api/host/events/:slug -> edit details, or publish, unpublish and cancel
router.patch(
  '/events/:slug',
  asyncRoute(async (req, res) => {
    const { event } = await eventForStaff(req.user, req.params.slug, ['owner', 'cohost']);
    const { out, fields } = readEvent(req.body, true);
    checkTimes(out.starts_at || event.starts_at, out.ends_at || event.ends_at, fields, false);
    if (req.body.status !== undefined) {
      if (!['draft', 'published', 'cancelled'].includes(req.body.status)) fields.status = 'Unknown status.';
      else if (event.status === 'cancelled') fields.status = 'A cancelled event cannot be changed.';
      else if (req.body.status === 'draft') {
        const [{ n }] = await query("SELECT COUNT(*) AS n FROM orders WHERE event_id = ? AND status IN ('paid', 'pending')", [event.id]);
        if (n > 0) fields.status = 'People already have tickets, so this event cannot go back to being a draft. You can cancel it instead.';
      }
      out.status = req.body.status;
    }
    if (Object.keys(fields).length) throw new HttpError(422, fields.status || 'Check the highlighted fields.', fields);
    if (!Object.keys(out).length) throw new HttpError(422, 'Nothing to change.');
    const cols = Object.keys(out);
    await query(`UPDATE events SET ${cols.map((c) => `${c} = ?`).join(', ')} WHERE id = ?`, [...cols.map((c) => out[c]), event.id]);
    res.json({ ok: true, status: out.status || event.status });
  })
);

// POST /api/host/events/:slug/tiers -> add a ticket type
router.post(
  '/events/:slug/tiers',
  asyncRoute(async (req, res) => {
    const { event } = await eventForStaff(req.user, req.params.slug, ['owner', 'cohost']);
    const fields = {};
    const t = readTier(req.body, fields, 'tier');
    if (Object.keys(fields).length) throw new HttpError(422, 'Check the highlighted fields.', fields);
    const [{ pos }] = await query('SELECT COALESCE(MAX(position), -1) + 1 AS pos FROM ticket_tiers WHERE event_id = ?', [event.id]);
    const r = await query(`INSERT INTO ticket_tiers (event_id, name, description, price, quantity, max_per_order, admits, sales_end, position)
                           VALUES (?,?,?,?,?,?,?,?,?)`, [event.id, t.name, t.description, t.price, t.quantity, t.max_per_order, t.admits, t.sales_end, pos]);
    res.status(201).json({ id: r.insertId });
  })
);

// PATCH /api/host/events/:slug/tiers/:id -> change a ticket type. Quantity can never go below what is sold or held.
router.patch(
  '/events/:slug/tiers/:id',
  asyncRoute(async (req, res) => {
    const { event } = await eventForStaff(req.user, req.params.slug, ['owner', 'cohost']);
    const [current] = await query('SELECT * FROM ticket_tiers WHERE id = ? AND event_id = ?', [Number(req.params.id), event.id]);
    if (!current) throw new HttpError(404, 'We could not find that ticket type.');
    const fields = {};
    const t = readTier({ ...current, sales_end: undefined, ...req.body }, fields, 'tier');
    if (Object.keys(fields).length) throw new HttpError(422, 'Check the highlighted fields.', fields);
    // The check and the change happen in one statement, so a sale cannot sneak in between them
    const r = await query(
      `UPDATE ticket_tiers SET name = ?, description = ?, price = ?, quantity = ?, max_per_order = ?, admits = ?
         ${req.body.sales_end !== undefined ? ', sales_end = ?' : ''}
       WHERE id = ? AND sold + held <= ?`,
      [t.name, t.description, t.price, t.quantity, t.max_per_order, t.admits,
        ...(req.body.sales_end !== undefined ? [t.sales_end] : []), current.id, t.quantity]
    );
    if (r.affectedRows === 0) {
      throw new HttpError(409, `You cannot go below ${current.sold + current.held}: that many are already sold or being paid for.`,
        { 'tier.quantity': `At least ${current.sold + current.held}.` });
    }
    res.json({ ok: true });
  })
);

// DELETE /api/host/events/:slug/tiers/:id -> only while nobody has bought or is buying one
router.delete(
  '/events/:slug/tiers/:id',
  asyncRoute(async (req, res) => {
    const { event } = await eventForStaff(req.user, req.params.slug, ['owner', 'cohost']);
    const used = await query('SELECT 1 FROM order_items oi JOIN ticket_tiers t ON t.id = oi.tier_id WHERE t.id = ? AND t.event_id = ? LIMIT 1', [Number(req.params.id), event.id]);
    if (used.length) throw new HttpError(409, 'People have ordered this ticket type, so it cannot be deleted. Set its quantity to what is sold to stop sales instead.');
    const [{ n }] = await query('SELECT COUNT(*) AS n FROM ticket_tiers WHERE event_id = ?', [event.id]);
    if (n <= 1) throw new HttpError(409, 'An event needs at least one ticket type.');
    const r = await query('DELETE FROM ticket_tiers WHERE id = ? AND event_id = ?', [Number(req.params.id), event.id]);
    if (!r.affectedRows) throw new HttpError(404, 'We could not find that ticket type.');
    res.json({ ok: true });
  })
);

// Promo codes: GET and POST /api/host/:host/promos, PATCH /api/host/:host/promos/:id (turn on or off)
router.get('/:host/promos', asyncRoute(async (req, res) => {
  const host = await hostFor(req.user, req.params.host);
  const items = await query(
    `SELECT p.id, p.code, p.kind, p.value, p.max_uses, p.used, p.expires_at, p.active, e.title AS event_title, e.slug AS event_slug
     FROM promo_codes p LEFT JOIN events e ON e.id = p.event_id WHERE p.host_id = ? ORDER BY p.id DESC`, [host.id]);
  res.json({ items: items.map((p) => ({ ...p, active: Boolean(p.active) })) });
}));

router.post('/:host/promos', asyncRoute(async (req, res) => {
  const host = await hostFor(req.user, req.params.host);
  const fields = {};
  const code = cleanString(req.body.code, 30).toUpperCase();
  const kind = req.body.kind === 'amount' ? 'amount' : 'percent';
  const value = Number(req.body.value);
  const maxUses = req.body.max_uses === '' || req.body.max_uses == null ? null : Number(req.body.max_uses);
  const expires = req.body.expires_at ? fromLagosInput(req.body.expires_at) : null;
  if (!/^[A-Z0-9]{3,30}$/.test(code)) fields.code = 'Use 3 to 30 letters and numbers, no spaces.';
  if (!Number.isInteger(value) || value < 1 || (kind === 'percent' && value > 100) || value > 10000000) {
    fields.value = kind === 'percent' ? 'Enter a percentage from 1 to 100.' : 'Enter an amount in naira.';
  }
  if (maxUses !== null && (!Number.isInteger(maxUses) || maxUses < 1)) fields.max_uses = 'Leave empty for unlimited, or enter a number.';
  if (req.body.expires_at && !expires) fields.expires_at = 'Enter a valid date and time.';
  let eventId = null;
  if (req.body.event_slug) {
    const [e] = await query('SELECT id FROM events WHERE slug = ? AND host_id = ?', [cleanString(req.body.event_slug, 160), host.id]);
    if (!e) fields.event_slug = 'Choose one of your events.';
    eventId = e?.id ?? null;
  }
  if (!fields.code && (await query('SELECT 1 FROM promo_codes WHERE host_id = ? AND code = ?', [host.id, code])).length) fields.code = 'You already have a code with that name.';
  if (Object.keys(fields).length) throw new HttpError(422, 'Check the highlighted fields.', fields);
  await query('INSERT INTO promo_codes (host_id, event_id, code, kind, value, max_uses, expires_at) VALUES (?,?,?,?,?,?,?)',
    [host.id, eventId, code, kind, value, maxUses, expires]);
  res.status(201).json({ code });
}));

router.patch('/:host/promos/:id', asyncRoute(async (req, res) => {
  const host = await hostFor(req.user, req.params.host);
  if (typeof req.body.active !== 'boolean') throw new HttpError(422, 'Say whether the code is on or off.');
  const r = await query('UPDATE promo_codes SET active = ? WHERE id = ? AND host_id = ?', [req.body.active, Number(req.params.id), host.id]);
  if (!r.affectedRows) throw new HttpError(404, 'We could not find that code.');
  res.json({ active: req.body.active });
}));

// Team: GET /api/host/:host/team, POST (add by email), DELETE /:userId. Only owners can change the team.
router.get('/:host/team', asyncRoute(async (req, res) => {
  const host = await hostFor(req.user, req.params.host);
  const items = await query(
    `SELECT u.id, u.full_name, u.email, s.role, s.created_at FROM host_staff s JOIN users u ON u.id = s.user_id WHERE s.host_id = ? ORDER BY s.role, u.full_name`, [host.id]);
  res.json({ items, can_edit: host.role === 'owner' });
}));

router.post('/:host/team', asyncRoute(async (req, res) => {
  const host = await hostFor(req.user, req.params.host, ['owner']);
  const email = cleanString(req.body.email, 190).toLowerCase();
  const role = req.body.role === 'cohost' ? 'cohost' : 'door';
  if (!isEmail(email)) throw new HttpError(422, 'Enter their email address.', { email: 'Enter a valid email address.' });
  const [user] = await query('SELECT id, full_name FROM users WHERE email = ?', [email]);
  if (!user) throw new HttpError(404, 'Nobody with that email has a Turnup account yet. Ask them to sign up first.', { email: 'No account with this email.' });
  const [{ owner_id: ownerId }] = await query('SELECT owner_id FROM hosts WHERE id = ?', [host.id]);
  if (user.id === ownerId) throw new HttpError(422, 'That is the owner’s own account.', { email: 'This is the owner.' });
  await query('INSERT INTO host_staff (host_id, user_id, role) VALUES (?, ?, ?) ON DUPLICATE KEY UPDATE role = VALUES(role)', [host.id, user.id, role]);
  res.status(201).json({ name: user.full_name, role });
}));

router.delete('/:host/team/:userId', asyncRoute(async (req, res) => {
  const host = await hostFor(req.user, req.params.host, ['owner']);
  await query('DELETE FROM host_staff WHERE host_id = ? AND user_id = ?', [host.id, Number(req.params.userId)]);
  res.json({ ok: true });
}));

export default router;
