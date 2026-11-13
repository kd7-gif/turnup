// The browser-only version of the Turnup API, used by the hosted demo (VITE_DEMO=true).
// It answers the same requests as the Express server with the same rules: prices worked out here, tickets held
// for 10 minutes and never oversold, single-use QR tickets, and the same host permissions. The sample data comes
// from snapshot.json; anything a visitor does is kept in their own browser. Each tab has its own sign-in, so a
// guest, a host and a door person can sit side by side in three tabs and update each other live.
import snapshot from './snapshot.json';
import { ApiError } from '../api/client.js';

const STATE_KEY = 'turnup.demo.v1';
const SESSION_KEY = 'turnup.demo.user';
const PASSWORD = 'turnup123';
const MIN = 60000;
const HOLD_MINUTES = 10;
const LAGOS_MS = 3600000;
const CATEGORIES = ['Music', 'Parties', 'Food and drink', 'Comedy', 'Art and culture', 'Tech and business', 'Fitness', 'Games and hangouts'];
const CITIES = ['Lagos', 'Abuja', 'Ibadan'];

// ---------- State: the sample database, then whatever the visitor changes ----------

function build() {
  // Snapshot times are "days from today * 1440 + minutes past midnight in Lagos"
  const today = Math.floor((Date.now() + LAGOS_MS) / 86400000);
  const at = (v) => {
    if (v == null) return null;
    const days = Math.floor(v / 1440);
    return new Date((today + days) * 86400000 + (v - days * 1440) * MIN - LAGOS_MS).toISOString();
  };
  const S = snapshot;
  return {
    users: S.users.map(([id, full_name, email, phone, role, city]) => ({ id, full_name, email, phone, role, city })),
    hosts: S.hosts.map(([id, owner_id, name, slug, bio, image_url, verified]) => ({ id, owner_id, name, slug, bio, image_url, verified: Boolean(verified) })),
    events: S.events.map(([id, host_id, title, slug, category, summary, description, venue, area, city, s, e, image_url, status]) => ({
      id, host_id, title, slug, category, summary, description, venue, area, city, starts_at: at(s), ends_at: at(e), image_url, status })),
    tiers: S.tiers.map(([id, event_id, name, description, price, quantity, sold, max_per_order, admits, salesEnd, position]) => ({
      id, event_id, name, description, price, quantity, sold, held: 0, max_per_order, admits, sales_end: at(salesEnd), position })),
    orders: S.orders.map(([id, order_number, user_id, event_id, subtotal, discount, fee, total, promo_code_id, paid]) => ({
      id, order_number, user_id, event_id, status: 'paid', subtotal, discount, fee, total, promo_code_id, paid_at: at(paid), created_at: at(paid), expires_at: null, failure: null })),
    items: S.items.map(([order_id, tier_id, name, price, quantity, admits]) => ({ order_id, tier_id, name, price, quantity, admits })),
    tickets: S.tickets.map(([id, order_id, event_id, tier_id, user_id, code, admits]) => ({
      id, order_id, event_id, tier_id, user_id, code, admits, status: 'valid', checked_in_at: null, checked_in_by: null })),
    promos: S.promos.map(([id, host_id, event_id, code, kind, value, max_uses, used, expires, active]) => ({
      id, host_id, event_id, code, kind, value, max_uses, used, expires_at: at(expires), active: Boolean(active) })),
    staff: S.staff.map(([host_id, user_id, role]) => ({ host_id, user_id, role })),
    saved: S.saved.map(([user_id, event_id]) => ({ user_id, event_id })),
    follows: S.follows.map(([user_id, host_id]) => ({ user_id, host_id })),
    friends: S.friends.map(([user_id, friend_id]) => ({ user_id, friend_id })),
    attendees: S.attendees.map(([event_id, user_id]) => ({ event_id, user_id })),
    checkins: [],
    seq: 1_000_000,
  };
}

let memory = null; // used when the browser blocks storage (private windows, for example)
function load() {
  try {
    const saved = JSON.parse(localStorage.getItem(STATE_KEY));
    if (saved) return saved;
  } catch { /* fall through */ }
  if (!memory) memory = build();
  return memory;
}
function save(s) {
  memory = s;
  try { localStorage.setItem(STATE_KEY, JSON.stringify(s)); } catch { /* kept in memory for this visit */ }
}
const nextId = (s) => ++s.seq;

let tabUser = null;
const getSession = () => { try { return Number(sessionStorage.getItem(SESSION_KEY)) || null; } catch { return tabUser; } };
const setSession = (id) => {
  tabUser = id;
  try { id ? sessionStorage.setItem(SESSION_KEY, String(id)) : sessionStorage.removeItem(SESSION_KEY); } catch { /* memory only */ }
};

// ---------- Live updates between tabs (stands in for Socket.IO) ----------

const listeners = new Map();
let channel = null;
try { channel = new BroadcastChannel('turnup-demo'); } catch { /* this tab only */ }
const deliver = (event, data) => (listeners.get(event) || []).forEach((fn) => fn(data));
channel?.addEventListener('message', (e) => deliver(e.data.event, e.data.data));
function emit(event, data = {}) {
  deliver(event, data);
  channel?.postMessage({ event, data });
}
export const demoSocket = {
  on(event, fn) { listeners.set(event, [...(listeners.get(event) || []), fn]); },
  off(event, fn) { listeners.set(event, (listeners.get(event) || []).filter((f) => f !== fn)); },
};

// ---------- Helpers ----------

const fail = (status, message, fields) => { throw new ApiError(message, status, fields); };
const clean = (v, max) => (typeof v === 'string' ? v.trim().slice(0, max) : '');
const nowIso = () => new Date().toISOString();
const first = (name) => (name || '').split(' ')[0];
const userById = (s, id) => s.users.find((u) => u.id === id);
const hostById = (s, id) => s.hosts.find((h) => h.id === id);
const eventBySlug = (s, slug) => s.events.find((e) => e.slug === slug);
const tiersOf = (s, eventId) => s.tiers.filter((t) => t.event_id === eventId).sort((a, b) => a.position - b.position || a.id - b.id);
const isEmail = (v) => /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(v);
const ALPHABET = '23456789ABCDEFGHJKLMNPQRSTUVWXYZ';
const randomCode = (n) => [...crypto.getRandomValues(new Uint8Array(n))].map((b) => ALPHABET[b % ALPHABET.length]).join('');
const slugify = (t) => String(t).normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
export const bookingFee = (amount) => (amount <= 0 ? 0 : Math.min(Math.round(amount * 0.025) + 100, 3000));

async function hash(text) {
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(`turnup-demo:${text}`));
  return [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, '0')).join('');
}

function fromLagosInput(value) {
  const m = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})$/.exec(String(value || ''));
  if (!m) return null;
  const [, y, mo, d, h, mi] = m.map(Number);
  const date = new Date(Date.UTC(y, mo - 1, d, h, mi) - LAGOS_MS);
  return Number.isNaN(date.getTime()) || new Date(date.getTime() + LAGOS_MS).getUTCDate() !== d ? null : date.toISOString();
}

