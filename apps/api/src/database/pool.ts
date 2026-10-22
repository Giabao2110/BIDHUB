import pg from 'pg';
import { env } from '../config/env.js';
import { log } from '../observability/logger.js';
export const pool = new pg.Pool({ connectionString: env.databaseUrl, max: 10, connectionTimeoutMillis: 3000,
  statement_timeout: 5000, idle_in_transaction_session_timeout: 10000 });
// Idle DB disconnects are operational failures, not unhandled EventEmitter errors.
pool.on('error', () => log('database_pool_error'));
