// Door check-in: who can scan, single-use tickets, group tickets, wrong events and the guest list.
import { test, after, before } from 'node:test';
import assert from 'node:assert/strict';

delete process.env.PAYSTACK_SECRET_KEY;
const { app } = await import('../src/index.js');
const { pool, query } = await import('../src/db.js');
const { normaliseCode } = await import('../src/routes/checkin.js');

const server = app.listen(0);
const base = `http://127.0.0.1:${server.address().port}`;
const origin = process.env.CLIENT_ORIGIN?.split(',')[0] || 'http://localhost:5175';
const stamp = Date.now();

const api = (path, { method = 'GET', body, cookie } = {}) => fetch(base + path, {
  method, headers: { 'Content-Type': 'application/json', Origin: origin, ...(cookie ? { Cookie: cookie } : {}) },
  body: body ? JSON.stringify(body) : undefined,
});
const json = (r) => r.json();
const login = async (email) => (await api('/api/auth/login', { method: 'POST', body: { email, password: 'turnup123' } }))
  .headers.get('set-cookie').split(';')[0];

// A ticket bought through the real checkout, so the test covers the whole path
async function buyTicket(cookie, slug, tierName) {
  const { tiers } = await json(await api(`/api/events/${slug}`));
  const tier = tiers.find((t) => t.name === tierName && !t.sold_out && !t.sales_ended) || tiers.find((t) => !t.sold_out && !t.sales_ended);
  const { order_number } = await json(await api('/api/orders', { method: 'POST', cookie, body: { event_slug: slug, items: [{ tier_id: tier.id, quantity: 1 }] } }));
  const { order } = await json(await api(`/api/orders/${order_number}/simulate-payment`, { method: 'POST', cookie }));
  return order.tickets[0];
}

let guest; let host; let door; let stranger; let ticket; let group; let elsewhere;
const NEON = 'neon-nights-amapiano-edition'; // Afterdark Collective
let groupTierId;
const JAZZ = 'jazz-on-the-lawn'; // another host

before(async () => {
  guest = (await api('/api/auth/register', { method: 'POST',
    body: { full_name: 'Door Test Guest', email: `test-door-${stamp}@example.com`, phone: '08012345678', password: 'longpassword' } }))
    .headers.get('set-cookie').split(';')[0];
  stranger = (await api('/api/auth/register', { method: 'POST',
    body: { full_name: 'Not Staff', email: `test-stranger-${stamp}@example.com`, phone: '08012345678', password: 'longpassword' } }))
    .headers.get('set-cookie').split(';')[0];
  host = await login('host@turnup.demo');
  door = await login('door@turnup.demo');
  ticket = await buyTicket(guest, NEON, 'Regular');
  const [{ id: eid }] = await query('SELECT id FROM events WHERE slug = ?', [NEON]);
  groupTierId = (await query("INSERT INTO ticket_tiers (event_id, name, price, quantity, admits, position) VALUES (?, 'Test booth for 6', 60000, 5, 6, 99)", [eid])).insertId;
  group = await buyTicket(guest, NEON, 'Test booth for 6');
  elsewhere = await buyTicket(guest, JAZZ, 'Single');
});

after(async () => {
  const [u] = await query('SELECT id FROM users WHERE email = ?', [`test-door-${stamp}@example.com`]);
  if (u) {
    // Give back the tickets the test bought so the sample events stay as they were
    const items = await query("SELECT oi.tier_id, oi.quantity FROM orders o JOIN order_items oi ON oi.order_id = o.id WHERE o.user_id = ? AND o.status = 'paid'", [u.id]);
    for (const it of items) await query('UPDATE ticket_tiers SET sold = sold - ? WHERE id = ?', [it.quantity, it.tier_id]);
    await query('DELETE FROM checkins WHERE ticket_id IN (SELECT id FROM tickets WHERE user_id = ?)', [u.id]);
    await query('DELETE FROM orders WHERE user_id = ?', [u.id]);
    await query('DELETE FROM attendees WHERE user_id = ?', [u.id]);
  }
  await query('DELETE FROM ticket_tiers WHERE id = ?', [groupTierId]);
  await query('DELETE FROM checkins WHERE ticket_id IS NULL AND created_at > ?', [new Date(stamp - 1000)]);
  await query("DELETE FROM users WHERE email LIKE 'test-%@example.com'");
  server.close();
  await pool.end();
});

