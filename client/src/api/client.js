// Small wrapper around fetch for our API. Errors carry the server's message and field errors.
export class ApiError extends Error {
  constructor(message, status, fields) {
    super(message);
    this.status = status;
    this.fields = fields || {};
  }
}

// The hosted demo has no server: the same requests are answered inside the browser (see src/demo).
export const DEMO = import.meta.env.VITE_DEMO === 'true';

export async function api(path, { method = 'GET', body } = {}) {
  if (DEMO) {
    const { demoApi } = await import('../demo/server.js');
    return demoApi(path, { method, body });
  }
  let res;
  try {
    res = await fetch(`/api${path}`, {
      method,
      credentials: 'include',
      headers: body ? { 'Content-Type': 'application/json' } : {},
      body: body ? JSON.stringify(body) : undefined,
    });
  } catch {
    throw new ApiError('We could not reach Turnup. Check your connection and try again.', 0);
  }
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new ApiError(data.error || 'Something went wrong. Try again.', res.status, data.fields);
  return data;
}

export const naira = (n) => `₦${Number(n).toLocaleString('en-NG')}`;

const TZ = 'Africa/Lagos';
/** "Sat 22 Nov" */
export const dayLabel = (d) => new Date(d).toLocaleDateString('en-GB', { weekday: 'short', day: 'numeric', month: 'short', timeZone: TZ });
/** "9pm" or "9:30pm" */
export const timeLabel = (d) => new Date(d).toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit', timeZone: TZ })
  .replace(':00', '').replace(' ', '').toLowerCase();
export const dateParts = (d) => {
  const date = new Date(d);
  return {
    day: date.toLocaleDateString('en-GB', { day: 'numeric', timeZone: TZ }),
    month: date.toLocaleDateString('en-GB', { month: 'short', timeZone: TZ }),
  };
};

/** "Happening now", "Today", "Tomorrow", "In 3 days" */
export function whenLabel(starts, ends) {
  const now = Date.now();
  const s = new Date(starts).getTime();
  if (s <= now && new Date(ends).getTime() > now) return 'Happening now';
  const lagosDay = (t) => Math.floor((t + 3600000) / 86400000);
  const days = lagosDay(s) - lagosDay(now);
  if (days <= 0) return 'Today';
  if (days === 1) return 'Tomorrow';
  return `In ${days} days`;
}

export const priceLabel = (e) => (e.is_free ? 'Free' : e.from_price == null ? 'Sold out' : `From ${naira(e.from_price)}`);

/** A UTC date as the value for a datetime-local input, in Lagos time ("2026-11-20T21:00"). */
export const toLagosInput = (d) => (d ? new Date(new Date(d).getTime() + 3600000).toISOString().slice(0, 16) : '');
