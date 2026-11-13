// Simulates the doors opening, so you can watch the live check-in dashboard update on its own.
//   npm run simulate-door                                   (Neon Nights: 20 already in, 20 more over about a minute)
//   npm run simulate-door -- sunset-rooftop-sessions 60 90  (event, guests, seconds)
//
// Needs the API running (npm run dev). It scans real tickets through the real API, as a door person would,
// including the odd ticket shown twice and a fake code, so the refusal counts move too.
import jwt from 'jsonwebtoken';
import { config } from '../src/config.js';
import { pool, query } from '../src/db.js';

const slug = process.argv[2] || 'neon-nights-amapiano-edition';
const guests = Number(process.argv[3]) || 40;
const seconds = Number(process.argv[4]) || 60;
const base = `http://127.0.0.1:${config.port}`;

try {
  const [event] = await query('SELECT e.id, e.title, h.owner_id FROM events e JOIN hosts h ON h.id = e.host_id WHERE e.slug = ?', [slug]);
  if (!event) throw new Error(`No event called "${slug}". Try neon-nights-amapiano-edition.`);
  // Door staff for this host if there are any, otherwise the owner
  const staff = (await query('SELECT s.user_id AS id FROM host_staff s JOIN events e ON e.host_id = s.host_id WHERE e.id = ?', [event.id]));
  const doors = (staff.length ? staff : [{ id: event.owner_id }]).map(({ id }) => `turnup_session=${jwt.sign({ sub: id, role: 'guest' }, config.jwtSecret, { expiresIn: '1h' })}`);
  const tickets = (await query("SELECT code FROM tickets WHERE event_id = ? AND status = 'valid' ORDER BY RAND() LIMIT ?", [event.id, guests])).map((t) => t.code);
  if (!tickets.length) throw new Error('Everyone with a ticket is already checked in. Undo some check-ins or pick another event.');

  // Guests who arrived earlier in the night, spread over the last 90 minutes, so the arrivals chart has a shape.
  // The rest arrive live, one by one, while you watch.
  const earlier = Math.floor(tickets.length / 2);
  const [door0] = (staff.length ? staff : [{ id: event.owner_id }]);
  for (const [i, code] of tickets.slice(0, earlier).entries()) {
    const minsAgo = 90 - Math.round(90 * Math.sqrt((i + 1) / earlier)); // busier as the night goes on
    await query(`UPDATE tickets SET status = 'used', checked_in_at = UTC_TIMESTAMP() - INTERVAL ? MINUTE, checked_in_by = ? WHERE code = ? AND status = 'valid'`,
      [minsAgo, door0.id, code]);
    await query(`INSERT INTO checkins (event_id, ticket_id, staff_id, result, admits, created_at)
                 SELECT event_id, id, ?, 'admitted', admits, UTC_TIMESTAMP() - INTERVAL ? MINUTE FROM tickets WHERE code = ?`, [door0.id, minsAgo, code]);
  }
  tickets.splice(0, earlier);

  await fetch(`${base}/api/health`).catch(() => { throw new Error(`The API is not running on ${base}. Start it with npm run dev first.`); });
  console.log(`Doors are open at ${event.title}: ${earlier} guests already in, ${tickets.length} more arriving over about ${seconds} seconds.`);
  console.log('Watch it on Host > the event > Live check-in.\n');

  const scan = async (code, door) => {
    const res = await fetch(`${base}/api/checkin/${slug}/scan`, {
      method: 'POST', headers: { 'Content-Type': 'application/json', Origin: config.clientOrigins[0], Cookie: door }, body: JSON.stringify({ code }),
    });
    return res.json();
  };
  const tally = { admitted: 0, already_used: 0, invalid: 0, wrong_event: 0 };
  for (const [i, code] of tickets.entries()) {
    // Arrivals bunch up in the middle, like a real door
    const progress = i / tickets.length;
    const gap = (seconds * 1000 / tickets.length) * (0.4 + 1.2 * Math.abs(progress - 0.5) * 2);
    await new Promise((r) => setTimeout(r, gap));
    const door = doors[i % doors.length];
    const r = await scan(code, door);
    tally[r.result] = (tally[r.result] || 0) + 1;
    process.stdout.write(`\r${r.counts?.checked_in ?? '?'} of ${r.counts?.expected ?? '?'} in   `);
    if (i % 12 === 5) tally[(await scan(code, door)).result]++; // someone tries a screenshot again
    if (i % 25 === 20) tally[(await scan('FAKE0000FAKE0000', door)).result]++;
  }
  console.log(`\n\nDone: ${tally.admitted} admitted, ${tally.already_used} already used, ${tally.invalid} fake codes refused.`);
} catch (err) {
  console.error(err.message);
  process.exitCode = 1;
} finally {
  await pool.end();
}
