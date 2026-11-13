// Seat-safe sales: 10-minute holds, releasing them, late payments and many buyers at once.
import { test, after, before } from 'node:test';
import assert from 'node:assert/strict';

delete process.env.PAYSTACK_SECRET_KEY;
const { app } = await import('../src/index.js');
const { pool, query } = await import('../src/db.js');
const { releaseExpiredHolds } = await import('../src/services/orders.js');
const { setSession } = await import('../src/middleware/auth.js');

const server = app.listen(0);
const base = `http://127.0.0.1:${server.address().port}`;
const origin = process.env.CLIENT_ORIGIN?.split(',')[0] || 'http://localhost:5175';
const stamp = Date.now();
const slug = `test-holds-${stamp}`;
let eventId; let hostId; const tier = {};

const api = (path, { method = 'GET', body, cookie } = {}) => fetch(base + path, {
  method, headers: { 'Content-Type': 'application/json', Origin: origin, ...(cookie ? { Cookie: cookie } : {}) },
  body: body ? JSON.stringify(body) : undefined,
});
const json = (r) => r.json();

// Makes a buyer directly (faster than registering, and skips the sign-up rate limit)
async function buyer(tag) {
  const r = await query("INSERT INTO users (full_name, email, password_hash) VALUES (?, ?, 'x')", [`Hold ${tag}`, `test-hold-${tag}-${stamp}@example.com`]);
  let cookie = '';
  setSession({ cookie: (_n, v) => { cookie = `turnup_session=${v}`; } }, { id: r.insertId, role: 'guest' });
  return cookie;
}
const buy = (cookie, name, quantity = 1, promo_code) =>
  api('/api/orders', { method: 'POST', cookie, body: { event_slug: slug, items: [{ tier_id: tier[name], quantity }], promo_code } });
const stock = async (name) => (await query('SELECT sold, held, quantity FROM ticket_tiers WHERE id = ?', [tier[name]]))[0];
const expire = (number) => query('UPDATE orders SET expires_at = UTC_TIMESTAMP() - INTERVAL 1 SECOND WHERE order_number = ?', [number]);

before(async () => {
  [{ id: hostId }] = await query("SELECT id FROM hosts WHERE slug = 'afterdark-collective'");
  const r = await query(
    `INSERT INTO events (host_id, title, slug, category, description, venue, area, city, starts_at, ends_at)
     VALUES (?, 'Test Holds', ?, 'Parties', 'Test', 'Venue', 'Yaba', 'Lagos', UTC_TIMESTAMP() + INTERVAL 3 DAY, UTC_TIMESTAMP() + INTERVAL 3 DAY + INTERVAL 3 HOUR)`,
    [hostId, slug]);
  eventId = r.insertId;
  for (const [name, qty] of [['Three', 3], ['One', 1], ['Rush', 10], ['Late', 1]]) {
    tier[name] = (await query('INSERT INTO ticket_tiers (event_id, name, price, quantity, max_per_order) VALUES (?,?,5000,?,10)', [eventId, name, qty])).insertId;
  }
  await query("INSERT INTO promo_codes (host_id, event_id, code, kind, value, max_uses) VALUES (?, ?, 'HOLDONCE', 'amount', 1000, 1)", [hostId, eventId]);
});

after(async () => {
  await query('DELETE FROM orders WHERE event_id = ?', [eventId]);
  await query('DELETE FROM events WHERE id = ?', [eventId]);
  await query("DELETE FROM promo_codes WHERE code = 'HOLDONCE'");
  await query("DELETE FROM users WHERE email LIKE 'test-hold-%'");
  server.close();
  await pool.end();
});

