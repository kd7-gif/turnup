export class HttpError extends Error {
  constructor(status, message, fields) {
    super(message);
    this.status = status;
    this.fields = fields;
  }
}

/** Wraps an async route so thrown errors reach the error handler. */
export const asyncRoute = (fn) => (req, res, next) => Promise.resolve(fn(req, res, next)).catch(next);

export function cleanString(value, max = 200) {
  return typeof value === 'string' ? value.trim().slice(0, max) : '';
}

export const isEmail = (s) => /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(s);
