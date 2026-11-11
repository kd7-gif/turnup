// API tests for Phase 1: accounts, browsing events, saving and following.
import { test, after } from 'node:test';
import assert from 'node:assert/strict';

const { app } = await import('../src/index.js');
const { pool, query } = await import('../src/db.js');
const { windowFor } = await import('../src/routes/events.js');

const server = app.listen(0);
const base = `http://127.0.0.1:${server.address().port}`;
const origin = process.env.CLIENT_ORIGIN?.split(',')[0] || 'http://localhost:5175';
const stamp = Date.now();

const api = (path, { method = 'GET', body, cookie, headers = {} } = {}) =>
  fetch(base + path, {
    method,
    headers: { 'Content-Type': 'application/json', Origin: origin, ...(cookie ? { Cookie: cookie } : {}), ...headers },
    body: body ? JSON.stringify(body) : undefined,
  });
const json = async (res) => res.json();
const cookieOf = (res) => res.headers.get('set-cookie').split(';')[0];
const login = async (email) => cookieOf(await api('/api/auth/login', { method: 'POST', body: { email, password: 'turnup123' } }));

after(async () => {
  await query("DELETE FROM users WHERE email LIKE 'test-%@example.com'");
  server.close();
  await pool.end();
});

test('health check reaches the database', async () => {
  assert.deepEqual(await json(await api('/api/health')), { ok: true });
});

test('signed-out visitors get user null, not an error', async () => {
  const res = await api('/api/auth/me');
  assert.equal(res.status, 200);
  assert.equal((await json(res)).user, null);
});

test('registration validates every field and never creates hosts', async () => {
  const bad = await api('/api/auth/register', { method: 'POST', body: { full_name: 'A', email: 'nope', phone: '1', password: 'short' } });
  assert.equal(bad.status, 422);
  assert.deepEqual(Object.keys((await json(bad)).fields).sort(), ['email', 'full_name', 'password', 'phone']);

  const ok = await api('/api/auth/register', { method: 'POST',
    body: { full_name: 'Test Person', email: `test-${stamp}@example.com`, phone: '08012345678', password: 'longpassword', role: 'admin', city: 'Abuja' } });
  assert.equal(ok.status, 201);
  const { user } = await json(ok);
  assert.equal(user.role, 'guest');
  assert.equal(user.city, 'Abuja');

  const again = await api('/api/auth/register', { method: 'POST',
    body: { full_name: 'Test Person', email: `test-${stamp}@example.com`, phone: '08012345678', password: 'longpassword' } });
  assert.equal(again.status, 409);
});

test('wrong passwords get the same message as unknown emails', async () => {
  const a = await json(await api('/api/auth/login', { method: 'POST', body: { email: 'guest@turnup.demo', password: 'wrong-password' } }));
  const b = await json(await api('/api/auth/login', { method: 'POST', body: { email: 'nobody@example.com', password: 'wrong-password' } }));
  assert.equal(a.error, b.error);
});

test('host accounts see the host pages they run', async () => {
  const { user } = await json(await api('/api/auth/me', { cookie: await login('host@turnup.demo') }));
  assert.equal(user.role, 'host');
  assert.equal(user.hosts[0].slug, 'afterdark-collective');
});

test('change-making requests from other websites are blocked', async () => {
  const res = await api('/api/auth/login', { method: 'POST', headers: { Origin: 'https://evil.example' }, body: { email: 'x', password: 'y' } });
  assert.equal(res.status, 403);
});

test('lists upcoming events with prices and people going, soonest first', async () => {
  const { items } = await json(await api('/api/events'));
  assert.ok(items.length >= 20);
  for (let i = 1; i < items.length; i++) assert.ok(new Date(items[i - 1].starts_at) <= new Date(items[i].starts_at));
  const e = items.find((x) => x.slug === 'afrobeats-live-at-the-waterfront');
  assert.equal(e.from_price, 15000); // early bird is the cheapest ticket still on sale
  assert.ok(e.going_count > 0);
  assert.deepEqual(e.friends_going, []); // visitors have no friends list
});

