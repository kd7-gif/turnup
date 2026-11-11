import jwt from 'jsonwebtoken';
import { config } from '../config.js';
import { HttpError } from '../utils/http.js';

export const SESSION_COOKIE = 'turnup_session';
const WEEK_MS = 7 * 24 * 60 * 60 * 1000;

export function setSession(res, user) {
  const token = jwt.sign({ sub: user.id, role: user.role }, config.jwtSecret, { expiresIn: '7d' });
  res.cookie(SESSION_COOKIE, token, {
    httpOnly: true, // not readable from JavaScript, so a script injection cannot steal it
    sameSite: 'lax',
    secure: config.isProd,
    maxAge: WEEK_MS,
    path: '/',
  });
}

export function clearSession(res) {
  res.clearCookie(SESSION_COOKIE, { path: '/' });
}

/** Adds req.user ({ id, role }) when a valid session cookie is present. Never blocks. */
export function readSession(req, _res, next) {
  const token = req.cookies?.[SESSION_COOKIE];
  if (token) {
    try {
      const payload = jwt.verify(token, config.jwtSecret);
      req.user = { id: payload.sub, role: payload.role };
    } catch {
      /* expired or tampered: treat as signed out */
    }
  }
  next();
}

/** Blocks the request unless the user is signed in (and, if given, has one of the roles). */
export const requireAuth = (...roles) => (req, _res, next) => {
  if (!req.user) return next(new HttpError(401, 'Log in to continue.'));
  if (roles.length && !roles.includes(req.user.role)) return next(new HttpError(403, 'Your account cannot do that.'));
  next();
};
