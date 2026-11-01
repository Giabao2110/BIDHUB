import { readdir, readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import type { Pool } from 'pg';

/** Apply each migration atomically on one connection, serialized with other runners. */
export async function runMigrations(
  db: Pick<Pool, 'connect'>,
  folder = new URL('../../migrations/', import.meta.url),
): Promise<string[]> {
  const directory = fileURLToPath(folder);
  const files = (await readdir(directory)).filter(file => file.endsWith('.sql')).sort();
  const client = await db.connect();
  let locked = false;
  const applied: string[] = [];
  try {
    await client.query('SELECT pg_advisory_lock(481231)');
    locked = true;
    await client.query('CREATE TABLE IF NOT EXISTS schema_migrations (name text PRIMARY KEY, applied_at timestamptz NOT NULL DEFAULT now())');
    for (const file of files) {
      const existing = await client.query('SELECT 1 FROM schema_migrations WHERE name=$1', [file]);
      if (existing.rowCount) continue;
      await client.query('BEGIN');
      try {
        await client.query(await readFile(new URL(file, folder), 'utf8'));
        await client.query('INSERT INTO schema_migrations(name) VALUES($1)', [file]);
        await client.query('COMMIT');
        applied.push(file);
      } catch (error) {
        await client.query('ROLLBACK');
        throw error;
      }
    }
    return applied;
  } finally {
    try {
      if (locked) await client.query('SELECT pg_advisory_unlock(481231)');
    } finally {
      client.release();
    }
  }
}
