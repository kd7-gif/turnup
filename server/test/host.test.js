// Host dashboard: creating and running events, ticket types, promo codes and the team.
import { test, after, before } from 'node:test';
import assert from 'node:assert/strict';

delete process.env.PAYSTACK_SECRET_KEY;
const { app } = await import('../src/index.js');
const { pool, query } = await import('../src/db.js');
const { fromLagosInput } = await import('../src/routes/host.js');

const server = app.listen(0);
const base = `http://127.0.0.1:${server.address().port}`;
const origin = process.env.CLIENT_ORIGIN?.split(',')[0] || 'http://localhost:5175';
const stamp = Date.now();

const api = (path, { method = 'GET', body, cookie } = {}) => fetch(base + path, {
  method, headers: { 'Content-Type': 'application/json', Origin: origin, ...(cookie ? { Cookie: cookie } : {}) },
  body: body ? JSON.stringify(body) : undefined,
});
const json = (r) => r.json();
const login = async (email) => (await api('/api/auth/login', { method: 'POST', body: { email, password: 'turnup123' } })).headers.get('set-cookie').split(';')[0];
const register = async (tag) => (await api('/api/auth/register', { method: 'POST',
  body: { full_name: `Host Test ${tag}`, email: `test-host-${tag}-${stamp}@example.com`, phone: '08012345678', password: 'longpassword' } }))
  .headers.get('set-cookie').split(';')[0];

// A date in the future, as the event form sends it (Lagos time)
const lagos = (days, hour) => {
  const d = new Date(Date.now() + 3600000 + days * 86400000);
  return `${d.toISOString().slice(0, 10)}T${String(hour).padStart(2, '0')}:00`;
};
const validEvent = (extra = {}) => ({
  host_slug: 'afterdark-collective', title: `Test Launch Party ${stamp}`, category: 'Parties', city: 'Lagos',
  summary: 'A test event made by the test suite', description: 'This event exists only while the tests run.',
  venue: 'Test Hall', area: 'Yaba', image_url: '/img/events/9005510.webp', starts_at: lagos(10, 20), ends_at: lagos(10, 23),
  tiers: [{ name: 'Regular', price: 5000, quantity: 3 }, { name: 'Free list', price: 0, quantity: 10 }], ...extra,
});

let host; let door; let stranger; let cohost; let buyer; let slug;

before(async () => {
  host = await login('host@turnup.demo');
  door = await login('door@turnup.demo');
  stranger = await register('stranger');
  cohost = await register('cohost');
  buyer = await register('buyer');
});

after(async () => {
  const events = await query('SELECT id FROM events WHERE title LIKE ?', [`%${stamp}%`]);
  for (const { id } of events) {
    await query('DELETE FROM orders WHERE event_id = ?', [id]);
    await query('DELETE FROM events WHERE id = ?', [id]);
  }
  await query(`DELETE FROM promo_codes WHERE code LIKE 'TEST%'`);
  await query("DELETE FROM users WHERE email LIKE 'test-%@example.com'");
  server.close();
  await pool.end();
});

test('form times are read as Lagos time', () => {
  assert.equal(fromLagosInput('2026-12-05T20:00').toISOString(), '2026-12-05T19:00:00.000Z');
  assert.equal(fromLagosInput('2026-02-31T20:00'), null);
  assert.equal(fromLagosInput('tomorrow'), null);
});

test('only people who run a host can use the dashboard', async () => {
  assert.equal((await api('/api/host/overview', { cookie: stranger })).status, 403);
  assert.equal((await api('/api/host/overview', { cookie: door })).status, 403); // door staff only check guests in
  const ov = await json(await api('/api/host/overview', { cookie: host }));
  assert.equal(ov.host.slug, 'afterdark-collective');
  assert.ok(ov.events.length >= 4);
  assert.ok(ov.totals.tickets_sold > 0);
  assert.equal((await api('/api/host/events/jazz-on-the-lawn', { cookie: host })).status, 404); // another host's event
});

