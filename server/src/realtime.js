import { Server } from 'socket.io';
import * as cookie from 'cookie';
import jwt from 'jsonwebtoken';
import { config } from './config.js';
import { query } from './db.js';
import { SESSION_COOKIE } from './middleware/auth.js';

// Live updates over WebSockets (Socket.IO).
// Each signed-in browser joins rooms for what it is allowed to see:
//   host:<id>   owners and co-hosts: sales and check-ins for that host's events
//   door:<id>   door staff: check-ins for that host's events (no sales figures)
// Messages only say *what* changed; pages then refetch through the normal, permission-checked API,
// so nothing private is ever pushed to a browser that should not see it.

let io = null;

export function initRealtime(httpServer) {
  io = new Server(httpServer, { cors: { origin: config.clientOrigins, credentials: true }, serveClient: false });

  // Identify the user from the same httpOnly session cookie the API uses
  io.use((socket, next) => {
    try {
      const token = cookie.parse(socket.handshake.headers.cookie || '')[SESSION_COOKIE];
      const payload = jwt.verify(token, config.jwtSecret);
      socket.data.user = { id: payload.sub, role: payload.role };
      next();
    } catch {
      next(new Error('unauthorised'));
    }
  });

  io.on('connection', async (socket) => {
    const { id, role } = socket.data.user;
    try {
      const rooms = role === 'admin'
        ? (await query('SELECT id FROM hosts')).map((h) => `host:${h.id}`)
        : [
          ...(await query('SELECT id FROM hosts WHERE owner_id = ?', [id])).map((h) => `host:${h.id}`),
          ...(await query('SELECT host_id, role FROM host_staff WHERE user_id = ?', [id]))
            .map((s) => (s.role === 'cohost' ? `host:${s.host_id}` : `door:${s.host_id}`)),
        ];
      socket.join([`user:${id}`, ...rooms]);
      socket.emit('ready');
    } catch {
      socket.disconnect(true);
    }
  });
  return io;
}

/** A guest was admitted (or refused, or a check-in was undone) at an event's door. */
export async function notifyCheckin(eventId) {
  if (!io) return;
  const [e] = await query('SELECT slug, host_id FROM events WHERE id = ?', [eventId]);
  if (e) io.to(`host:${e.host_id}`).to(`door:${e.host_id}`).emit('checkin:changed', { event: e.slug });
}

/** Tickets were sold for an event (for live sales on the host dashboard). */
export async function notifySale(orderId) {
  if (!io) return;
  const [o] = await query('SELECT e.slug, e.host_id, o.user_id FROM orders o JOIN events e ON e.id = o.event_id WHERE o.id = ?', [orderId]);
  if (!o) return;
  io.to(`host:${o.host_id}`).emit('sales:changed', { event: o.slug });
  io.to(`user:${o.user_id}`).emit('order:paid', {});
}