test('filters by city, category, search and free', async () => {
  const abuja = (await json(await api('/api/events?city=Abuja'))).items;
  assert.ok(abuja.length > 0 && abuja.every((e) => e.city === 'Abuja'));
  const comedy = (await json(await api('/api/events?category=Comedy'))).items;
  assert.ok(comedy.length > 0 && comedy.every((e) => e.category === 'Comedy'));
  const jazz = (await json(await api('/api/events?q=jazz'))).items;
  assert.ok(jazz.some((e) => e.slug === 'jazz-on-the-lawn'));
  const free = (await json(await api('/api/events?free=1'))).items;
  assert.ok(free.length > 0 && free.every((e) => e.is_free));
});

test('date windows follow Lagos time', () => {
  // Wednesday 11 Nov 2026, 10:00 in Lagos
  const wed = new Date('2026-11-11T09:00:00Z');
  const [, todayEnd] = windowFor('today', wed);
  assert.equal(todayEnd.toISOString(), '2026-11-11T23:00:00.000Z'); // midnight in Lagos
  const [wkStart, wkEnd] = windowFor('weekend', wed);
  assert.equal(wkStart.toISOString(), '2026-11-13T16:00:00.000Z'); // Friday 5pm
  assert.equal(wkEnd.toISOString(), '2026-11-15T23:00:00.000Z'); // end of Sunday
  // On Saturday, "this weekend" starts now and still ends on Sunday night
  const sat = new Date('2026-11-14T12:00:00Z');
  const [satStart, satEnd] = windowFor('weekend', sat);
  assert.equal(satStart.toISOString(), sat.toISOString());
  assert.equal(satEnd.toISOString(), '2026-11-15T23:00:00.000Z');
});

test('event page has the host, ticket types and remaining tickets', async () => {
  const res = await api('/api/events/afrobeats-live-at-the-waterfront');
  const { event, host, tiers } = await json(res);
  assert.equal(event.title, 'Afrobeats Live at the Waterfront');
  assert.equal(host.slug, 'lagos-live-sessions');
  assert.equal(tiers.length, 4);
  assert.ok(tiers.every((t) => typeof t.remaining === 'number'));
  assert.equal((await api('/api/events/no-such-event')).status, 404);
});

test('the demo guest sees which friends are going', async () => {
  const cookie = await login('guest@turnup.demo');
  const { items } = await json(await api('/api/events', { cookie }));
  const withFriends = items.filter((e) => e.friends_count > 0);
  assert.ok(withFriends.length > 0);
  assert.ok(withFriends.every((e) => e.friends_going.length === Math.min(3, e.friends_count)));
});

test('saving needs an account, and saved events show up in the saved list', async () => {
  assert.equal((await api('/api/events/open-mic-night/save', { method: 'POST' })).status, 401);
  const cookie = cookieOf(await api('/api/auth/register', { method: 'POST',
    body: { full_name: 'Saver Test', email: `test-saver-${stamp}@example.com`, phone: '08012345678', password: 'longpassword' } }));
  await api('/api/events/open-mic-night/save', { method: 'POST', cookie });
  await api('/api/events/open-mic-night/save', { method: 'POST', cookie }); // saving twice is harmless
  let saved = (await json(await api('/api/me/saved', { cookie }))).items;
  assert.deepEqual(saved.map((e) => e.slug), ['open-mic-night']);
  assert.equal(saved[0].saved, true);
  await api('/api/events/open-mic-night/save', { method: 'DELETE', cookie });
  saved = (await json(await api('/api/me/saved', { cookie }))).items;
  assert.equal(saved.length, 0);
});

test('following a host updates their follower count', async () => {
  const cookie = cookieOf(await api('/api/auth/register', { method: 'POST',
    body: { full_name: 'Follow Test', email: `test-follow-${stamp}@example.com`, phone: '08012345678', password: 'longpassword' } }));
  const before = (await json(await api('/api/hosts/punchline-lagos', { cookie }))).host;
  assert.equal(before.following, false);
  await api('/api/hosts/punchline-lagos/follow', { method: 'POST', cookie });
  const afterFollow = (await json(await api('/api/hosts/punchline-lagos', { cookie }))).host;
  assert.equal(afterFollow.following, true);
  assert.equal(afterFollow.followers, before.followers + 1);
  await api('/api/hosts/punchline-lagos/follow', { method: 'DELETE', cookie });
  assert.equal((await json(await api('/api/hosts/punchline-lagos', { cookie }))).host.followers, before.followers);
});