test('checking out holds the tickets and shows them as gone to everyone else', async () => {
  const a = await buyer('a');
  const res = await buy(a, 'Three', 2);
  assert.equal(res.status, 201);
  const { order } = await json(await api(`/api/orders/${(await json(res)).order_number}`, { cookie: a }));
  const minutes = (new Date(order.expires_at) - new Date(order.server_time)) / 60000;
  assert.ok(minutes > 9.5 && minutes <= 10, `hold lasts about 10 minutes (got ${minutes})`);
  assert.deepEqual(await stock('Three'), { sold: 0, held: 2, quantity: 3 });
  const { tiers } = await json(await api(`/api/events/${slug}`));
  assert.equal(tiers.find((t) => t.id === tier.Three).remaining, 1);
  assert.equal((await buy(await buyer('b'), 'Three', 2)).status, 409); // only 1 left
});

test('an unpaid hold goes back on sale after it expires', async () => {
  const c = await buyer('c');
  const { order_number } = await json(await buy(c, 'One'));
  assert.equal((await buy(await buyer('d'), 'One')).status, 409);
  await expire(order_number);
  assert.ok(await releaseExpiredHolds() >= 1);
  assert.equal((await stock('One')).held, 0);
  const { order } = await json(await api(`/api/orders/${order_number}`, { cookie: c }));
  assert.equal(order.status, 'expired');
  assert.equal((await buy(await buyer('e'), 'One')).status, 201); // someone else can now buy it
});

test('cancelling gives the tickets and the promo code back straight away', async () => {
  const f = await buyer('f');
  const { order_number } = await json(await buy(f, 'Rush', 1, 'HOLDONCE'));
  assert.equal((await query("SELECT used FROM promo_codes WHERE code = 'HOLDONCE'"))[0].used, 1);
  assert.equal((await buy(await buyer('g'), 'Rush', 1, 'HOLDONCE')).status, 422); // the one use is taken
  const before = await stock('Rush');
  const { order } = await json(await api(`/api/orders/${order_number}/cancel`, { method: 'POST', cookie: f }));
  assert.equal(order.status, 'cancelled');
  assert.equal((await stock('Rush')).held, before.held - 1);
  assert.equal((await query("SELECT used FROM promo_codes WHERE code = 'HOLDONCE'"))[0].used, 0);
});

test('a payment that arrives after the hold ended still works if tickets are left', async () => {
  const h = await buyer('h');
  const { order_number } = await json(await buy(h, 'Late'));
  await expire(order_number);
  const { order } = await json(await api(`/api/orders/${order_number}/simulate-payment`, { method: 'POST', cookie: h }));
  assert.equal(order.status, 'paid');
  assert.deepEqual(await stock('Late'), { sold: 1, held: 0, quantity: 1 });
});

test('a late payment fails cleanly if someone else bought the tickets meanwhile', async () => {
  await query('UPDATE ticket_tiers SET quantity = 2 WHERE id = ?', [tier.Late]);
  const i = await buyer('i');
  const { order_number } = await json(await buy(i, 'Late'));
  await expire(order_number);
  await releaseExpiredHolds();
  const j = await buyer('j');
  const other = await json(await buy(j, 'Late'));
  await api(`/api/orders/${other.order_number}/simulate-payment`, { method: 'POST', cookie: j });
  const { order } = await json(await api(`/api/orders/${order_number}/simulate-payment`, { method: 'POST', cookie: i }));
  assert.equal(order.status, 'failed');
  assert.equal(order.tickets.length, 0);
  assert.deepEqual(await stock('Late'), { sold: 2, held: 0, quantity: 2 });
});

test('fifty buyers rushing for the last tickets: exactly the right number get them', async () => {
  const left = (await stock('Rush')).quantity - (await stock('Rush')).sold - (await stock('Rush')).held;
  const buyers = await Promise.all(Array.from({ length: 50 }, (_, n) => buyer(`rush${n}`)));
  const results = await Promise.all(buyers.map((c) => buy(c, 'Rush')));
  const won = results.filter((r) => r.status === 201).length;
  const lost = results.filter((r) => r.status === 409).length;
  assert.equal(won, left);
  assert.equal(won + lost, 50);
  const s = await stock('Rush');
  assert.equal(s.sold + s.held, s.quantity);
});
