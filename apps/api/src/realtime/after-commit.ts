import type { Pool, PoolClient } from 'pg';
import { log } from '../observability/logger.js';
/** Services queue public event callbacks here, never emit inside a transaction. */
export async function withTransaction<T>(db: Pool, work: (client: PoolClient, afterCommit: (effect: () => void) => void) => Promise<T>): Promise<T> {
  const client = await db.connect();
  const effects: Array<() => void> = [];
  let result: T;
  try {
    await client.query('BEGIN');
    result = await work(client, effect => effects.push(effect));
    await client.query('COMMIT');
  } catch (error) {
    try { await client.query('ROLLBACK'); } catch { log('transaction_rollback_failed'); }
    throw error;
  } finally { client.release(); }
  for (const effect of effects) {
    // A notification failure must not turn a committed bid into an HTTP failure.
    try { effect(); } catch { log('after_commit_notification_failed'); }
  }
  return result;
}
