import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import express from 'express';
import cors from 'cors';
import helmet from 'helmet';
import cookieParser from 'cookie-parser';
import { config } from './config.js';
import { query } from './db.js';
import { readSession } from './middleware/auth.js';
import { HttpError } from './utils/http.js';
import authRoutes from './routes/auth.js';
import eventRoutes from './routes/events.js';
import hostRoutes from './routes/hosts.js';
import meRoutes from './routes/me.js';
import orderRoutes from './routes/orders.js';
import paymentRoutes from './routes/payments.js';

export const app = express();

if (config.isProd) app.set('trust proxy', 1);
app.use(helmet({ contentSecurityPolicy: false }));
app.use(cors({ origin: config.clientOrigins, credentials: true }));
// Paystack's webhook needs the raw request body to check its signature, so it goes before the JSON parser
app.use('/api/payments', paymentRoutes);
app.use(express.json({ limit: '100kb' }));
app.use(cookieParser());
app.use(readSession);

// Blocks forged form posts from other websites: change-making requests must come from our own pages.
app.use('/api', (req, _res, next) => {
  const origin = req.headers.origin;
  if (['GET', 'HEAD', 'OPTIONS'].includes(req.method) || !origin || config.clientOrigins.includes(origin)) return next();
  next(new HttpError(403, 'Request blocked.'));
});

app.get('/api/health', async (_req, res) => {
  await query('SELECT 1');
  res.json({ ok: true });
});

app.use('/api/auth', authRoutes);
app.use('/api/events', eventRoutes);
app.use('/api/hosts', hostRoutes);
app.use('/api/me', meRoutes);
app.use('/api/orders', orderRoutes);
app.use('/api', (_req, _res, next) => next(new HttpError(404, 'Not found.')));

// In production this one server also serves the built React app, so site and API share an address.
const siteDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../client/dist');
if (fs.existsSync(path.join(siteDir, 'index.html'))) {
  app.use(express.static(siteDir, { index: false, maxAge: '1h' }));
  app.get('*', (req, res, next) => (req.path.startsWith('/api') ? next() : res.sendFile(path.join(siteDir, 'index.html'))));
}

// eslint-disable-next-line no-unused-vars
app.use((err, _req, res, _next) => {
  const status = err.status || 500;
  if (status >= 500) console.error(err);
  res.status(status).json({
    error: status >= 500 ? 'Something went wrong on our side. Try again.' : err.message,
    ...(err.fields ? { fields: err.fields } : {}),
  });
});

// Start listening only when run directly (tests import `app` without opening a port).
if (process.argv[1] === fileURLToPath(import.meta.url)) {
  app.listen(config.port, () => console.log(`Turnup API running on http://localhost:${config.port}`));
}
