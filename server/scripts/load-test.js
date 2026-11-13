// Load test: hundreds of people try to buy the same tickets at the same moment.
//   npm run load-test                 (500 buyers, 100 tickets)
//   npm run load-test -- 1000 150     (1,000 buyers, 150 tickets)
//
// It runs the real API against your real database with a temporary event, then deletes everything it made.
// Round 1  everyone hits "Get tickets" at once
// Round 2  most winners pay, some walk away; their holds expire and the tickets go back on sale
// Round 3  people who missed out try again and pick up the released tickets
// Then it checks that nothing was oversold, every paid order got its tickets and nobody paid for nothing.
// Finally it runs the same rush through a naive "check, then update" approach to show what goes wrong without holds.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

process.env.PAYSTACK_SECRET_KEY = ''; // built-in test payments
const { app } = await import('../src/index.js');
const { pool, query } = await import('../src/db.js');
const { releaseExpiredHolds } = await import('../src/services/orders.js');
const { setSession } = await import('../src/middleware/auth.js');
const { config } = await import('../src/config.js');

const BUYERS = Number(process.argv[2]) || 500;
const TICKETS = Number(process.argv[3]) || 100;
const ABANDON = 0.25; // share of winners who never pay

const server = app.listen(0);
const base = `http://127.0.0.1:${server.address().port}`;
const origin = config.clientOrigins[0];
const stamp = Date.now();
const slug = `load-test-${stamp}`;

// Seeded randomness so every run asks for the same quantities
let seed = 42;
const rand = () => ((seed = (seed * 1103515245 + 12345) % 2147483648) / 2147483648);

const call = async (path, cookie, body) => {
  const t = performance.now();
  const res = await fetch(base + path, { method: 'POST', headers: { 'Content-Type': 'application/json', Origin: origin, Cookie: cookie },
    body: JSON.stringify(body || {}) });
  const data = await res.json().catch(() => ({}));
  return { status: res.status, data, ms: performance.now() - t };
};
const pct = (arr, p) => { const s = [...arr].sort((a, b) => a - b); return s[Math.min(s.length - 1, Math.floor((p / 100) * s.length))] || 0; };
const fmt = (n) => n.toLocaleString('en-GB');

let eventId; let tierId;
const report = [];
const log = (line = '') => { console.log(line); report.push(line); };

