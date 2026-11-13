// Live check-in: the numbers on the night, and instant updates to the right people only.
import { test, after, before } from 'node:test';
import assert from 'node:assert/strict';
import { io as connect } from 'socket.io-client';

delete process.env.PAYSTACK_SECRET_KEY;
const { createServer } = await import('../src/index.js');
const { pool, query } = await import('../src/db.js');

const server = createServer().listen(0);
const base = `http://127.0.0.1:${server.address().port}`;
const origin = process.env.CLIENT_ORIGIN?.split(',')[0] || 'http://localhost:5175';
const stamp = Date.now();
const SLUG = 'sunset-rooftop-sessions'; // Afterdark Collective
const sockets = [];

const api = (path, { method = 'GET', body, cookie } = {}) => fetch(base + path, {
  method, headers: { 'Content-Type': 'application/json', Origin: origin, ...(cookie ? { Cookie: cookie } : {}) },
  body: body ? JSON.stringify(body) : undefined,
});
const json = (r) => r.json();
const login = async (email) => (await api('/api/auth/login', { method: 'POST', body: { email, password: 'turnup123' } })).headers.get('set-cookie').split(';')[0];

/** Opens a live connection as this person and records every message it receives. */
function listen(cookie) {
  return new Promise((resolve, reject) => {
    const s = connect(base, { extraHeaders: { Cookie: cookie }, transports: ['websocket'], forceNew: true });
    s.got = [];
    s.onAny((event, data) => s.got.push({ event, data }));
    s.on('ready', () => resolve(s));
    s.on('connect_error', reject);
    sockets.push(s);
  });
}
const wait = (ms) => new Promise((r) => setTimeout(r, ms));

let host; let door; let stranger; let tickets;

before(async () => {
  host = await login('host@turnup.demo');
  door = await login('door@turnup.demo');
  stranger = (await api('/api/auth/register', { method: 'POST',
    body: { full_name: 'Live Stranger', email: `test-live-${stamp}@example.com`, phone: '08012345678', password: 'longpassword' } }))
    .headers.get('set-cookie').split(';')[0];
  const [e] = await query('SELECT id FROM events WHERE slug = ?', [SLUG]);
  tickets = await query("SELECT code FROM tickets WHERE event_id = ? AND status = 'valid' LIMIT 3", [e.id]);
});

after(async () => {
  // Put the sample tickets back the way they were
  const [e] = await query('SELECT id FROM events WHERE slug = ?', [SLUG]);
  await query("UPDATE tickets SET status = 'valid', checked_in_at = NULL, checked_in_by = NULL WHERE code IN (?)", [tickets.map((t) => t.code)]);
  await query('DELETE FROM checkins WHERE event_id = ? AND created_at > ?', [e.id, new Date(stamp - 1000)]);
  await query("DELETE FROM users WHERE email LIKE 'test-%@example.com'");
  sockets.forEach((s) => s.close());
  server.close();
  await pool.end();
});

test('live connections need a signed-in session', async () => {
  await assert.rejects(new Promise((resolve, reject) => {
    const s = connect(base, { transports: ['websocket'], forceNew: true });
    sockets.push(s);
    s.on('ready', resolve);
    s.on('connect_error', reject);
  }));
});

test('a scan at the door reaches the host and door staff instantly, and nobody else', async () => {
  const [h, d, x] = await Promise.all([listen(host), listen(door), listen(stranger)]);
  const before = (await json(await api(`/api/host/events/${SLUG}/live`, { cookie: host }))).counts.checked_in;
  const t0 = Date.now();
  await api(`/api/checkin/${SLUG}/scan`, { method: 'POST', cookie: door, body: { code: tickets[0].code } });
  await wait(150);
  const hostMsg = h.got.find((m) => m.event === 'checkin:changed');
  assert.ok(hostMsg, 'host was told');
  assert.equal(hostMsg.data.event, SLUG);
  assert.ok(d.got.some((m) => m.event === 'checkin:changed'), 'door staff were told');
  assert.ok(!x.got.some((m) => m.event === 'checkin:changed'), 'a stranger was not told');
  assert.ok(Date.now() - t0 < 1000);
  // Messages carry no guest details, only which event changed
  assert.deepEqual(Object.keys(hostMsg.data), ['event']);
  const after = (await json(await api(`/api/host/events/${SLUG}/live`, { cookie: host }))).counts.checked_in;
  assert.equal(after, before + 1);
});

test('sales go to the host but not to door staff', async () => {
  const [h, d] = await Promise.all([listen(host), listen(door)]);
  const { tiers } = await json(await api(`/api/events/${SLUG}`));
  const { order_number } = await json(await api('/api/orders', { method: 'POST', cookie: stranger, body: { event_slug: SLUG, items: [{ tier_id: tiers[0].id, quantity: 1 }] } }));
  await api(`/api/orders/${order_number}/simulate-payment`, { method: 'POST', cookie: stranger });
  await wait(150);
  assert.ok(h.got.some((m) => m.event === 'sales:changed'));
  assert.ok(!d.got.some((m) => m.event === 'sales:changed'));
  // tidy up the order
  const [o] = await query('SELECT id FROM orders WHERE order_number = ?', [order_number]);
  await query('UPDATE ticket_tiers SET sold = sold - 1 WHERE id = ?', [tiers[0].id]);
  await query('DELETE FROM attendees WHERE user_id = (SELECT user_id FROM orders WHERE id = ?) AND event_id = (SELECT event_id FROM orders WHERE id = ?)', [o.id, o.id]);
  await query('DELETE FROM orders WHERE id = ?', [o.id]);
});

test('the live dashboard counts arrivals, refusals and the door team', async () => {
  await api(`/api/checkin/${SLUG}/scan`, { method: 'POST', cookie: door, body: { code: tickets[1].code } });
  await api(`/api/checkin/${SLUG}/scan`, { method: 'POST', cookie: door, body: { code: tickets[1].code } }); // shown twice
  await api(`/api/checkin/${SLUG}/scan`, { method: 'POST', cookie: door, body: { code: 'NOTAREALCODE1234' } });
  const live = await json(await api(`/api/host/events/${SLUG}/live`, { cookie: host }));
  assert.ok(live.counts.checked_in >= 2);
  assert.ok(live.counts.last_15_min >= 2);
  assert.ok(live.refused.already_used >= 1 && live.refused.invalid >= 1);
  assert.ok(live.arrivals.length >= 8);
  assert.ok(live.arrivals.at(-1).admits >= 2, 'the newest arrivals are in the current 15-minute slot');
  assert.equal(live.tiers.reduce((n, t) => n + Number(t.checked_in), 0), live.counts.checked_in);
  assert.ok(live.staff.some((s) => s.name === 'Sam Ojo' && s.admitted >= 2));
  assert.equal(live.feed[0].result, 'invalid');
});

test('door staff and strangers cannot open the live dashboard', async () => {
  assert.equal((await api(`/api/host/events/${SLUG}/live`, { cookie: door })).status, 404);
  assert.equal((await api(`/api/host/events/${SLUG}/live`, { cookie: stranger })).status, 404);
});
