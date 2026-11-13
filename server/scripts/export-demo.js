// Exports the sample data into the browser-only demo (client/src/demo/snapshot.json).
//   npm run demo:export     (run after db:setup)
// Only sample data is exported: demo accounts, hosts, events, tickets and orders. Test accounts are left out.
// Times are saved as "days from today plus a Lagos clock time", so the events are always upcoming whenever
// the demo is opened, and a 10pm party is still at 10pm.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { pool, query } from '../src/db.js';

const out = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../client/src/demo/snapshot.json');
const now = Date.now();
const DAY = 86400000;
const LAGOS = 3600000;
const lagosDay = (t) => Math.floor((t + LAGOS) / DAY);
const mins = (d) => {
  if (d == null) return null;
  const t = new Date(d).getTime();
  return (lagosDay(t) - lagosDay(now)) * 1440 + Math.round(((t + LAGOS) % DAY) / 60000);
};

try {
  const users = await query("SELECT id, full_name, email, phone, role, city FROM users WHERE email LIKE '%@turnup.demo' ORDER BY id");
  const ids = new Set(users.map((u) => u.id));
  const keep = (rows, key = 'user_id') => rows.filter((r) => ids.has(r[key]));
  const hosts = await query('SELECT id, owner_id, name, slug, bio, image_url, verified FROM hosts ORDER BY id');
  const events = await query("SELECT * FROM events WHERE status <> 'draft' ORDER BY id");
  const tiers = await query('SELECT * FROM ticket_tiers ORDER BY event_id, position, id');
  const orders = keep(await query("SELECT * FROM orders WHERE status = 'paid' ORDER BY id"));
  const orderIds = new Set(orders.map((o) => o.id));
  const items = (await query('SELECT * FROM order_items ORDER BY id')).filter((i) => orderIds.has(i.order_id));
  const tickets = (await query('SELECT * FROM tickets ORDER BY id')).filter((t) => orderIds.has(t.order_id));
  const promos = await query('SELECT * FROM promo_codes ORDER BY id');

  // Sold counts must match the exported tickets exactly (test orders were left out)
  const soldBy = new Map();
  for (const i of items) soldBy.set(i.tier_id, (soldBy.get(i.tier_id) || 0) + i.quantity);

  const snapshot = {
    users: users.map((u) => [u.id, u.full_name, u.email, u.phone, u.role, u.city]),
    hosts: hosts.map((h) => [h.id, h.owner_id, h.name, h.slug, h.bio, h.image_url, h.verified ? 1 : 0]),
    events: events.map((e) => [e.id, e.host_id, e.title, e.slug, e.category, e.summary, e.description, e.venue, e.area, e.city,
      mins(e.starts_at), mins(e.ends_at), e.image_url, e.status]),
    tiers: tiers.map((t) => [t.id, t.event_id, t.name, t.description, t.price, t.quantity, soldBy.get(t.id) || 0, t.max_per_order, t.admits, mins(t.sales_end), t.position]),
    orders: orders.map((o) => [o.id, o.order_number, o.user_id, o.event_id, o.subtotal, o.discount, o.fee, o.total, o.promo_code_id, mins(o.paid_at)]),
    items: items.map((i) => [i.order_id, i.tier_id, i.name, i.price, i.quantity, i.admits]),
    tickets: tickets.map((t) => [t.id, t.order_id, t.event_id, t.tier_id, t.user_id, t.code, t.admits]),
    promos: promos.map((p) => [p.id, p.host_id, p.event_id, p.code, p.kind, p.value, p.max_uses, p.used, mins(p.expires_at), p.active ? 1 : 0]),
    staff: keep(await query('SELECT host_id, user_id, role FROM host_staff')).map((s) => [s.host_id, s.user_id, s.role]),
    saved: keep(await query('SELECT user_id, event_id FROM saved_events')).map((s) => [s.user_id, s.event_id]),
    follows: keep(await query('SELECT user_id, host_id FROM host_follows')).map((f) => [f.user_id, f.host_id]),
    friends: keep(await query('SELECT user_id, friend_id FROM friendships')).map((f) => [f.user_id, f.friend_id]),
    attendees: keep(await query('SELECT event_id, user_id FROM attendees')).map((a) => [a.event_id, a.user_id]),
    photos: fs.readdirSync(path.resolve(path.dirname(out), '../../public/img/events')).filter((f) => f.endsWith('.webp')).map((f) => `/img/events/${f}`),
  };
  fs.mkdirSync(path.dirname(out), { recursive: true });
  fs.writeFileSync(out, JSON.stringify(snapshot));
  console.log(`Demo data written: ${events.length} events, ${tickets.length} tickets, ${users.length} accounts (${Math.round(fs.statSync(out).size / 1024)} KB)`);
} finally {
  await pool.end();
}