try {
  // ---- Set up a temporary event and buyers ----
  const [{ id: hostId }] = await query("SELECT id FROM hosts ORDER BY id LIMIT 1");
  eventId = (await query(
    `INSERT INTO events (host_id, title, slug, category, description, venue, area, city, starts_at, ends_at)
     VALUES (?, 'Load Test Arena', ?, 'Music', 'Temporary', 'Test', 'Test', 'Lagos', UTC_TIMESTAMP() + INTERVAL 7 DAY, UTC_TIMESTAMP() + INTERVAL 7 DAY + INTERVAL 4 HOUR)`,
    [hostId, slug])).insertId;
  tierId = (await query('INSERT INTO ticket_tiers (event_id, name, price, quantity, max_per_order) VALUES (?, ?, 10000, ?, 4)',
    [eventId, 'General', TICKETS])).insertId;

  const rows = Array.from({ length: BUYERS }, (_, n) => [`Load Buyer ${n}`, `loadtest-${stamp}-${n}@example.com`, 'x']);
  await query('INSERT INTO users (full_name, email, password_hash) VALUES ?', [rows]);
  const ids = (await query('SELECT id FROM users WHERE email LIKE ? ORDER BY id', [`loadtest-${stamp}-%`])).map((r) => r.id);
  const buyers = ids.map((id) => {
    let cookie = '';
    setSession({ cookie: (_n, v) => { cookie = `turnup_session=${v}`; } }, { id, role: 'guest' });
    return { cookie, want: rand() < 0.7 ? 1 : 2 };
  });
  const wanted = buyers.reduce((n, b) => n + b.want, 0);

  log('# Turnup load test');
  log('');
  log(`${fmt(BUYERS)} buyers want ${fmt(wanted)} tickets. There are ${fmt(TICKETS)}.`);
  log(`Database: ${(await query('SELECT VERSION() AS v'))[0].v}`);
  log('');

  // ---- Round 1: everyone at once ----
  const order = (b) => call('/api/orders', b.cookie, { event_slug: slug, items: [{ tier_id: tierId, quantity: b.want }] });
  let t0 = performance.now();
  const r1 = await Promise.all(buyers.map(order));
  const r1Secs = (performance.now() - t0) / 1000;
  const winners = buyers.map((b, i) => ({ ...b, res: r1[i] })).filter((b) => b.res.status === 201);
  const losers = buyers.filter((_, i) => r1[i].status !== 201);
  const errors1 = r1.filter((r) => ![201, 409].includes(r.status));
  log('## Round 1: everyone clicks "Get tickets" at the same moment');
  log(`- ${fmt(BUYERS)} requests in ${r1Secs.toFixed(2)}s (${fmt(Math.round(BUYERS / r1Secs))} a second)`);
  log(`- ${fmt(winners.length)} got a 10-minute hold, ${fmt(r1.filter((r) => r.status === 409).length)} were told it sold out, ${errors1.length} errors`);
  log(`- Response time: median ${pct(r1.map((r) => r.ms), 50).toFixed(0)} ms, 95th percentile ${pct(r1.map((r) => r.ms), 95).toFixed(0)} ms`);
  const afterR1 = (await query('SELECT sold, held FROM ticket_tiers WHERE id = ?', [tierId]))[0];
  log(`- Tickets held: ${afterR1.held} of ${TICKETS}`);
  log('');

  // ---- Round 2: most pay, some walk away and their holds expire ----
  const walkAway = winners.filter(() => rand() < ABANDON);
  const payers = winners.filter((w) => !walkAway.includes(w));
  t0 = performance.now();
  const paid = await Promise.all(payers.map((w) => call(`/api/orders/${w.res.data.order_number}/simulate-payment`, w.cookie)));
  const r2Secs = (performance.now() - t0) / 1000;
  await query('UPDATE orders SET expires_at = UTC_TIMESTAMP() - INTERVAL 1 SECOND WHERE order_number IN (?)',
    [walkAway.length ? walkAway.map((w) => w.res.data.order_number) : ['none']]);
  const released = await releaseExpiredHolds();
  log('## Round 2: winners pay, some walk away');
  log(`- ${fmt(payers.length)} paid at the same time in ${r2Secs.toFixed(2)}s, all confirmed: ${paid.every((p) => p.data.order?.status === 'paid') ? 'yes' : 'NO'}`);
  log(`- ${fmt(walkAway.length)} walked away; after 10 minutes their ${released} holds went back on sale`);
  log('');

  // ---- Round 3: people who missed out try again ----
  const r3 = await Promise.all(losers.map(order));
  const second = losers.map((b, i) => ({ ...b, res: r3[i] })).filter((b) => b.res.status === 201);
  await Promise.all(second.map((w) => call(`/api/orders/${w.res.data.order_number}/simulate-payment`, w.cookie)));
  log('## Round 3: people who missed out try again');
  log(`- ${fmt(second.length)} of ${fmt(losers.length)} picked up the released tickets and paid`);
  log('');

  // ---- Checks ----
  const [final] = await query('SELECT sold, held, quantity FROM ticket_tiers WHERE id = ?', [tierId]);
  const [{ tickets }] = await query('SELECT COUNT(*) AS tickets FROM tickets WHERE event_id = ?', [eventId]);
  const [{ paidQty }] = await query(
    "SELECT COALESCE(SUM(oi.quantity), 0) AS paidQty FROM orders o JOIN order_items oi ON oi.order_id = o.id WHERE o.event_id = ? AND o.status = 'paid'", [eventId]);
  const [{ failed }] = await query("SELECT COUNT(*) AS failed FROM orders WHERE event_id = ? AND status = 'failed'", [eventId]);
  const checks = [
    ['Never oversold', final.sold <= final.quantity, `${final.sold} sold of ${final.quantity}`],
    ['Sold out completely (no tickets lost)', final.sold + final.held === final.quantity || final.sold === final.quantity, `${final.sold} sold, ${final.held} still held`],
    ['Every paid ticket was issued exactly once', Number(tickets) === Number(paidQty), `${tickets} tickets issued for ${paidQty} paid`],
    ['Nobody paid for tickets they did not get', Number(failed) === 0, `${failed} failed paid orders`],
    ['No server errors', errors1.length === 0, `${errors1.length} errors`],
  ];
  log('## Checks');
  for (const [name, ok, detail] of checks) log(`- ${ok ? 'PASS' : 'FAIL'}  ${name} (${detail})`);
  log('');

  // ---- The naive approach, for comparison ----
  // Read how many are sold, decide in code, then write. Two buyers can both read "99 sold" and both write.
  await query('CREATE TABLE IF NOT EXISTS loadtest_naive (id INT PRIMARY KEY, quantity INT, sold INT)');
  await query('REPLACE INTO loadtest_naive VALUES (1, ?, 0)', [TICKETS]);
  let naiveWins = 0;
  await Promise.all(buyers.map(async (b) => {
    const [{ sold }] = await query('SELECT sold FROM loadtest_naive WHERE id = 1');
    if (sold + b.want > TICKETS) return;
    await new Promise((r) => setTimeout(r, Math.random() * 3)); // the tiny gap while the app works
    await query('UPDATE loadtest_naive SET sold = sold + ? WHERE id = 1', [b.want]);
    naiveWins++;
  }));
  const [{ sold: naiveSold }] = await query('SELECT sold FROM loadtest_naive WHERE id = 1');
  await query('DROP TABLE loadtest_naive');
  log('## Without holds: the naive "check, then update" approach');
  log(`- Same ${fmt(BUYERS)} buyers: ${fmt(naiveWins)} were told they had tickets and ${fmt(naiveSold)} tickets were sold for ${fmt(TICKETS)} places`);
  log(`- Oversold by ${fmt(Math.max(0, naiveSold - TICKETS))} tickets${naiveSold > TICKETS ? ': real people would be turned away at the door' : ''}`);

  const failedChecks = checks.filter(([, ok]) => !ok).length;
  log('');
  log(failedChecks ? `${failedChecks} check(s) failed.` : 'All checks passed.');

  const out = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../docs/load-test-results.md');
  fs.mkdirSync(path.dirname(out), { recursive: true });
  fs.writeFileSync(out, `${report.join('\n')}\n\n_Run on ${new Date().toISOString().slice(0, 10)} with \`npm run load-test -- ${BUYERS} ${TICKETS}\`._\n`);
  console.log(`\nResults saved to docs/load-test-results.md`);
  process.exitCode = failedChecks ? 1 : 0;
} finally {
  if (eventId) {
    await query('DELETE FROM orders WHERE event_id = ?', [eventId]);
    await query('DELETE FROM events WHERE id = ?', [eventId]);
  }
  await query('DELETE FROM users WHERE email LIKE ?', [`loadtest-${stamp}-%`]);
  server.close();
  await pool.end();
}