function windowFor(when) {
  const now = new Date();
  const lagos = new Date(now.getTime() + LAGOS_MS);
  const day = (o) => new Date(Date.UTC(lagos.getUTCFullYear(), lagos.getUTCMonth(), lagos.getUTCDate() + o) - LAGOS_MS);
  if (when === 'today') return [now, day(1)];
  if (when === 'week') return [now, day(7)];
  if (when === 'month') return [now, day(30)];
  if (when === 'weekend') {
    const dow = lagos.getUTCDay();
    const toFriday = dow === 0 ? -2 : 5 - dow;
    const start = new Date(day(toFriday).getTime() + 17 * 3600000);
    return [start < now ? now : start, day(dow === 0 ? 1 : toFriday + 3)];
  }
  return [now, null];
}

// ---------- Holds (same rules as the server) ----------

function releaseHold(s, o) {
  for (const it of s.items.filter((i) => i.order_id === o.id)) {
    const t = s.tiers.find((x) => x.id === it.tier_id);
    if (t) t.held = Math.max(0, t.held - it.quantity);
  }
  const p = o.promo_code_id && s.promos.find((x) => x.id === o.promo_code_id);
  if (p && p.used > 0) p.used--;
}

function releaseExpired(s) {
  const now = nowIso();
  let n = 0;
  for (const o of s.orders) {
    if (o.status === 'pending' && o.expires_at <= now) { releaseHold(s, o); o.status = 'expired'; n++; }
  }
  return n;
}

function confirmOrder(s, o) {
  if (!['pending', 'expired'].includes(o.status)) return o.status;
  const items = s.items.filter((i) => i.order_id === o.id);
  if (o.status === 'expired') {
    const short = items.find((it) => { const t = s.tiers.find((x) => x.id === it.tier_id); return t.sold + t.held + it.quantity > t.quantity; });
    if (short) {
      o.status = 'failed';
      o.failure = `${short.name} sold out after your 10-minute hold ended. You have not been given tickets and will be refunded.`;
      return 'failed';
    }
    items.forEach((it) => { s.tiers.find((x) => x.id === it.tier_id).sold += it.quantity; });
    const p = o.promo_code_id && s.promos.find((x) => x.id === o.promo_code_id);
    if (p) p.used++;
  } else {
    items.forEach((it) => { const t = s.tiers.find((x) => x.id === it.tier_id); t.held -= it.quantity; t.sold += it.quantity; });
  }
  for (const it of items) {
    for (let i = 0; i < it.quantity; i++) {
      s.tickets.push({ id: nextId(s), order_id: o.id, event_id: o.event_id, tier_id: it.tier_id, user_id: o.user_id, code: randomCode(16), admits: it.admits, status: 'valid', checked_in_at: null, checked_in_by: null });
    }
  }
  if (!s.attendees.some((a) => a.event_id === o.event_id && a.user_id === o.user_id)) s.attendees.push({ event_id: o.event_id, user_id: o.user_id });
  o.status = 'paid';
  o.paid_at = nowIso();
  emit('sales:changed', { event: s.events.find((e) => e.id === o.event_id).slug });
  return 'paid';
}

// ---------- Views ----------

function me(s) {
  const id = getSession();
  const u = id && userById(s, id);
  if (!u) return null;
  const user = { id: u.id, full_name: u.full_name, email: u.email, phone: u.phone, role: u.role, city: u.city };
  const owned = s.hosts.filter((h) => h.owner_id === u.id);
  if (u.role === 'host') user.hosts = owned.map(({ id: hid, name, slug }) => ({ id: hid, name, slug }));
  const staff = s.staff.filter((x) => x.user_id === u.id);
  user.can_check_in = u.role === 'admin' || owned.length > 0 || staff.length > 0;
  user.can_host = u.role === 'admin' || owned.length > 0 || staff.some((x) => x.role === 'cohost');
  return user;
}
function requireUser(s) {
  const u = me(s);
  if (!u) fail(401, 'Log in to continue.');
  return u;
}

function card(s, e, userId) {
  const h = hostById(s, e.host_id);
  const tiers = tiersOf(s, e.id);
  const now = nowIso();
  const onSale = tiers.filter((t) => t.sold + t.held < t.quantity && (!t.sales_end || t.sales_end > now));
  const left = tiers.reduce((n, t) => n + t.quantity - t.sold - t.held, 0);
  const friendIds = userId ? new Set(s.friends.filter((f) => f.user_id === userId).map((f) => f.friend_id)) : new Set();
  const going = s.attendees.filter((a) => a.event_id === e.id);
  const friends = going.filter((a) => friendIds.has(a.user_id)).map((a) => userById(s, a.user_id)?.full_name).filter(Boolean);
  return {
    id: e.id, title: e.title, slug: e.slug, category: e.category, summary: e.summary, venue: e.venue, area: e.area, city: e.city,
    starts_at: e.starts_at, ends_at: e.ends_at, image_url: e.image_url, host_name: h.name, host_slug: h.slug, host_verified: h.verified,
    from_price: onSale.length ? Math.min(...onSale.map((t) => t.price)) : null, max_price: Math.max(0, ...tiers.map((t) => t.price)),
    tickets_left: left, going_count: going.length, is_free: tiers.every((t) => t.price === 0), sold_out: left === 0,
    friends_going: friends.slice(0, 3).map(first), friends_count: friends.length,
    saved: Boolean(userId && s.saved.some((x) => x.user_id === userId && x.event_id === e.id)),
  };
}

function roleFor(s, user, event) {
  if (!user) return null;
  if (user.role === 'admin') return 'owner';
  const h = hostById(s, event.host_id);
  if (h.owner_id === user.id) return 'owner';
  return s.staff.find((x) => x.host_id === h.id && x.user_id === user.id)?.role || null;
}
function eventForStaff(s, user, slug, roles = ['owner', 'cohost', 'door']) {
  const e = eventBySlug(s, slug);
  if (!e || !roles.includes(roleFor(s, user, e))) fail(404, 'We could not find that event in your list.');
  return e;
}
function myHosts(s, user) {
  if (user.role === 'admin') return s.hosts.map((h) => ({ ...h, role: 'owner' }));
  return [
    ...s.hosts.filter((h) => h.owner_id === user.id).map((h) => ({ ...h, role: 'owner' })),
    ...s.staff.filter((x) => x.user_id === user.id && x.role === 'cohost').map((x) => ({ ...hostById(s, x.host_id), role: 'cohost' })),
  ].sort((a, b) => a.name.localeCompare(b.name));
}
function hostFor(s, user, slug, roles = ['owner', 'cohost']) {
  const h = myHosts(s, user).find((x) => x.slug === slug);
  if (!h || !roles.includes(h.role)) fail(404, 'We could not find that host in your account.');
  return h;
}

function loadOrder(s, o) {
  const e = s.events.find((x) => x.id === o.event_id);
  return {
    order_number: o.order_number, status: o.status, failure: o.failure, subtotal: o.subtotal, discount: o.discount, fee: o.fee, total: o.total,
    promo_code: o.promo_code_id ? s.promos.find((p) => p.id === o.promo_code_id)?.code : null,
    paid_at: o.paid_at, created_at: o.created_at, expires_at: o.status === 'pending' ? o.expires_at : null, server_time: nowIso(),
    event: { title: e.title, slug: e.slug, venue: e.venue, area: e.area, city: e.city, starts_at: e.starts_at, ends_at: e.ends_at, image_url: e.image_url, host_name: hostById(s, e.host_id).name },
    items: s.items.filter((i) => i.order_id === o.id).map(({ tier_id, name, price, quantity, admits }) => ({ tier_id, name, price, quantity, admits })),
    tickets: s.tickets.filter((t) => t.order_id === o.id).map((t) => ({ code: t.code, admits: t.admits, status: t.status, checked_in_at: t.checked_in_at,
      tier_name: s.tiers.find((x) => x.id === t.tier_id)?.name })),
  };
}

