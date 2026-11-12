// Ticket checkout tests: server-side pricing, promo codes, free RSVPs, test payments and never overselling.
import { test, after, before } from 'node:test';
import assert from 'node:assert/strict';

delete process.env.PAYSTACK_SECRET_KEY; // these tests use the built-in test payments
const { app } = await import('../src/index.js');
const { pool, query } = await import('../src/db.js');
const { bookingFee } = await import('../src/services/pricing.js');

const server = app.listen(0);
const base = `http://127.0.0.1:${server.address().port}`;
const origin = process.env.CLIENT_ORIGIN?.split(',')[0] || 'http://localhost:5175';
const stamp = Date.now();

const api = (path, { method = 'GET', body, cookie } = {}) =>
  fetch(base + path, {
    method,
    headers: { 'Content-Type': 'application/json', Origin: origin, ...(cookie ? { Cookie: cookie } : {}) },
    body: body ? JSON.stringify(body) : undefined,
  });
const json = (res) => res.json();
const register = async (tag) => (await api('/api/auth/register', { method: 'POST',
  body: { full_name: `Buyer ${tag}`, email: `test-buyer-${tag}-${stamp}@example.com`, phone: '08012345678', password: 'longpassword' } }))
  .headers.get('set-cookie').split(';')[0];

// A private test event so these tests never disturb the sample data
const slug = `test-checkout-${stamp}`;
let eventId; let tier = {}; let alice; let bob;

before(async () => {
  const [host] = await query("SELECT id FROM hosts WHERE slug = 'afterdark-collective'");
  const res = await query(
    `INSERT INTO events (host_id, title, slug, category, summary, description, venue, area, city, starts_at, ends_at)
     VALUES (?, 'Test Checkout Party', ?, 'Parties', '', 'Test', 'Test venue', 'Yaba', 'Lagos', UTC_TIMESTAMP() + INTERVAL 5 DAY, UTC_TIMESTAMP() + INTERVAL 5 DAY + INTERVAL 4 HOUR)`,
    [host.id, slug]
  );
  eventId = res.insertId;
  const add = async (name, price, quantity, extra = {}) => {
    const r = await query(`INSERT INTO ticket_tiers (event_id, name, price, quantity, max_per_order, admits, sales_end) VALUES (?,?,?,?,?,?,?)`,
      [eventId, name, price, quantity, extra.max ?? 10, extra.admits ?? 1, extra.salesEnd ?? null]);
    tier[name] = r.insertId;
  };
  await add('Regular', 10000, 100);
  await add('Group of 4', 36000, 5, { admits: 4 });
  await add('Free', 0, 50);
  await add('Last two', 5000, 2);
  await add('Ended', 3000, 50, { salesEnd: new Date(Date.now() - 3600000) });
  await query("INSERT INTO promo_codes (host_id, event_id, code, kind, value, max_uses) VALUES (?, ?, 'TESTHALF', 'percent', 50, 1)", [host.id, eventId]);
  await query("INSERT INTO promo_codes (host_id, event_id, code, kind, value, expires_at) VALUES (?, ?, 'TESTOLD', 'amount', 1000, UTC_TIMESTAMP() - INTERVAL 1 DAY)", [host.id, eventId]);
  alice = await register('alice');
  bob = await register('bob');
});

after(async () => {
  await query("DELETE FROM orders WHERE event_id = ?", [eventId]);
  await query("DELETE FROM tickets WHERE event_id = ?", [eventId]);
  await query('DELETE FROM events WHERE id = ?', [eventId]);
  await query("DELETE FROM promo_codes WHERE code IN ('TESTHALF', 'TESTOLD')");
  await query("DELETE FROM users WHERE email LIKE 'test-%@example.com'");
  server.close();
  await pool.end();
});

const quote = (items, promo_code) => api('/api/orders/quote', { method: 'POST', body: { event_slug: slug, items, promo_code } });
const buy = (cookie, items, promo_code) => api('/api/orders', { method: 'POST', cookie, body: { event_slug: slug, items, promo_code } });
const pay = (cookie, number) => api(`/api/orders/${number}/simulate-payment`, { method: 'POST', cookie });

test('booking fee is 2.5% plus ₦100, capped at ₦3,000, and free orders pay nothing', () => {
  assert.equal(bookingFee(0), 0);
  assert.equal(bookingFee(10000), 350);
  assert.equal(bookingFee(1000000), 3000);
});

test('prices come from the server, including groups and fees', async () => {
  const q = await json(await quote([{ tier_id: tier.Regular, quantity: 2 }, { tier_id: tier['Group of 4'], quantity: 1 }]));
  assert.equal(q.subtotal, 56000);
  assert.equal(q.fee, bookingFee(56000));
  assert.equal(q.total, 56000 + q.fee);
  assert.equal(q.ticket_count, 3);
  assert.equal(q.people, 6); // two singles plus a group of four
});

