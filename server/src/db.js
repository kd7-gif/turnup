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

/** Runs `fn(conn)` inside a transaction and rolls back if it throws. */
export async function withTransaction(fn) {
  const conn = await pool.getConnection();
  try {
    await conn.beginTransaction();
    const result = await fn(conn);
    await conn.commit();
    return result;
  } catch (err) {
    await conn.rollback();
    throw err;
  } finally {
    conn.release();
  }
}