function priceOrder(s, { slug, items, promoCode }) {
  const e = eventBySlug(s, clean(slug, 160));
  if (!e || e.status === 'draft') fail(404, 'We could not find that event.');
  if (e.status === 'cancelled') fail(409, 'This event has been cancelled.');
  if (e.ends_at <= nowIso()) fail(409, 'This event has already ended.');
  if (!Array.isArray(items) || !items.length) fail(422, 'Choose at least one ticket.');
  const wanted = new Map();
  for (const it of items.slice(0, 20)) {
    const id = Number(it?.tier_id); const q = Number(it?.quantity);
    if (!Number.isInteger(id) || id <= 0) fail(422, 'One of the tickets you chose is not valid.');
    if (!Number.isInteger(q) || q < 0 || q > 50) fail(422, 'Choose a quantity between 1 and 50.');
    if (q > 0) wanted.set(id, (wanted.get(id) || 0) + q);
  }
  if (!wanted.size) fail(422, 'Choose at least one ticket.');
  const lines = [...wanted].map(([id, quantity]) => {
    const t = s.tiers.find((x) => x.id === id && x.event_id === e.id);
    if (!t) fail(422, 'Some of those tickets are not for this event. Refresh and try again.');
    if (t.sales_end && t.sales_end <= nowIso()) fail(409, `${t.name} tickets are no longer on sale.`);
    if (quantity > t.max_per_order) fail(422, `You can buy up to ${t.max_per_order} ${t.name} tickets in one order.`);
    const left = t.quantity - t.sold - t.held;
    if (left <= 0) fail(409, `${t.name} is sold out.`);
    if (quantity > left) fail(409, `Only ${left} ${t.name} ${left === 1 ? 'ticket is' : 'tickets are'} left.`);
    return { tier_id: t.id, name: t.name, price: t.price, quantity, admits: t.admits };
  });
  const subtotal = lines.reduce((n, l) => n + l.price * l.quantity, 0);
  let promo = null; let discount = 0;
  const code = clean(promoCode || '', 30).toUpperCase();
  if (code && subtotal > 0) {
    promo = s.promos.find((p) => p.host_id === e.host_id && p.code === code && p.active && (p.event_id == null || p.event_id === e.id));
    if (!promo) fail(422, 'That promo code is not valid for this event.', { promo: 'Not valid for this event.' });
    if (promo.expires_at && promo.expires_at <= nowIso()) fail(422, 'That promo code has expired.', { promo: 'Expired.' });
    if (promo.max_uses != null && promo.used >= promo.max_uses) fail(422, 'That promo code has been fully used.', { promo: 'Fully used.' });
    discount = promo.kind === 'percent' ? Math.round((subtotal * promo.value) / 100) : Math.min(promo.value, subtotal);
  }
  const fee = bookingFee(subtotal - discount);
  return { event: e, lines, subtotal, discount, fee, total: subtotal - discount + fee, promo,
    ticket_count: lines.reduce((n, l) => n + l.quantity, 0), people: lines.reduce((n, l) => n + l.quantity * l.admits, 0) };
}

function doorCounts(s, eventId) {
  const t = s.tickets.filter((x) => x.event_id === eventId && x.status !== 'cancelled');
  return { expected: t.reduce((n, x) => n + x.admits, 0), checked_in: t.filter((x) => x.status === 'used').reduce((n, x) => n + x.admits, 0), tickets: t.length };
}

function eventStats(s, e) {
  const tiers = tiersOf(s, e.id);
  const paid = s.orders.filter((o) => o.event_id === e.id && o.status === 'paid');
  return {
    sold: tiers.reduce((n, t) => n + t.sold, 0), held: tiers.reduce((n, t) => n + t.held, 0), capacity: tiers.reduce((n, t) => n + t.quantity, 0),
    revenue: paid.reduce((n, o) => n + o.subtotal - o.discount, 0), checked_in: doorCounts(s, e.id).checked_in,
  };
}

// ---------- Routes ----------

const routes = [];
const route = (method, pattern, handler) => routes.push({ method, pattern, handler });

// Accounts
route('POST', /^\/auth\/register$/, async (s, { body }) => {
  const full_name = clean(body.full_name, 120); const email = clean(body.email, 190).toLowerCase(); const phone = clean(body.phone, 30);
  const password = typeof body.password === 'string' ? body.password : '';
  const fields = {};
  if (full_name.length < 2) fields.full_name = 'Enter your full name.';
  if (!isEmail(email)) fields.email = 'Enter a valid email address.';
  if (!/^\+?[0-9 ]{10,15}$/.test(phone)) fields.phone = 'Enter a valid phone number.';
  if (password.length < 8) fields.password = 'Use at least 8 characters.';
  if (Object.keys(fields).length) fail(422, 'Check the highlighted fields.', fields);
  if (s.users.some((u) => u.email === email)) fail(409, 'That email already has an account. Log in instead.', { email: 'Already registered.' });
  const user = { id: nextId(s), full_name, email, phone, role: 'guest', city: CITIES.includes(body.city) ? body.city : 'Lagos', password_hash: await hash(password) };
  s.users.push(user);
  setSession(user.id);
  return { user: me(s) };
});
route('POST', /^\/auth\/login$/, async (s, { body }) => {
  const u = s.users.find((x) => x.email === clean(body.email, 190).toLowerCase());
  const pw = typeof body.password === 'string' ? body.password : '';
  if (!u || !(u.password_hash ? u.password_hash === (await hash(pw)) : pw === PASSWORD)) fail(401, 'That email and password do not match.');
  setSession(u.id);
  return { user: me(s) };
});
route('POST', /^\/auth\/logout$/, () => { setSession(null); return { ok: true }; });
route('GET', /^\/auth\/me$/, (s) => ({ user: me(s) }));
route('POST', /^\/demo\/switch$/, (s, { body }) => {
  const email = { host: 'host@turnup.demo', door: 'door@turnup.demo' }[body.role] || 'guest@turnup.demo';
  setSession(s.users.find((u) => u.email === email).id);
  return { user: me(s) };
});

