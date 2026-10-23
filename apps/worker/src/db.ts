import { Pool } from 'pg';
import { log } from './log';

export function createPool(connectionString: string, max?: number): Pool {
  const pool = new Pool({ connectionString, ...(max ? { max } : {}) });
  pool.on('error', (err) => {
    log.error('idle database connection lost', { error: err.message });
  });
  return pool;
}
