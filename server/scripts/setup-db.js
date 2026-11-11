// Creates the tables and loads sample hosts, events and accounts.
//   npm run db:setup   -> safe to re-run, never deletes your data; moves sample events back into the coming weeks
//   npm run db:reset   -> drops every table first (development only)
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import bcrypt from 'bcryptjs';
import mysql from 'mysql2/promise';
import { config } from '../src/config.js';
import { DEMO_ACCOUNTS, HOSTS, EVENTS, SAMPLE_GUESTS } from './seed-data.js';

const here = path.dirname(fileURLToPath(import.meta.url));
const schema = fs.readFileSync(path.resolve(here, '../../database/schema.sql'), 'utf8');
const fresh = process.argv.includes('--fresh');
const password = process.env.SEED_PASSWORD || 'turnup123';

export const slugify = (s) => s.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase()
  .replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
const photo = (id) => `/img/events/${id}.webp`;

// Lagos is UTC+1 all year. Returns a UTC Date for `days` from today at `hour` Lagos time.
function lagosTime(days, hour, minute = 0) {
  const lagosNow = new Date(Date.now() + 3600000);
  return new Date(Date.UTC(lagosNow.getUTCFullYear(), lagosNow.getUTCMonth(), lagosNow.getUTCDate() + days, hour - 1, minute));
}

// Small seeded random number generator, so every machine gets the same sample data
function rng(seed) {
  let a = seed;
  return () => {
    a |= 0; a = (a + 0x6d2b79f5) | 0;
    let x = Math.imul(a ^ (a >>> 15), 1 | a);
    x = (x + Math.imul(x ^ (x >>> 7), 61 | x)) ^ x;
    return ((x ^ (x >>> 14)) >>> 0) / 4294967296;
  };
}

const conn = config.db.uri
  ? await mysql.createConnection({ uri: config.db.uri, multipleStatements: true, timezone: 'Z' })
  : await mysql.createConnection({ ...config.db, multipleStatements: true, timezone: 'Z',
    ...(config.dbSsl ? { ssl: { rejectUnauthorized: true } } : {}) });
const q = async (sql, params) => (await conn.query(sql, params))[0];

