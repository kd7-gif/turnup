import { query } from '../db.js';
import { HttpError } from '../utils/http.js';

/**
 * What the user may do for an event's host: 'owner', 'cohost', 'door', or null.
 * Admins count as owners everywhere.
 */
export async function roleForEvent(user, eventId) {
  if (!user) return null;
  if (user.role === 'admin') return 'owner';
  const [row] = await query(
    `SELECT CASE WHEN h.owner_id = ? THEN 'owner' ELSE s.role END AS role
     FROM events e JOIN hosts h ON h.id = e.host_id
     LEFT JOIN host_staff s ON s.host_id = h.id AND s.user_id = ?
     WHERE e.id = ?`,
    [user.id, user.id, eventId]
  );
  return row?.role || null;
}

/** Loads an event by slug and makes sure the user is allowed to work it (any of `roles`). */
export async function eventForStaff(user, slug, roles = ['owner', 'cohost', 'door']) {
  const [event] = await query(
    'SELECT id, host_id, title, slug, venue, area, city, starts_at, ends_at, image_url, status FROM events WHERE slug = ?',
    [String(slug || '').slice(0, 160)]
  );
  // Same answer for "no such event" and "not yours", so staff cannot discover other hosts' events
  const role = event && (await roleForEvent(user, event.id));
  if (!event || !roles.includes(role)) throw new HttpError(404, 'We could not find that event in your list.');
  return { event, role };
}
