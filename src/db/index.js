import pg from 'pg';
import { config } from '../config.js';

export const pool = new pg.Pool({
  connectionString: config.db.connectionString,
  ssl: config.db.ssl,
});

pool.on('error', (err) => {
  // Don't crash the process on idle-client errors; pg will reconnect.
  console.error('[db] idle client error', err.message);
});

export function query(text, params) {
  return pool.query(text, params);
}