// Events
route('GET', /^\/events$/, (s, { query: q }) => {
  const u = me(s);
  const city = clean(q.get('city') || '', 60); const category = clean(q.get('category') || '', 40);
  const text = clean(q.get('q') || '', 80).toLowerCase(); const when = q.get('when') || '';
  const [from, to] = when ? windowFor(when) : [new Date(), null];
  const now = nowIso();
  const list = s.events.filter((e) => e.status === 'published' && e.ends_at > now
    && (!city || e.city === city) && (!category || e.category === category)
    && (!text || [e.title, e.summary, e.venue, e.area, hostById(s, e.host_id).name].some((v) => v.toLowerCase().includes(text)))
    && (!when || (e.starts_at < (to || new Date('2100-01-01')).toISOString() && e.ends_at > from.toISOString()))
    && (q.get('free') !== '1' || tiersOf(s, e.id).every((t) => t.price === 0)))
    .sort((a, b) => (a.starts_at < b.starts_at ? -1 : 1)).slice(0, 100);
  return { items: list.map((e) => card(s, e, u?.id)) };
});
route('GET', /^\/events\/filters$/, (s) => {
  const live = s.events.filter((e) => e.status === 'published' && e.ends_at > nowIso());
  const count = (k) => [...live.reduce((m, e) => m.set(e[k], (m.get(e[k]) || 0) + 1), new Map())]
    .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0])).map(([v, n]) => ({ [k]: v, count: n }));
  return { cities: count('city'), categories: count('category') };
});
route('GET', /^\/events\/([^/]+)$/, (s, { params }) => {
  releaseExpired(s);
  const u = me(s);
  const e = eventBySlug(s, params[0]);
  if (!e || (e.status === 'draft' && !['owner', 'cohost'].includes(roleFor(s, u, e)))) fail(404, 'We could not find that event.');
  const h = hostById(s, e.host_id);
  const now = nowIso();
  const going = s.attendees.filter((a) => a.event_id === e.id).slice(-8).reverse();
  return {
    event: { ...card(s, e, u?.id), description: e.description, cancelled: e.status === 'cancelled', draft: e.status === 'draft' },
    host: { id: h.id, name: h.name, slug: h.slug, verified: h.verified, bio: h.bio, image_url: h.image_url,
      followers: s.follows.filter((f) => f.host_id === h.id).length, following: Boolean(u && s.follows.some((f) => f.host_id === h.id && f.user_id === u.id)) },
    tiers: tiersOf(s, e.id).map((t) => ({ id: t.id, name: t.name, description: t.description, price: t.price, remaining: t.quantity - t.sold - t.held,
      in_checkout: t.held, max_per_order: t.max_per_order, admits: t.admits, sales_end: t.sales_end,
      sales_ended: Boolean(t.sales_end && t.sales_end <= now), sold_out: t.quantity - t.sold - t.held <= 0 })),
    going_preview: going.map((a) => first(userById(s, a.user_id)?.full_name)),
  };
});
route('POST', /^\/events\/([^/]+)\/save$/, (s, { params }) => {
  const u = requireUser(s); const e = eventBySlug(s, params[0]);
  if (!e) fail(404, 'We could not find that event.');
  if (!s.saved.some((x) => x.user_id === u.id && x.event_id === e.id)) s.saved.push({ user_id: u.id, event_id: e.id });
  return { saved: true };
});
route('DELETE', /^\/events\/([^/]+)\/save$/, (s, { params }) => {
  const u = requireUser(s); const e = eventBySlug(s, params[0]);
  s.saved = s.saved.filter((x) => !(x.user_id === u.id && x.event_id === e?.id));
  return { saved: false };
});

// Hosts
route('GET', /^\/hosts\/([^/]+)$/, (s, { params }) => {
  const u = me(s); const h = s.hosts.find((x) => x.slug === params[0]);
  if (!h) fail(404, 'We could not find that host.');
  const evs = s.events.filter((e) => e.host_id === h.id && e.status === 'published');
  return {
    host: { id: h.id, name: h.name, slug: h.slug, bio: h.bio, image_url: h.image_url, verified: h.verified,
      followers: s.follows.filter((f) => f.host_id === h.id).length, events_hosted: evs.length,
      following: Boolean(u && s.follows.some((f) => f.host_id === h.id && f.user_id === u.id)) },
    events: evs.filter((e) => e.ends_at > nowIso()).sort((a, b) => (a.starts_at < b.starts_at ? -1 : 1)).map((e) => card(s, e, u?.id)),
  };
});
route('POST', /^\/hosts\/([^/]+)\/follow$/, (s, { params }) => {
  const u = requireUser(s); const h = s.hosts.find((x) => x.slug === params[0]);
  if (!h) fail(404, 'We could not find that host.');
  if (!s.follows.some((f) => f.user_id === u.id && f.host_id === h.id)) s.follows.push({ user_id: u.id, host_id: h.id });
  return { following: true };
});
route('DELETE', /^\/hosts\/([^/]+)\/follow$/, (s, { params }) => {
  const u = requireUser(s); const h = s.hosts.find((x) => x.slug === params[0]);
  s.follows = s.follows.filter((f) => !(f.user_id === u.id && f.host_id === h?.id));
  return { following: false };
});

// Me
route('GET', /^\/me\/saved$/, (s) => {
  const u = requireUser(s);
  const ids = new Set(s.saved.filter((x) => x.user_id === u.id).map((x) => x.event_id));
  return { items: s.events.filter((e) => ids.has(e.id) && e.ends_at > nowIso()).sort((a, b) => (a.starts_at < b.starts_at ? -1 : 1)).map((e) => card(s, e, u.id)) };
});
route('GET', /^\/me\/tickets$/, (s) => {
  const u = requireUser(s);
  const list = s.orders.filter((o) => o.user_id === u.id && o.status === 'paid').map((o) => {
    const e = s.events.find((x) => x.id === o.event_id);
    return { order_number: o.order_number, total: o.total, paid_at: o.paid_at, title: e.title, slug: e.slug, venue: e.venue, area: e.area, city: e.city,
      starts_at: e.starts_at, ends_at: e.ends_at, image_url: e.image_url, host_name: hostById(s, e.host_id).name,
      tickets: s.tickets.filter((t) => t.order_id === o.id).map((t) => ({ code: t.code, admits: t.admits, status: t.status, tier_name: s.tiers.find((x) => x.id === t.tier_id)?.name })) };
  }).sort((a, b) => (a.starts_at < b.starts_at ? -1 : 1));
  const now = nowIso();
  return { upcoming: list.filter((o) => o.ends_at > now), past: list.filter((o) => o.ends_at <= now).reverse() };
});