try {
  if (fresh) {
    console.log('Dropping all tables...');
    await q(`SET FOREIGN_KEY_CHECKS = 0;
      DROP TABLE IF EXISTS attendees, friendships, host_follows, saved_events, ticket_tiers, events, hosts, users;
      SET FOREIGN_KEY_CHECKS = 1;`);
  }
  await q(schema);
  console.log('Tables ready.');

  const hash = await bcrypt.hash(password, 12);
  await conn.beginTransaction();

  const addUser = async ({ full_name, email, phone = '08000000100', city = 'Lagos' }, role) => {
    await q(`INSERT INTO users (full_name, email, phone, password_hash, role, city) VALUES (?,?,?,?,?,?)
             ON DUPLICATE KEY UPDATE id = LAST_INSERT_ID(id)`, [full_name, email, phone, hash, role, city]);
    return (await q('SELECT LAST_INSERT_ID() AS id'))[0].id;
  };

  const guestId = await addUser(DEMO_ACCOUNTS.guest, 'guest');
  const hostUserId = await addUser(DEMO_ACCOUNTS.host, 'host');
  await addUser(DEMO_ACCOUNTS.admin, 'admin');

  const guests = [];
  for (const g of SAMPLE_GUESTS) guests.push({ id: await addUser(g, 'guest'), city: g.city });

  // Hosts
  const hostIds = {};
  for (const [i, h] of HOSTS.entries()) {
    const ownerId = i === 0 ? hostUserId : await addUser({ full_name: h.owner, email: `${h.slug}@turnup.demo` }, 'host');
    await q(`INSERT INTO hosts (owner_id, name, slug, bio, image_url, verified) VALUES (?,?,?,?,?,?)
             ON DUPLICATE KEY UPDATE name = VALUES(name), bio = VALUES(bio), image_url = VALUES(image_url),
               verified = VALUES(verified), id = LAST_INSERT_ID(id)`,
      [ownerId, h.name, h.slug, h.bio, photo(h.image), h.verified]);
    hostIds[h.slug] = (await q('SELECT LAST_INSERT_ID() AS id'))[0].id;
  }

  // Events: new ones get their ticket types and people going; existing ones just get fresh dates
  const rand = rng(20261111);
  let added = 0;
  for (const e of EVENTS) {
    const slug = slugify(e.title);
    const starts = lagosTime(e.days, e.hour);
    const ends = new Date(starts.getTime() + e.hours * 3600000);
    const [existing] = await q('SELECT id FROM events WHERE slug = ?', [slug]);
    if (existing) {
      await q('UPDATE events SET starts_at = ?, ends_at = ?, image_url = ? WHERE id = ?', [starts, ends, photo(e.photo), existing.id]);
      for (const [pos, tier] of e.tiers.entries()) {
        if (tier.earlyBirdEnds != null) {
          await q('UPDATE ticket_tiers SET sales_end = ? WHERE event_id = ? AND position = ?', [lagosTime(tier.earlyBirdEnds, 23, 59), existing.id, pos]);
        }
      }
      continue;
    }

    const res = await q(`INSERT INTO events (host_id, title, slug, category, summary, description, venue, area, city, starts_at, ends_at, image_url)
      VALUES (?,?,?,?,?,?,?,?,?,?,?,?)`,
      [hostIds[e.host], e.title, slug, e.category, e.summary, e.description, e.venue, e.area, e.city, starts, ends, photo(e.photo)]);
    const eventId = res.insertId;

    // People going: mostly guests from the same city, more for bigger events
    const capacity = e.tiers.reduce((n, tier) => n + tier.quantity, 0);
    const want = Math.min(Math.round(12 + rand() * 30 + Math.log10(capacity) * 10), 70);
    const local = guests.filter((g) => g.city === e.city);
    const others = guests.filter((g) => g.city !== e.city);
    const going = new Set();
    while (going.size < want) {
      const from = rand() < 0.85 && local.length ? local : others;
      going.add(from[Math.floor(rand() * from.length)].id);
    }
    for (const uid of going) await q('INSERT IGNORE INTO attendees (event_id, user_id) VALUES (?, ?)', [eventId, uid]);

    // Spread those people across the ticket types (cheapest tiers sell most)
    const sold = e.tiers.map(() => 0);
    for (let n = 0; n < going.size; n++) {
      const i = rand() < 0.7 ? 0 : Math.min(e.tiers.length - 1, 1 + Math.floor(rand() * (e.tiers.length - 1)));
      if (sold[i] < e.tiers[i].quantity) sold[i]++;
    }
    for (const [pos, tier] of e.tiers.entries()) {
      await q(`INSERT INTO ticket_tiers (event_id, name, description, price, quantity, sold, max_per_order, sales_end, position)
               VALUES (?,?,?,?,?,?,?,?,?)`,
        [eventId, tier.name, tier.description, tier.price, tier.quantity, sold[pos], tier.price >= 100000 ? 2 : 10,
          tier.earlyBirdEnds != null ? lagosTime(tier.earlyBirdEnds, 23, 59) : null, pos]);
    }
    added++;
  }
  console.log(added ? `${added} sample events added.` : 'Sample events already present (dates refreshed).');

  // The demo guest's friends, so "friends going" shows real faces
  for (const g of guests.slice(0, 18)) {
    await q('INSERT IGNORE INTO friendships (user_id, friend_id) VALUES (?, ?), (?, ?)', [guestId, g.id, g.id, guestId]);
  }
  // Sample guests follow hosts, so follower counts look like a real community
  const followRand = rng(7);
  for (const g of guests) {
    for (const h of Object.values(hostIds)) if (followRand() < 0.3) await q('INSERT IGNORE INTO host_follows (user_id, host_id) VALUES (?, ?)', [g.id, h]);
  }
  for (const slug of ['afterdark-collective', 'eat-drink-lagos', 'punchline-lagos']) {
    await q('INSERT IGNORE INTO host_follows (user_id, host_id) VALUES (?, ?)', [guestId, hostIds[slug]]);
  }

  await conn.commit();
  console.log(`Demo accounts (password "${password}"):`);
  console.log(`  guest   ${DEMO_ACCOUNTS.guest.email}`);
  console.log(`  host    ${DEMO_ACCOUNTS.host.email}  (Afterdark Collective)`);
  console.log('Done.');
} catch (err) {
  await conn.rollback().catch(() => {});
  throw err;
} finally {
  await conn.end();
}