test('the event form explains every problem', async () => {
  const res = await api('/api/host/events', { method: 'POST', cookie: host, body: { host_slug: 'afterdark-collective', title: 'x', starts_at: lagos(5, 22), ends_at: lagos(5, 20), tiers: [{ name: '', price: 50, quantity: 0 }] } });
  assert.equal(res.status, 422);
  const { fields } = await json(res);
  for (const k of ['title', 'category', 'summary', 'description', 'venue', 'area', 'city', 'image_url', 'ends_at', 'tiers.0.name', 'tiers.0.price', 'tiers.0.quantity']) {
    assert.ok(fields[k], `expected an error for ${k}`);
  }
  const past = await json(await api('/api/host/events', { method: 'POST', cookie: host, body: validEvent({ starts_at: lagos(-2, 20), ends_at: lagos(-2, 23) }) }));
  assert.ok(past.fields.starts_at);
  const notMine = await api('/api/host/events', { method: 'POST', cookie: host, body: validEvent({ host_slug: 'lagos-live-sessions' }) });
  assert.equal(notMine.status, 404);
});

test('drafts are hidden from the public but can be previewed by the host, then published', async () => {
  const res = await api('/api/host/events', { method: 'POST', cookie: host, body: validEvent() });
  assert.equal(res.status, 201);
  ({ slug } = await json(res));
  assert.equal((await api(`/api/events/${slug}`)).status, 404);
  assert.equal((await api(`/api/events/${slug}`, { cookie: stranger })).status, 404);
  const preview = await json(await api(`/api/events/${slug}`, { cookie: host }));
  assert.equal(preview.event.draft, true);
  assert.ok(!(await json(await api('/api/events'))).items.some((e) => e.slug === slug));

  await api(`/api/host/events/${slug}`, { method: 'PATCH', cookie: host, body: { status: 'published' } });
  assert.equal((await api(`/api/events/${slug}`)).status, 200);
  assert.equal(new Date((await json(await api(`/api/events/${slug}`))).event.starts_at).getUTCHours(), 19); // 8pm Lagos
});

test('hosts can edit details; a second event with the same name gets its own address', async () => {
  await api(`/api/host/events/${slug}`, { method: 'PATCH', cookie: host, body: { summary: 'Now with a brand new summary' } });
  assert.equal((await json(await api(`/api/events/${slug}`))).event.summary, 'Now with a brand new summary');
  const second = await json(await api('/api/host/events', { method: 'POST', cookie: host, body: validEvent() }));
  assert.equal(second.slug, `${slug}-2`);
});

test('ticket quantities can never drop below what is sold or being paid for', async () => {
  const { tiers } = await json(await api(`/api/events/${slug}`));
  const regular = tiers.find((t) => t.name === 'Regular');
  const { order_number } = await json(await api('/api/orders', { method: 'POST', cookie: buyer, body: { event_slug: slug, items: [{ tier_id: regular.id, quantity: 2 }] } }));
  await api(`/api/orders/${order_number}/simulate-payment`, { method: 'POST', cookie: buyer });

  const tooLow = await api(`/api/host/events/${slug}/tiers/${regular.id}`, { method: 'PATCH', cookie: host, body: { quantity: 1 } });
  assert.equal(tooLow.status, 409);
  assert.equal((await api(`/api/host/events/${slug}/tiers/${regular.id}`, { method: 'PATCH', cookie: host, body: { quantity: 2, price: 6000 } })).status, 200);
  assert.equal((await api(`/api/host/events/${slug}/tiers/${regular.id}`, { method: 'DELETE', cookie: host })).status, 409); // has orders

  const added = await json(await api(`/api/host/events/${slug}/tiers`, { method: 'POST', cookie: host, body: { name: 'VIP', price: 20000, quantity: 5 } }));
  assert.equal((await api(`/api/host/events/${slug}/tiers/${added.id}`, { method: 'DELETE', cookie: host })).status, 200);

  const dash = await json(await api(`/api/host/events/${slug}`, { cookie: host }));
  assert.equal(dash.event.sold, 2);
  assert.equal(dash.event.revenue, 10000);
  assert.equal(dash.orders.length, 1);
  assert.equal(dash.days.length, 14);
  assert.equal(dash.days.at(-1).tickets, 2);
});