// Orders
const publicQuote = ({ event, promo, ...q }) => ({ ...q, promo: promo && { code: promo.code, label: promo.kind === 'percent' ? `${promo.value}% off` : `₦${promo.value.toLocaleString('en-NG')} off` } });
route('POST', /^\/orders\/quote$/, (s, { body }) => { releaseExpired(s); return publicQuote(priceOrder(s, { slug: body.event_slug, items: body.items, promoCode: body.promo_code })); });
route('POST', /^\/orders$/, (s, { body }) => {
  const u = requireUser(s);
  releaseExpired(s);
  const q = priceOrder(s, { slug: body.event_slug, items: body.items, promoCode: body.promo_code });
  // Hold the tickets: the same check as the server's single conditional update
  for (const l of q.lines) {
    const t = s.tiers.find((x) => x.id === l.tier_id);
    if (t.sold + t.held + l.quantity > t.quantity) fail(409, `${l.name} just sold out.`);
  }
  if (q.promo) {
    if (q.promo.max_uses != null && q.promo.used >= q.promo.max_uses) fail(422, 'That promo code was just used up.', { promo: 'Fully used.' });
    q.promo.used++;
  }
  q.lines.forEach((l) => { s.tiers.find((x) => x.id === l.tier_id).held += l.quantity; });
  const o = { id: nextId(s), order_number: `TU-${randomCode(6)}`, user_id: u.id, event_id: q.event.id, status: 'pending', subtotal: q.subtotal, discount: q.discount,
    fee: q.fee, total: q.total, promo_code_id: q.promo?.id ?? null, paid_at: null, created_at: nowIso(), expires_at: new Date(Date.now() + HOLD_MINUTES * MIN).toISOString(), failure: null };
  s.orders.push(o);
  q.lines.forEach((l) => s.items.push({ order_id: o.id, ...l }));
  if (q.total === 0) { confirmOrder(s, o); return { order_number: o.order_number, payment: { mode: 'free' } }; }
  return { order_number: o.order_number, payment: { mode: 'simulated' } };
});
const ownOrder = (s, u, number) => {
  const o = s.orders.find((x) => x.order_number === number && x.user_id === u.id);
  if (!o) fail(404, 'We could not find that order.');
  return o;
};
route('GET', /^\/orders\/([^/]+)$/, (s, { params }) => { const u = requireUser(s); releaseExpired(s); return { order: loadOrder(s, ownOrder(s, u, params[0])), payment_mode: 'simulated' }; });
route('POST', /^\/orders\/([^/]+)\/verify-payment$/, (s, { params }) => ({ order: loadOrder(s, ownOrder(s, requireUser(s), params[0])) }));
route('POST', /^\/orders\/([^/]+)\/cancel$/, (s, { params }) => {
  const o = ownOrder(s, requireUser(s), params[0]);
  if (o.status === 'pending') { releaseHold(s, o); o.status = 'cancelled'; }
  return { order: loadOrder(s, o) };
});
route('POST', /^\/orders\/([^/]+)\/simulate-payment$/, (s, { params }) => {
  releaseExpired(s);
  const o = ownOrder(s, requireUser(s), params[0]);
  confirmOrder(s, o);
  return { order: loadOrder(s, o) };
});

// Door
const normaliseCode = (raw) => String(raw || '').toUpperCase().replace(/^TURNUP:/, '').replace(/[^0-9A-Z]/g, '').slice(0, 40);
route('GET', /^\/checkin\/events$/, (s) => {
  const u = requireUser(s);
  const cutoff = new Date(Date.now() - 6 * 3600000).toISOString();
  return { items: s.events.filter((e) => e.status === 'published' && e.ends_at > cutoff && roleFor(s, u, e))
    .sort((a, b) => (a.starts_at < b.starts_at ? -1 : 1)).slice(0, 50)
    .map((e) => ({ id: e.id, title: e.title, slug: e.slug, venue: e.venue, area: e.area, city: e.city, starts_at: e.starts_at, ends_at: e.ends_at,
      image_url: e.image_url, host_name: hostById(s, e.host_id).name, role: roleFor(s, u, e), ...doorCounts(s, e.id) })) };
});
route('GET', /^\/checkin\/([^/]+)$/, (s, { params }) => {
  const u = requireUser(s); const e = eventForStaff(s, u, params[0]);
  return { event: e, role: roleFor(s, u, e), counts: doorCounts(s, e.id), recent: [] };
});
export function scanTicket(s, u, e, raw) {
  const code = normaliseCode(raw);
  const log = (result, ticketId = null, admits = 0) => {
    s.checkins.push({ id: nextId(s), event_id: e.id, ticket_id: ticketId, staff_id: u.id, result, admits, created_at: nowIso() });
    emit('checkin:changed', { event: e.slug });
  };
  const t = code.length >= 8 && s.tickets.find((x) => x.code === code);
  if (!t || t.status === 'cancelled') { log('invalid'); return { result: 'invalid', message: 'This is not a valid Turnup ticket.', counts: doorCounts(s, e.id) }; }
  const guest = { name: userById(s, t.user_id)?.full_name || 'Guest', tier: s.tiers.find((x) => x.id === t.tier_id)?.name, admits: t.admits };
  if (t.event_id !== e.id) {
    log('wrong_event', t.id);
    return { result: 'wrong_event', message: `This ticket is for ${s.events.find((x) => x.id === t.event_id)?.title}.`, guest, counts: doorCounts(s, e.id) };
  }
  if (t.status === 'valid') {
    Object.assign(t, { status: 'used', checked_in_at: nowIso(), checked_in_by: u.id });
    log('admitted', t.id, t.admits);
    return { result: 'admitted', guest, counts: doorCounts(s, e.id) };
  }
  log('already_used', t.id);
  return { result: 'already_used', guest, checked_in_at: t.checked_in_at, checked_in_by: first(userById(s, t.checked_in_by)?.full_name),
    message: 'This ticket has already been used.', counts: doorCounts(s, e.id) };
}
route('POST', /^\/checkin\/([^/]+)\/scan$/, (s, { params, body }) => { const u = requireUser(s); return scanTicket(s, u, eventForStaff(s, u, params[0]), body.code); });
route('POST', /^\/checkin\/([^/]+)\/undo$/, (s, { params, body }) => {
  const u = requireUser(s); const e = eventForStaff(s, u, params[0], ['owner', 'cohost']);
  const t = s.tickets.find((x) => x.code === normaliseCode(body.code) && x.event_id === e.id && x.status === 'used');
  if (!t) fail(404, 'That ticket is not checked in for this event.');
  Object.assign(t, { status: 'valid', checked_in_at: null, checked_in_by: null });
  s.checkins.push({ id: nextId(s), event_id: e.id, ticket_id: t.id, staff_id: u.id, result: 'undone', admits: 0, created_at: nowIso() });
  emit('checkin:changed', { event: e.slug });
  return { ok: true, counts: doorCounts(s, e.id) };
});
route('GET', /^\/checkin\/([^/]+)\/guests$/, (s, { params, query: q }) => {
  const u = requireUser(s); const e = eventForStaff(s, u, params[0]);
  const text = clean(q.get('q') || '', 60).toLowerCase();
  const rows = s.tickets.filter((t) => t.event_id === e.id && t.status !== 'cancelled').map((t) => {
    const o = s.orders.find((x) => x.id === t.order_id);
    return { code: t.code, status: t.status, admits: t.admits, checked_in_at: t.checked_in_at, tier_name: s.tiers.find((x) => x.id === t.tier_id)?.name,
      full_name: userById(s, t.user_id)?.full_name || 'Guest', order_number: o?.order_number || '' };
  }).filter((g) => !text || g.full_name.toLowerCase().includes(text) || g.order_number.toLowerCase().includes(text))
    .sort((a, b) => Number(a.status === 'used') - Number(b.status === 'used') || a.full_name.localeCompare(b.full_name)).slice(0, 60);
  return { items: rows };
});

