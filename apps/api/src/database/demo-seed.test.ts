import test, { type TestContext } from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import pg from 'pg';
import { runMigrations } from './migrations.js';
import { seedDemo } from './demo-seed.js';
import { verifyPassword } from '../modules/auth/password.js';

const connectionString = process.env.TEST_DATABASE_URL;
if (!connectionString) throw new Error('TEST_DATABASE_URL is required; use a dedicated PostgreSQL test database.');
const password = 'Synthetic seed test password!';
const demoId = (n: number) => `d3000000-0000-4000-8000-${String(n).padStart(12, '0')}`;

async function database(t: TestContext) {
  const schema = `seed_test_${randomUUID().replaceAll('-', '')}`;
  const admin = new pg.Pool({ connectionString });
  const db = new pg.Pool({ connectionString, options: `-c search_path=${schema}` });
  t.after(async () => {
    try { await db.end(); await admin.query(`DROP SCHEMA IF EXISTS ${schema} CASCADE`); }
    finally { await admin.end(); }
  });
  await admin.query(`CREATE SCHEMA ${schema}`);
  await runMigrations(db);
  return db;
}

test('seed twice/concurrently preserves rows, credentials and history; initial demos have coherent relative times', async t => {
  const db = await database(t);
  const start = Date.now();
  await Promise.all([seedDemo(db, password), seedDemo(db, password)]);
  const users = (await db.query('SELECT * FROM users ORDER BY id')).rows;
  assert.equal(users.length, 3);
  assert.deepEqual(users.map(u => u.role), ['ADMIN', 'MEMBER', 'MEMBER']);
  assert.equal(new Set(users.map(u => u.password_hash)).size, 3);
  for (const user of users) {
    assert.match(user.password_hash, /^\$argon2id\$/);
    assert.equal(await verifyPassword(user.password_hash, password), true);
  }
  const auctions = (await db.query('SELECT * FROM auctions ORDER BY id')).rows;
  assert.equal(auctions.length, 6);
  assert.deepEqual([...new Set(auctions.map(a => a.status))].sort(), ['ACTIVE','CANCELLED','DRAFT','ENDED','SCHEDULED']);
  for (const a of auctions) {
    assert.ok(a.ends_at > a.starts_at);
    assert.equal(a.seller_id, demoId(2));
    if (a.status === 'SCHEDULED') assert.ok(a.starts_at.getTime() > Date.now());
    if (a.status === 'ACTIVE') assert.ok(a.starts_at.getTime() < start && a.ends_at.getTime() > Date.now());
    if (a.status === 'ENDED') assert.ok(a.ends_at.getTime() < start);
  }
  assert.equal((await db.query('SELECT * FROM categories')).rowCount, 1);
  const bids = (await db.query('SELECT * FROM bids ORDER BY id')).rows;
  assert.equal(bids.length, 2);
  for (const bid of bids) {
    const a = auctions.find(a => a.id === bid.auction_id);
    assert.equal(bid.bidder_id, a.highest_bidder_id);
    assert.equal(bid.amount_vnd, a.current_price_vnd);
    assert.ok(bid.created_at >= a.starts_at && bid.created_at < a.ends_at);
  }
  const results = (await db.query('SELECT * FROM auction_results ORDER BY auction_id')).rows;
  assert.equal(results.length, 2);
  assert.equal(results[0].winner_id, demoId(3));
  assert.equal(results[0].winning_bid_id, bids[1].id);
  assert.equal(results[0].final_price_vnd, '120000');
  assert.equal(results[1].winner_id, null);
  assert.equal(results[1].winning_bid_id, null);
  assert.equal(results[1].final_price_vnd, null);

  // Simulate legitimate changes after demo creation; rerun must not reset them.
  await db.query("UPDATE auctions SET status='CANCELLED',version=version+1 WHERE id=$1", [demoId(103)]);
  await db.query('UPDATE users SET disabled_at=clock_timestamp() WHERE id=$1', [demoId(3)]);
  const before = (await db.query('SELECT * FROM auctions ORDER BY id')).rows;
  const beforeUsers = (await db.query('SELECT * FROM users ORDER BY id')).rows;
  await seedDemo(db, 'A different seed password!');
  assert.deepEqual((await db.query('SELECT * FROM auctions ORDER BY id')).rows, before);
  assert.deepEqual((await db.query('SELECT * FROM users ORDER BY id')).rows, beforeUsers);
  assert.deepEqual((await db.query('SELECT * FROM bids ORDER BY id')).rows, bids);
  assert.deepEqual((await db.query('SELECT * FROM auction_results ORDER BY auction_id')).rows, results);
});

test('conflicting reserved identity rolls back every seed insert without modifying existing users', async t => {
  const db = await database(t);
  await db.query("INSERT INTO users(id,email,password_hash,display_name) VALUES($1,'existing@test.invalid','not-login-capable','Existing')", [demoId(2)]);
  await assert.rejects(seedDemo(db, password), /conflicts/);
  assert.equal((await db.query('SELECT * FROM users')).rowCount, 1);
  assert.equal((await db.query('SELECT * FROM categories')).rowCount, 0);
  assert.equal((await db.query('SELECT * FROM auctions')).rowCount, 0);
});

test('production and missing/short passwords are rejected before database access', async () => {
  const db = { connect: async () => { throw new Error('must not connect'); } };
  await assert.rejects(seedDemo(db as unknown as pg.Pool, ''), /SEED_DEMO_PASSWORD/);
  const original = process.env.NODE_ENV;
  try {
    process.env.NODE_ENV = 'production';
    await assert.rejects(seedDemo(db as unknown as pg.Pool, password), /disabled in production/);
  } finally {
    if (original === undefined) delete process.env.NODE_ENV;
    else process.env.NODE_ENV = original;
  }
});
