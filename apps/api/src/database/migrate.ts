import { pool } from './pool.js';
import { runMigrations } from './migrations.js';

try {
  for (const file of await runMigrations(pool)) console.log(`Applied ${file}`);
} finally {
  await pool.end();
}