// Host dashboard
route('GET', /^\/host\/overview$/, (s, { query: q }) => {
  const u = requireUser(s);
  const hosts = myHosts(s, u);
  if (!hosts.length) fail(403, 'You do not run any hosts yet.');
  const host = hosts.find((h) => h.slug === q.get('host')) || hosts[0];
  const now = nowIso();
  const evs = s.events.filter((e) => e.host_id === host.id)
    .sort((a, b) => Number(a.ends_at < now) - Number(b.ends_at < now) || (a.starts_at < b.starts_at ? -1 : 1))
    .map((e) => ({ id: e.id, title: e.title, slug: e.slug, category: e.category, city: e.city, area: e.area, venue: e.venue, starts_at: e.starts_at,
      ends_at: e.ends_at, image_url: e.image_url, status: e.status, ...eventStats(s, e), past: e.ends_at <= now }));
  const ids = new Set(evs.map((e) => e.id));
  const month = new Date(Date.now() - 30 * 86400000).toISOString();
  const paid = s.orders.filter((o) => ids.has(o.event_id) && o.status === 'paid');
  const recent = [...paid].sort((a, b) => (a.paid_at < b.paid_at ? 1 : -1)).slice(0, 8).map((o) => ({
    order_number: o.order_number, amount: o.subtotal - o.discount, paid_at: o.paid_at, title: s.events.find((e) => e.id === o.event_id).title,
    tickets: s.items.filter((i) => i.order_id === o.id).reduce((n, i) => n + i.quantity, 0), buyer: userById(s, o.user_id)?.full_name }));
  return {
    hosts: hosts.map(({ id, name, slug, image_url, role }) => ({ id, name, slug, image_url, role })), host: { id: host.id, name: host.name, slug: host.slug, role: host.role },
    totals: { revenue_30d: paid.filter((o) => o.paid_at > month).reduce((n, o) => n + o.subtotal - o.discount, 0), orders_30d: paid.filter((o) => o.paid_at > month).length,
      followers: s.follows.filter((f) => f.host_id === host.id).length, tickets_sold: evs.reduce((n, e) => n + e.sold, 0),
      upcoming: evs.filter((e) => !e.past && e.status === 'published').length },
    events: evs, recent,
  };
});
route('GET', /^\/host\/options$/, () => ({ categories: CATEGORIES, cities: CITIES, photos: snapshot.photos }));

function readEvent(body, partial) {
  const out = {}; const fields = {};
  const has = (k) => !partial || body[k] !== undefined;
  const text = (k, max, min, msg) => { if (has(k)) { out[k] = clean(body[k], max); if (out[k].length < min) fields[k] = msg; } };
  text('title', 140, 4, 'Give the event a name (at least 4 characters).');
  text('summary', 200, 10, 'Add a one-line summary (at least 10 characters).');
  text('description', 5000, 20, 'Describe the event (at least 20 characters).');
  text('venue', 140, 2, 'Enter the venue.');
  text('area', 80, 2, 'Enter the area, such as Lekki or Wuse 2.');
  if (has('category')) { out.category = body.category; if (!CATEGORIES.includes(out.category)) fields.category = 'Choose a category.'; }
  if (has('city')) { out.city = body.city; if (!CITIES.includes(out.city)) fields.city = 'Choose a city.'; }
  if (has('image_url')) { out.image_url = body.image_url; if (!snapshot.photos.includes(out.image_url)) fields.image_url = 'Choose a cover photo.'; }
  if (has('starts_at')) { out.starts_at = fromLagosInput(body.starts_at); if (!out.starts_at) fields.starts_at = 'Enter a start date and time.'; }
  if (has('ends_at')) { out.ends_at = fromLagosInput(body.ends_at); if (!out.ends_at) fields.ends_at = 'Enter an end date and time.'; }
  return { out, fields };
}
function readTier(t, fields, prefix) {
  const tier = { name: clean(t?.name, 60), description: clean(t?.description, 200), price: Number(t?.price), quantity: Number(t?.quantity),
    max_per_order: Number(t?.max_per_order ?? 10), admits: Number(t?.admits ?? 1), sales_end: t?.sales_end ? fromLagosInput(t.sales_end) : null };
  if (tier.name.length < 2) fields[`${prefix}.name`] = 'Name this ticket type.';
  if (!Number.isInteger(tier.price) || tier.price < 0) fields[`${prefix}.price`] = 'Enter a price in naira (0 for free).';
  else if (tier.price > 0 && tier.price < 100) fields[`${prefix}.price`] = 'Paid tickets must be at least ₦100.';
  if (!Number.isInteger(tier.quantity) || tier.quantity < 1 || tier.quantity > 100000) fields[`${prefix}.quantity`] = 'Enter how many are available (1 to 100,000).';
  if (!Number.isInteger(tier.max_per_order) || tier.max_per_order < 1 || tier.max_per_order > 50) fields[`${prefix}.max_per_order`] = 'Between 1 and 50.';
  if (!Number.isInteger(tier.admits) || tier.admits < 1 || tier.admits > 50) fields[`${prefix}.admits`] = 'Between 1 and 50 people.';
  return tier;
}
function checkTimes(starts, ends, fields, isNew) {
  if (!starts || !ends) return;
  if (ends <= starts) fields.ends_at = 'The event must end after it starts.';
  if (isNew && starts < nowIso()) fields.starts_at = 'Choose a time in the future.';
}