test('promo codes discount the order; bad and expired codes are explained', async () => {
  const q = await json(await quote([{ tier_id: tier.Regular, quantity: 2 }], 'testhalf'));
  assert.equal(q.discount, 10000);
  assert.equal(q.promo.code, 'TESTHALF');
  assert.equal(q.fee, bookingFee(10000)); // fee is on the discounted amount
  const bad = await quote([{ tier_id: tier.Regular, quantity: 1 }], 'NOPE');
  assert.equal(bad.status, 422);
  assert.ok((await json(bad)).fields.promo);
  assert.match((await json(await quote([{ tier_id: tier.Regular, quantity: 1 }], 'TESTOLD'))).error, /expired/);
  assert.equal((await quote([{ tier_id: tier.Regular, quantity: 1 }], 'WATERFRONT10')).status, 422); // another event's code
});

test('rejects tickets from other events, too many at once, ended sales and more than are left', async () => {
  const [other] = await query("SELECT id FROM ticket_tiers WHERE event_id <> ? LIMIT 1", [eventId]);
  assert.equal((await quote([{ tier_id: other.id, quantity: 1 }])).status, 422);
  assert.equal((await quote([{ tier_id: tier.Regular, quantity: 11 }])).status, 422);
  assert.equal((await quote([{ tier_id: tier.Ended, quantity: 1 }])).status, 409);
  assert.match((await json(await quote([{ tier_id: tier['Last two'], quantity: 3 }]))).error, /Only 2/);
  assert.equal((await quote([])).status, 422);
  assert.equal((await quote([{ tier_id: tier.Regular, quantity: -1 }])).status, 422);
});

test('buying needs an account', async () => {
  assert.equal((await buy(null, [{ tier_id: tier.Regular, quantity: 1 }])).status, 401);
});

test('free RSVPs are confirmed straight away with a ticket', async () => {
  const res = await buy(alice, [{ tier_id: tier.Free, quantity: 1 }]);
  assert.equal(res.status, 201);
  const { order_number, payment } = await json(res);
  assert.equal(payment.mode, 'free');
  const { order } = await json(await api(`/api/orders/${order_number}`, { cookie: alice }));
  assert.equal(order.status, 'paid');
  assert.equal(order.tickets.length, 1);
  const { upcoming } = await json(await api('/api/me/tickets', { cookie: alice }));
  assert.ok(upcoming.some((o) => o.order_number === order_number));
});

test('paid orders wait for payment, then issue one ticket per ticket bought, exactly once', async () => {
  const [{ sold: before }] = await query('SELECT sold FROM ticket_tiers WHERE id = ?', [tier['Group of 4']]);
  const { order_number, payment } = await json(await buy(alice, [{ tier_id: tier.Regular, quantity: 2 }, { tier_id: tier['Group of 4'], quantity: 1 }], 'TESTHALF'));
  assert.equal(payment.mode, 'simulated');
  let { order } = await json(await api(`/api/orders/${order_number}`, { cookie: alice }));
  assert.equal(order.status, 'pending');
  assert.equal(order.tickets.length, 0);

  ({ order } = await json(await pay(alice, order_number)));
  assert.equal(order.status, 'paid');
  assert.equal(order.tickets.length, 3);
  assert.equal(order.tickets.filter((t) => t.admits === 4).length, 1);
  assert.ok(order.tickets.every((t) => /^[2-9A-Z]{16}$/.test(t.code)));

  await pay(alice, order_number); // paying twice changes nothing
  ({ order } = await json(await api(`/api/orders/${order_number}`, { cookie: alice })));
  assert.equal(order.tickets.length, 3);
  const [{ sold: afterSold }] = await query('SELECT sold FROM ticket_tiers WHERE id = ?', [tier['Group of 4']]);
  assert.equal(afterSold, before + 1);
  const [{ used }] = await query("SELECT used FROM promo_codes WHERE code = 'TESTHALF'");
  assert.equal(used, 1);
  // The one-use code is now gone
  assert.match((await json(await quote([{ tier_id: tier.Regular, quantity: 1 }], 'TESTHALF'))).error, /fully used/);
});

test('people cannot see each other’s orders', async () => {
  const { order_number } = await json(await buy(alice, [{ tier_id: tier.Regular, quantity: 1 }]));
  assert.equal((await api(`/api/orders/${order_number}`, { cookie: bob })).status, 404);
  assert.equal((await pay(bob, order_number)).status, 404);
});

test('if tickets run out before payment finishes, the order fails and nothing is oversold', async () => {
  // Both buyers start checkout while two tickets are left
  const a = await json(await buy(alice, [{ tier_id: tier['Last two'], quantity: 2 }]));
  const b = await json(await buy(bob, [{ tier_id: tier['Last two'], quantity: 1 }]));
  assert.equal((await json(await pay(alice, a.order_number))).order.status, 'paid');
  const late = (await json(await pay(bob, b.order_number))).order;
  assert.equal(late.status, 'failed');
  assert.equal(late.tickets.length, 0);
  assert.match(late.failure, /sold out/);
  const [{ sold, quantity }] = await query('SELECT sold, quantity FROM ticket_tiers WHERE id = ?', [tier['Last two']]);
  assert.equal(sold, quantity);
});

test('Paystack webhooks without a valid signature are refused', async () => {
  const res = await fetch(`${base}/api/payments/webhook`, { method: 'POST', headers: { 'Content-Type': 'application/json', 'x-paystack-signature': 'fake' },
    body: JSON.stringify({ event: 'charge.success', data: { reference: 'x', amount: 100, currency: 'NGN' } }) });
  assert.equal(res.status, 401);
});