test('an event with tickets sold cannot go back to draft, but can be cancelled, which stops sales', async () => {
  const back = await api(`/api/host/events/${slug}`, { method: 'PATCH', cookie: host, body: { status: 'draft' } });
  assert.equal(back.status, 422);
  await api(`/api/host/events/${slug}`, { method: 'PATCH', cookie: host, body: { status: 'cancelled' } });
  const { tiers } = await json(await api(`/api/events/${slug}`));
  const res = await api('/api/orders/quote', { method: 'POST', body: { event_slug: slug, items: [{ tier_id: tiers[1].id, quantity: 1 }] } });
  assert.equal(res.status, 409);
  assert.equal((await api(`/api/host/events/${slug}`, { method: 'PATCH', cookie: host, body: { status: 'published' } })).status, 422);
});

test('promo codes: create, refuse duplicates and bad values, and switch off', async () => {
  const code = `TEST${String(stamp).slice(-6)}`;
  assert.equal((await api('/api/host/afterdark-collective/promos', { method: 'POST', cookie: host, body: { code, kind: 'percent', value: 20, max_uses: 50 } })).status, 201);
  assert.equal((await api('/api/host/afterdark-collective/promos', { method: 'POST', cookie: host, body: { code, kind: 'percent', value: 20 } })).status, 422);
  const bad = await json(await api('/api/host/afterdark-collective/promos', { method: 'POST', cookie: host, body: { code: 'has space', kind: 'percent', value: 150 } }));
  assert.ok(bad.fields.code && bad.fields.value);
  const { items } = await json(await api('/api/host/afterdark-collective/promos', { cookie: host }));
  const mine = items.find((p) => p.code === code);
  await api(`/api/host/afterdark-collective/promos/${mine.id}`, { method: 'PATCH', cookie: host, body: { active: false } });
  const { tiers } = await json(await api('/api/events/neon-nights-amapiano-edition'));
  const q = await api('/api/orders/quote', { method: 'POST', body: { event_slug: 'neon-nights-amapiano-edition', items: [{ tier_id: tiers[0].id, quantity: 1 }], promo_code: code } });
  assert.equal(q.status, 422); // switched off
});

test('owners build the team; co-hosts can run events but not change the team', async () => {
  assert.equal((await api('/api/host/afterdark-collective/team', { method: 'POST', cookie: host, body: { email: 'nobody-here@example.com', role: 'door' } })).status, 404);
  const add = await api('/api/host/afterdark-collective/team', { method: 'POST', cookie: host, body: { email: `test-host-cohost-${stamp}@example.com`, role: 'cohost' } });
  assert.equal(add.status, 201);

  const me = (await json(await api('/api/auth/me', { cookie: cohost }))).user;
  assert.equal(me.can_host, true);
  assert.equal((await api('/api/host/overview', { cookie: cohost })).status, 200);
  const created = await api('/api/host/events', { method: 'POST', cookie: cohost, body: validEvent({ title: `Cohost Night ${stamp}` }) });
  assert.equal(created.status, 201);
  assert.equal((await api('/api/host/afterdark-collective/team', { method: 'POST', cookie: cohost, body: { email: `test-host-stranger-${stamp}@example.com` } })).status, 404);

  const { items } = await json(await api('/api/host/afterdark-collective/team', { cookie: host }));
  const id = items.find((u) => u.email === `test-host-cohost-${stamp}@example.com`).id;
  await api(`/api/host/afterdark-collective/team/${id}`, { method: 'DELETE', cookie: host });
  assert.equal((await api('/api/host/overview', { cookie: cohost })).status, 403);
});