route('POST', /^\/host\/events$/, (s, { body }) => {
  const u = requireUser(s); const host = hostFor(s, u, body.host_slug);
  const { out, fields } = readEvent(body, false);
  checkTimes(out.starts_at, out.ends_at, fields, true);
  const raw = Array.isArray(body.tiers) ? body.tiers.slice(0, 10) : [];
  if (!raw.length) fields.tiers = 'Add at least one ticket type.';
  const tiers = raw.map((t, i) => readTier(t, fields, `tiers.${i}`));
  if (Object.keys(fields).length) fail(422, 'Check the highlighted fields.', fields);
  const baseSlug = slugify(out.title) || 'event';
  let slug = baseSlug;
  for (let n = 2; eventBySlug(s, slug); n++) slug = `${baseSlug}-${n}`;
  const e = { id: nextId(s), host_id: host.id, slug, status: body.publish ? 'published' : 'draft', ...out };
  s.events.push(e);
  tiers.forEach((t, pos) => s.tiers.push({ id: nextId(s), event_id: e.id, sold: 0, held: 0, position: pos, ...t }));
  return { slug, status: e.status };
});
route('GET', /^\/host\/events\/([^/]+)$/, (s, { params }) => {
  const u = requireUser(s); const e = eventForStaff(s, u, params[0], ['owner', 'cohost']);
  const h = hostById(s, e.host_id);
  const paidItems = (tid) => s.items.filter((i) => i.tier_id === tid && s.orders.find((o) => o.id === i.order_id)?.status === 'paid');
  const days = Array.from({ length: 14 }, (_, i) => {
    const d = new Date(Date.now() + LAGOS_MS - (13 - i) * 86400000).toISOString().slice(0, 10);
    const tickets = s.orders.filter((o) => o.event_id === e.id && o.status === 'paid' && new Date(new Date(o.paid_at).getTime() + LAGOS_MS).toISOString().slice(0, 10) === d)
      .reduce((n, o) => n + s.items.filter((x) => x.order_id === o.id).reduce((m, x) => m + x.quantity, 0), 0);
    return { day: d, tickets };
  });
  const orders = s.orders.filter((o) => o.event_id === e.id && ['paid', 'pending'].includes(o.status)).sort((a, b) => (a.created_at < b.created_at ? 1 : -1)).slice(0, 25)
    .map((o) => ({ order_number: o.order_number, status: o.status, amount: o.subtotal - o.discount, paid_at: o.paid_at, created_at: o.created_at,
      buyer: userById(s, o.user_id)?.full_name, items: s.items.filter((i) => i.order_id === o.id).map((i) => `${i.quantity} × ${i.name}`).join(', ') }));
  return {
    event: { ...e, host_name: h.name, host_slug: h.slug, ...eventStats(s, e) }, role: roleFor(s, u, e),
    tiers: tiersOf(s, e.id).map((t) => ({ ...t, gross: paidItems(t.id).reduce((n, i) => n + i.price * i.quantity, 0) })), days, orders,
    promos: s.promos.filter((p) => p.host_id === e.host_id && (p.event_id == null || p.event_id === e.id)).map((p) => ({ ...p, all_events: p.event_id == null })),
  };
});
route('GET', /^\/host\/events\/([^/]+)\/live$/, (s, { params }) => {
  const u = requireUser(s); const e = eventForStaff(s, u, params[0], ['owner', 'cohost']);
  const tickets = s.tickets.filter((t) => t.event_id === e.id && t.status !== 'cancelled');
  const tiers = tiersOf(s, e.id).map((t) => {
    const mine = tickets.filter((k) => k.tier_id === t.id);
    return { name: t.name, admits: t.admits, expected: mine.reduce((n, k) => n + k.admits, 0), checked_in: mine.filter((k) => k.status === 'used').reduce((n, k) => n + k.admits, 0) };
  });
  const arrivals = tickets.filter((t) => t.status === 'used').sort((a, b) => (a.checked_in_at < b.checked_in_at ? -1 : 1));
  const SLOT = 15 * MIN; const now = Date.now();
  const firstAt = arrivals.length ? new Date(arrivals[0].checked_in_at).getTime() : Infinity;
  const lastAt = arrivals.length ? new Date(arrivals.at(-1).checked_in_at).getTime() : 0;
  const end = Math.floor(Math.max(Math.min(now, new Date(e.ends_at).getTime()), lastAt) / SLOT) * SLOT;
  let start = Math.floor(Math.min(new Date(e.starts_at).getTime() - 3600000, firstAt, end - 7 * SLOT) / SLOT) * SLOT;
  start = Math.max(start, end - 47 * SLOT);
  const shown = [];
  for (let t = start; t <= end; t += SLOT) shown.push({ at: new Date(t).toISOString(), admits: 0 });
  for (const a of arrivals) { const i = Math.floor((new Date(a.checked_in_at).getTime() - start) / SLOT); if (i >= 0 && i < shown.length) shown[i].admits += a.admits; }
  const logs = s.checkins.filter((c) => c.event_id === e.id);
  const by = (r) => logs.filter((c) => c.result === r).length;
  const staff = [...logs.filter((c) => c.result !== 'undone').reduce((m, c) => {
    const cur = m.get(c.staff_id) || { name: userById(s, c.staff_id)?.full_name, admitted: 0, scans: 0 };
    cur.scans++; cur.admitted += c.admits; return m.set(c.staff_id, cur);
  }, new Map()).values()].sort((a, b) => b.admitted - a.admitted);
  const expected = tiers.reduce((n, t) => n + t.expected, 0); const checkedIn = tiers.reduce((n, t) => n + t.checked_in, 0);
  return {
    event: { title: e.title, slug: e.slug, starts_at: e.starts_at, ends_at: e.ends_at, venue: e.venue },
    counts: { expected, checked_in: checkedIn, last_15_min: arrivals.filter((a) => now - new Date(a.checked_in_at) < SLOT).reduce((n, a) => n + a.admits, 0),
      peak: shown.reduce((best, x) => (x.admits > (best?.admits || 0) ? x : best), null) },
    tiers, arrivals: shown, refused: { already_used: by('already_used'), wrong_event: by('wrong_event'), invalid: by('invalid') }, staff,
    feed: [...logs].reverse().slice(0, 15).map((c) => {
      const t = c.ticket_id && s.tickets.find((k) => k.id === c.ticket_id);
      return { id: c.id, result: c.result, admits: c.admits, created_at: c.created_at, guest: t ? userById(s, t.user_id)?.full_name : null,
        tier: t ? s.tiers.find((x) => x.id === t.tier_id)?.name : null, staff: first(userById(s, c.staff_id)?.full_name) };
    }),
    server_time: nowIso(),
  };
});
route('PATCH', /^\/host\/events\/([^/]+)$/, (s, { params, body }) => {
  const u = requireUser(s); const e = eventForStaff(s, u, params[0], ['owner', 'cohost']);
  const { out, fields } = readEvent(body, true);
  checkTimes(out.starts_at || e.starts_at, out.ends_at || e.ends_at, fields, false);
  if (body.status !== undefined) {
    if (e.status === 'cancelled') fields.status = 'A cancelled event cannot be changed.';
    else if (body.status === 'draft' && s.orders.some((o) => o.event_id === e.id && ['paid', 'pending'].includes(o.status))) {
      fields.status = 'People already have tickets, so this event cannot go back to being a draft. You can cancel it instead.';
    }
    out.status = body.status;
  }
  if (Object.keys(fields).length) fail(422, fields.status || 'Check the highlighted fields.', fields);
  Object.assign(e, out);
  return { ok: true, status: e.status };
});
route('POST', /^\/host\/events\/([^/]+)\/tiers$/, (s, { params, body }) => {
  const u = requireUser(s); const e = eventForStaff(s, u, params[0], ['owner', 'cohost']);
  const fields = {}; const t = readTier(body, fields, 'tier');
  if (Object.keys(fields).length) fail(422, 'Check the highlighted fields.', fields);
  const id = nextId(s);
  s.tiers.push({ id, event_id: e.id, sold: 0, held: 0, position: tiersOf(s, e.id).length, ...t });
  return { id };
});
route('PATCH', /^\/host\/events\/([^/]+)\/tiers\/(\d+)$/, (s, { params, body }) => {
  const u = requireUser(s); const e = eventForStaff(s, u, params[0], ['owner', 'cohost']);
  const cur = s.tiers.find((t) => t.id === Number(params[1]) && t.event_id === e.id);
  if (!cur) fail(404, 'We could not find that ticket type.');
  const fields = {}; const t = readTier({ ...cur, sales_end: undefined, ...body }, fields, 'tier');
  if (Object.keys(fields).length) fail(422, 'Check the highlighted fields.', fields);
  if (cur.sold + cur.held > t.quantity) fail(409, `You cannot go below ${cur.sold + cur.held}: that many are already sold or being paid for.`, { 'tier.quantity': `At least ${cur.sold + cur.held}.` });
  const { sales_end: salesEnd, ...rest } = t;
  Object.assign(cur, rest, body.sales_end !== undefined ? { sales_end: salesEnd } : {});
  return { ok: true };
});
route('DELETE', /^\/host\/events\/([^/]+)\/tiers\/(\d+)$/, (s, { params }) => {
  const u = requireUser(s); const e = eventForStaff(s, u, params[0], ['owner', 'cohost']);
  const id = Number(params[1]);
  if (s.items.some((i) => i.tier_id === id)) fail(409, 'People have ordered this ticket type, so it cannot be deleted. Set its quantity to what is sold to stop sales instead.');
  if (tiersOf(s, e.id).length <= 1) fail(409, 'An event needs at least one ticket type.');
  s.tiers = s.tiers.filter((t) => !(t.id === id && t.event_id === e.id));
  return { ok: true };
});
route('GET', /^\/host\/([^/]+)\/promos$/, (s, { params }) => {
  const host = hostFor(s, requireUser(s), params[0]);
  return { items: s.promos.filter((p) => p.host_id === host.id).sort((a, b) => b.id - a.id).map((p) => {
    const e = p.event_id && s.events.find((x) => x.id === p.event_id);
    return { ...p, event_title: e?.title || null, event_slug: e?.slug || null };
  }) };
});
route('POST', /^\/host\/([^/]+)\/promos$/, (s, { params, body }) => {
  const host = hostFor(s, requireUser(s), params[0]);
  const fields = {};
  const code = clean(body.code, 30).toUpperCase(); const kind = body.kind === 'amount' ? 'amount' : 'percent'; const value = Number(body.value);
  const maxUses = body.max_uses === '' || body.max_uses == null ? null : Number(body.max_uses);
  if (!/^[A-Z0-9]{3,30}$/.test(code)) fields.code = 'Use 3 to 30 letters and numbers, no spaces.';
  if (!Number.isInteger(value) || value < 1 || (kind === 'percent' && value > 100)) fields.value = kind === 'percent' ? 'Enter a percentage from 1 to 100.' : 'Enter an amount in naira.';
  if (maxUses !== null && (!Number.isInteger(maxUses) || maxUses < 1)) fields.max_uses = 'Leave empty for unlimited, or enter a number.';
  const ev = body.event_slug ? s.events.find((e) => e.slug === body.event_slug && e.host_id === host.id) : null;
  if (body.event_slug && !ev) fields.event_slug = 'Choose one of your events.';
  if (!fields.code && s.promos.some((p) => p.host_id === host.id && p.code === code)) fields.code = 'You already have a code with that name.';
  if (Object.keys(fields).length) fail(422, 'Check the highlighted fields.', fields);
  s.promos.push({ id: nextId(s), host_id: host.id, event_id: ev?.id ?? null, code, kind, value, max_uses: maxUses, used: 0,
    expires_at: body.expires_at ? fromLagosInput(body.expires_at) : null, active: true });
  return { code };
});
route('PATCH', /^\/host\/([^/]+)\/promos\/(\d+)$/, (s, { params, body }) => {
  const host = hostFor(s, requireUser(s), params[0]);
  const p = s.promos.find((x) => x.id === Number(params[1]) && x.host_id === host.id);
  if (!p) fail(404, 'We could not find that code.');
  p.active = Boolean(body.active);
  return { active: p.active };
});
route('GET', /^\/host\/([^/]+)\/team$/, (s, { params }) => {
  const host = hostFor(s, requireUser(s), params[0]);
  return { items: s.staff.filter((x) => x.host_id === host.id).map((x) => { const u = userById(s, x.user_id); return { id: u.id, full_name: u.full_name, email: u.email, role: x.role }; }),
    can_edit: host.role === 'owner' };
});
route('POST', /^\/host\/([^/]+)\/team$/, (s, { params, body }) => {
  const host = hostFor(s, requireUser(s), params[0], ['owner']);
  const email = clean(body.email, 190).toLowerCase(); const role = body.role === 'cohost' ? 'cohost' : 'door';
  if (!isEmail(email)) fail(422, 'Enter their email address.', { email: 'Enter a valid email address.' });
  const u = s.users.find((x) => x.email === email);
  if (!u) fail(404, 'Nobody with that email has a Turnup account yet. Ask them to sign up first.', { email: 'No account with this email.' });
  if (u.id === host.owner_id) fail(422, 'That is the owner’s own account.', { email: 'This is the owner.' });
  const existing = s.staff.find((x) => x.host_id === host.id && x.user_id === u.id);
  if (existing) existing.role = role; else s.staff.push({ host_id: host.id, user_id: u.id, role });
  return { name: u.full_name, role };
});
route('DELETE', /^\/host\/([^/]+)\/team\/(\d+)$/, (s, { params }) => {
  const host = hostFor(s, requireUser(s), params[0], ['owner']);
  s.staff = s.staff.filter((x) => !(x.host_id === host.id && x.user_id === Number(params[1])));
  return { ok: true };
});

