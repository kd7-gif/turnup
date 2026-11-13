import mysql from 'mysql2/promise';
import { config } from './config.js';

const options = {
  waitForConnections: true,
  connectionLimit: 10,
  dateStrings: false,
  timezone: 'Z', // store and read times as UTC; the browser shows local time
  decimalNumbers: true,
  ...(config.dbSsl ? { ssl: { rejectUnauthorized: true } } : {}),
};

export const pool = config.db.uri
  ? mysql.createPool({ uri: config.db.uri, ...options })
  : mysql.createPool({ ...config.db, ...options });

/** Runs a query and returns just the rows. */
export async function query(sql, params = []) {
  const [rows] = await pool.query(sql, params);
  return rows;
}

const RETRYABLE = new Set(['ER_LOCK_DEADLOCK', 'ER_LOCK_WAIT_TIMEOUT']);

/**
 * Runs `fn(conn)` inside a transaction and rolls back if it throws. When the database picks this
 * transaction as the loser of a deadlock (two buyers locking the same rows in a different order),
 * it is simply run again, up to three times, which is the standard way to handle them.
 */
export async function withTransaction(fn, attempts = 3) {
  for (let attempt = 1; ; attempt++) {
    const conn = await pool.getConnection();
    try {
      await conn.beginTransaction();
      const result = await fn(conn);
      await conn.commit();
      return result;
    } catch (err) {
      await conn.rollback().catch(() => {});
      if (!RETRYABLE.has(err.code) || attempt >= attempts) throw err;
      await new Promise((r) => setTimeout(r, 10 * attempt + Math.random() * 20));
    } finally {
      conn.release();
    }
  }
}
