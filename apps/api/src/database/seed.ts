import { pool } from './pool.js';
import { seedDemo } from './demo-seed.js';

try {
  await seedDemo(pool, process.env.SEED_DEMO_PASSWORD ?? '');
  console.log('Demo seed complete. Existing records were preserved.');
} finally { await pool.end(); }
