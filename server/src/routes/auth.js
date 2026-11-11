import { Router } from 'express';
import bcrypt from 'bcryptjs';
import rateLimit from 'express-rate-limit';
import { query } from '../db.js';
import { setSession, clearSession } from '../middleware/auth.js';
import { HttpError, asyncRoute, cleanString, isEmail } from '../utils/http.js';

const router = Router();

// Slows down password guessing: 20 attempts per 15 minutes per IP.
const authLimiter = rateLimit({ windowMs: 15 * 60 * 1000, limit: 20, standardHeaders: true, legacyHeaders: false });

export const CITIES = ['Lagos', 'Abuja', 'Ibadan'];
const publicUser = (u) => ({ id: u.id, full_name: u.full_name, email: u.email, phone: u.phone, role: u.role, city: u.city });

router.post(
  '/register',
  authLimiter,
  asyncRoute(async (req, res) => {
    const full_name = cleanString(req.body.full_name, 120);
    const email = cleanString(req.body.email, 190).toLowerCase();
    const phone = cleanString(req.body.phone, 30);
    const city = CITIES.includes(req.body.city) ? req.body.city : 'Lagos';
    const password = typeof req.body.password === 'string' ? req.body.password : '';

    const fields = {};
    if (full_name.length < 2) fields.full_name = 'Enter your full name.';
    if (!isEmail(email)) fields.email = 'Enter a valid email address.';
    if (!/^\+?[0-9 ]{10,15}$/.test(phone)) fields.phone = 'Enter a valid phone number.';
    if (password.length < 8) fields.password = 'Use at least 8 characters.';
    if (Object.keys(fields).length) throw new HttpError(422, 'Check the highlighted fields.', fields);

    const taken = await query('SELECT 1 FROM users WHERE email = ?', [email]);
    if (taken.length) throw new HttpError(409, 'That email already has an account. Log in instead.', { email: 'Already registered.' });

    const hash = await bcrypt.hash(password, 12);
    const result = await query('INSERT INTO users (full_name, email, phone, password_hash, role, city) VALUES (?,?,?,?,?,?)',
      [full_name, email, phone, hash, 'guest', city]);
    const user = { id: result.insertId, full_name, email, phone, role: 'guest', city };
    setSession(res, user);
    res.status(201).json({ user });
  })
);

router.post(
  '/login',
  authLimiter,
  asyncRoute(async (req, res) => {
    const email = cleanString(req.body.email, 190).toLowerCase();
    const password = typeof req.body.password === 'string' ? req.body.password : '';
    const [user] = await query('SELECT * FROM users WHERE email = ?', [email]);
    // Same message whether the email or the password is wrong, so emails cannot be probed.
    if (!user || !(await bcrypt.compare(password, user.password_hash))) {
      throw new HttpError(401, 'That email and password do not match.');
    }
    setSession(res, user);
    res.json({ user: publicUser(user) });
  })
);

router.post('/logout', (_req, res) => {
  clearSession(res);
  res.json({ ok: true });
});

// Signed-out visitors get { user: null } rather than an error, since that is a normal state.
router.get(
  '/me',
  asyncRoute(async (req, res) => {
    if (!req.user) return res.json({ user: null });
    const [row] = await query('SELECT * FROM users WHERE id = ?', [req.user.id]);
    if (!row) return res.json({ user: null });
    const user = publicUser(row);
    if (user.role === 'host') {
      user.hosts = await query('SELECT id, name, slug FROM hosts WHERE owner_id = ? ORDER BY id', [user.id]);
    }
    res.json({ user });
  })
);

export default router;
