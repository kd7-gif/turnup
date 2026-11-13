import 'dotenv/config';

const isProd = process.env.NODE_ENV === 'production';

if (isProd && !process.env.JWT_SECRET) {
  throw new Error('JWT_SECRET must be set when NODE_ENV=production');
}

export const config = {
  isProd,
  port: Number(process.env.PORT || 5080),
  clientOrigins: (process.env.CLIENT_ORIGIN || 'http://localhost:5175').split(',').map((s) => s.trim()),
  jwtSecret: process.env.JWT_SECRET || 'dev-only-secret-change-me',
  db: process.env.DATABASE_URL
    ? { uri: process.env.DATABASE_URL }
    : {
        host: process.env.DB_HOST || '127.0.0.1',
        port: Number(process.env.DB_PORT || 3306),
        user: process.env.DB_USER || 'turnup',
        password: process.env.DB_PASSWORD || '',
        database: process.env.DB_NAME || 'turnup',
      },
  dbSsl: process.env.DB_SSL === 'true',
  paystackSecret: process.env.PAYSTACK_SECRET_KEY || '',
  publicUrl: (process.env.PUBLIC_URL || process.env.CLIENT_ORIGIN?.split(',')[0] || 'http://localhost:5175').replace(/\/$/, ''),
};