const scan = (cookie, slug, code) => api(`/api/checkin/${slug}/scan`, { method: 'POST', cookie, body: { code } });

test('codes are read from QR text or typed with spaces and lower case', () => {
  assert.equal(normaliseCode('TURNUP:ABCD2345EFGH6789'), 'ABCD2345EFGH6789');
  assert.equal(normaliseCode('abcd 2345 efgh 6789'), 'ABCD2345EFGH6789');
});

test('door staff see only their host’s events; other people see none', async () => {
  const mine = (await json(await api('/api/checkin/events', { cookie: door }))).items;
  assert.ok(mine.length > 0);
  assert.ok(mine.some((e) => e.slug === NEON));
  assert.ok(!mine.some((e) => e.slug === JAZZ));
  assert.equal((await json(await api('/api/checkin/events', { cookie: stranger }))).items.length, 0);
  assert.equal((await api(`/api/checkin/${NEON}`, { cookie: stranger })).status, 404);
  assert.equal((await scan(stranger, NEON, ticket.code)).status, 404);
  assert.equal((await api('/api/checkin/events')).status, 401);
});

test('a ticket admits once, then shows when and by whom it was used', async () => {
  const before = (await json(await api(`/api/checkin/${NEON}`, { cookie: door }))).counts.checked_in;
  const first = await json(await scan(door, NEON, `TURNUP:${ticket.code}`));
  assert.equal(first.result, 'admitted');
  assert.equal(first.guest.name, 'Door Test Guest');
  assert.equal(first.counts.checked_in, before + 1);
  const again = await json(await scan(host, NEON, ticket.code));
  assert.equal(again.result, 'already_used');
  assert.equal(again.checked_in_by, 'Sam');
  assert.ok(again.checked_in_at);
});

test('two doors scanning the same ticket at the same moment admit it only once', async () => {
  const t = await buyTicket(guest, NEON, 'Regular');
  const results = await Promise.all([scan(door, NEON, t.code), scan(host, NEON, t.code), scan(door, NEON, t.code)].map(async (r) => (await json(await r)).result));
  assert.equal(results.filter((r) => r === 'admitted').length, 1);
  assert.equal(results.filter((r) => r === 'already_used').length, 2);
});

test('group tickets admit everyone they cover in one scan', async () => {
  const r = await json(await scan(door, NEON, group.code));
  assert.equal(r.result, 'admitted');
  assert.equal(r.guest.admits, 6);
});

test('tickets for another event and made-up codes are refused, and every scan is logged', async () => {
  const wrong = await json(await scan(door, NEON, elsewhere.code));
  assert.equal(wrong.result, 'wrong_event');
  assert.match(wrong.message, /Jazz on the Lawn/);
  const fake = await json(await scan(door, NEON, 'ZZZZ ZZZZ ZZZZ ZZZZ'));
  assert.equal(fake.result, 'invalid');
  const [{ n }] = await query("SELECT COUNT(*) AS n FROM checkins c JOIN events e ON e.id = c.event_id WHERE e.slug = ? AND c.result IN ('wrong_event', 'invalid')", [NEON]);
  assert.ok(n >= 2);
});

test('owners can undo a mistaken check-in; door staff cannot', async () => {
  assert.equal((await api(`/api/checkin/${NEON}/undo`, { method: 'POST', cookie: door, body: { code: ticket.code } })).status, 404);
  const undo = await api(`/api/checkin/${NEON}/undo`, { method: 'POST', cookie: host, body: { code: ticket.code } });
  assert.equal(undo.status, 200);
  assert.equal((await json(await scan(door, NEON, ticket.code))).result, 'admitted');
});

test('the guest list finds people by name and never shows their contact details', async () => {
  const { items } = await json(await api(`/api/checkin/${NEON}/guests?q=Door%20Test`, { cookie: door }));
  assert.ok(items.length >= 1);
  assert.ok(items.every((g) => g.full_name === 'Door Test Guest'));
  assert.ok(items.every((g) => !('email' in g) && !('phone' in g)));
});