// ---------- Entry points ----------

/** Same signature as api() in api/client.js. */
export async function demoApi(path, { method = 'GET', body } = {}) {
  await new Promise((r) => setTimeout(r, 50)); // a little latency, like a real network
  const [pathname, qs = ''] = path.split('?');
  for (const r of routes) {
    const m = r.method === method && pathname.match(r.pattern);
    if (!m) continue;
    const s = load();
    const result = await r.handler(s, { params: m.slice(1).map(decodeURIComponent), query: new URLSearchParams(qs), body: body || {} });
    save(s);
    return JSON.parse(JSON.stringify(result));
  }
  return fail(404, 'Not found.');
}

/** Clears everything this browser has changed in the demo. */
export function resetDemo() {
  memory = null;
  setSession(null);
  try {
    localStorage.removeItem(STATE_KEY);
    Object.keys(sessionStorage).filter((k) => k.startsWith('turnup.picked.')).forEach((k) => sessionStorage.removeItem(k));
  } catch { /* nothing stored */ }
  emit('demo:reset');
}

/**
 * Plays out the doors opening at an event: half the guests arrived earlier in the night, the rest
 * arrive one by one over about a minute, with the odd screenshot shown twice. Calls onProgress after each scan.
 */
export async function simulateDoor(slug, { guests = 40, seconds = 50, onProgress } = {}) {
  let s = load();
  const e = eventBySlug(s, slug);
  const door = s.users.find((u) => u.email === 'door@turnup.demo') || s.users.find((u) => u.id === hostById(s, e.host_id).owner_id);
  const codes = s.tickets.filter((t) => t.event_id === e.id && t.status === 'valid').map((t) => t.code).sort(() => Math.random() - 0.5).slice(0, guests);
  const earlier = Math.floor(codes.length / 2);
  codes.slice(0, earlier).forEach((code, i) => {
    const t = s.tickets.find((x) => x.code === code);
    const at = new Date(Date.now() - (90 - Math.round(90 * Math.sqrt((i + 1) / earlier))) * MIN).toISOString();
    Object.assign(t, { status: 'used', checked_in_at: at, checked_in_by: door.id });
    s.checkins.push({ id: nextId(s), event_id: e.id, ticket_id: t.id, staff_id: door.id, result: 'admitted', admits: t.admits, created_at: at });
  });
  save(s);
  emit('checkin:changed', { event: slug });
  const live = codes.slice(earlier);
  for (const [i, code] of live.entries()) {
    const progress = i / live.length;
    await new Promise((r) => setTimeout(r, (seconds * 1000 / live.length) * (0.4 + 1.2 * Math.abs(progress - 0.5) * 2)));
    s = load();
    scanTicket(s, door, e, code);
    if (i % 9 === 4) scanTicket(s, door, e, code); // someone tries a screenshot again
    if (i === Math.floor(live.length / 2)) scanTicket(s, door, e, 'FAKE0000FAKE0000');
    save(s);
    onProgress?.(i + 1, live.length);
  }
}

export async function clearDoor(slug) {
  const s = load();
  const e = eventBySlug(s, slug);
  s.tickets.filter((t) => t.event_id === e.id && t.status === 'used').forEach((t) => Object.assign(t, { status: 'valid', checked_in_at: null, checked_in_by: null }));
  s.checkins = s.checkins.filter((c) => c.event_id !== e.id);
  save(s);
  emit('checkin:changed', { event: slug });
}
