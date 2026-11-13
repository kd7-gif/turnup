// Undoes every check-in for an event, so you can run the door simulation again.
//   npm run reset-door                          (Neon Nights)
//   npm run reset-door -- sunset-rooftop-sessions
import { pool, query } from '../src/db.js';

const slug = process.argv[2] || 'neon-nights-amapiano-edition';
try {
  const [event] = await query('SELECT id, title FROM events WHERE slug = ?', [slug]);
  if (!event) throw new Error(`No event called "${slug}".`);
  const r = await query("UPDATE tickets SET status = 'valid', checked_in_at = NULL, checked_in_by = NULL WHERE event_id = ? AND status = 'used'", [event.id]);
  await query('DELETE FROM checkins WHERE event_id = ?', [event.id]);
  console.log(`${event.title}: ${r.affectedRows} check-ins cleared.`);
} catch (err) {
  console.error(err.message);
  process.exitCode = 1;
} finally {
  await pool.end();
}
