import test, { type TestContext } from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { mkdtemp, readFile, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import pg from 'pg';
import { runMigrations } from './migrations.js';
import { processAuctionLifecycle } from '../jobs/auction-lifecycle.js';

const connectionString = process.env.TEST_DATABASE_URL;
if (!connectionString) throw new Error('TEST_DATABASE_URL is required; use a dedicated PostgreSQL test database.');
const migrationNames = ['001_initial.sql', '002_result_integrity.sql'];

async function database(t: TestContext) {
  const schema = `migration_test_${randomUUID().replaceAll('-', '')}`;
  const admin = new pg.Pool({ connectionString, connectionTimeoutMillis: 3000 });
  const db = new pg.Pool({ connectionString, max: 4, connectionTimeoutMillis: 3000,
    statement_timeout: 10000, options: `-c search_path=${schema}` });
  t.after(async () => {
    try { await db.end(); await admin.query(`DROP SCHEMA IF EXISTS ${schema} CASCADE`); }
    finally { await admin.end(); }
  });
  await admin.query(`CREATE SCHEMA ${schema}`);
  return db;
}

async function temporaryMigrations(t: TestContext) {
  const folder = await mkdtemp(join(tmpdir(), 'bidhub-migrations-'));
  t.after(() => rm(folder, { recursive: true, force: true }));
  return { path: folder, url: pathToFileURL(folder + '/') };
}

async function domainRows(db: pg.Pool) {
  const seller = (await db.query("INSERT INTO users(email,password_hash,display_name) VALUES('seller@test.invalid','not-login-capable','Seller') RETURNING id")).rows[0].id;
  const buyer = (await db.query("INSERT INTO users(email,password_hash,display_name) VALUES('buyer@test.invalid','not-login-capable','Buyer') RETURNING id")).rows[0].id;
  const category = (await db.query("INSERT INTO categories(slug,name) VALUES('test','Test') RETURNING id")).rows[0].id;
  const auction = (await db.query(`INSERT INTO auctions(seller_id,category_id,title,description,
    opening_price_vnd,current_price_vnd,minimum_increment_vnd,starts_at,ends_at)
    VALUES($1,$2,'Test','Test',100,100,10,clock_timestamp()-interval '2 hours',clock_timestamp()-interval '1 hour') RETURNING id`, [seller, category])).rows[0].id;
  const bid = (await db.query(`INSERT INTO bids(auction_id,bidder_id,amount_vnd,idempotency_key)
    VALUES($1,$2,110,$3) RETURNING id,idempotency_key`, [auction, buyer, randomUUID()])).rows[0];
  return { seller, buyer, category, auction, bid: bid.id, key: bid.idempotency_key };
}

test('fresh DB applies migrations once, preserves data on repeat and serializes concurrent runners', async t => {
  const db = await database(t);
  const results = await Promise.all([runMigrations(db), runMigrations(db)]);
  assert.deepEqual(results.flat().sort(), migrationNames);
  const data = await domainRows(db);
  const before = (await db.query('SELECT name,applied_at FROM schema_migrations ORDER BY name')).rows;
  assert.deepEqual(await runMigrations(db), []);
  assert.deepEqual((await db.query('SELECT name,applied_at FROM schema_migrations ORDER BY name')).rows, before);
  assert.equal((await db.query('SELECT id FROM bids WHERE id=$1', [data.bid])).rowCount, 1);
  const indexes = (await db.query('SELECT indexname FROM pg_indexes WHERE schemaname=current_schema()')).rows.map(row => row.indexname);
  for (const name of ['auctions_listing_idx', 'auctions_seller_idx', 'bids_history_idx', 'sessions_expiry_idx']) assert.ok(indexes.includes(name), name);
});

test('new constraints reject every partial winner tuple, negative versions and existing schema violations', async t => {
  const db = await database(t);
  await runMigrations(db);
  const d = await domainRows(db);
  for (const winner of [null, d.buyer]) for (const bid of [null, d.bid]) for (const amount of [null, '110', '0', '-1']) {
    if ((winner === null && bid === null && amount === null) || (winner !== null && bid !== null && amount === '110')) continue;
    await assert.rejects(db.query('INSERT INTO auction_results(auction_id,winner_id,winning_bid_id,final_price_vnd) VALUES($1,$2,$3,$4)', [d.auction, winner, bid, amount]), { code: '23514' });
  }
  await assert.rejects(db.query('UPDATE auctions SET version=-1 WHERE id=$1', [d.auction]), { code: '23514' });
  for (const update of ["status='UNKNOWN'", 'opening_price_vnd=0', 'current_price_vnd=99', 'minimum_increment_vnd=0', 'ends_at=starts_at']) {
    await assert.rejects(db.query(`UPDATE auctions SET ${update} WHERE id=$1`, [d.auction]), { code: '23514' });
  }
  await assert.rejects(db.query('UPDATE auctions SET seller_id=$1 WHERE id=$2', [randomUUID(), d.auction]), { code: '23503' });
  await assert.rejects(db.query('UPDATE bids SET amount_vnd=0 WHERE id=$1', [d.bid]), { code: '23514' });
  await assert.rejects(db.query('UPDATE bids SET amount_vnd=$1 WHERE id=$2', ['9223372036854775808', d.bid]), { code: '22003' });
  await assert.rejects(db.query('INSERT INTO bids(auction_id,bidder_id,amount_vnd,idempotency_key) VALUES($1,$2,110,$3)', [d.auction, d.buyer, d.key]), { code: '23505' });
  await db.query('INSERT INTO auction_results(auction_id,winner_id,winning_bid_id,final_price_vnd) VALUES($1,$2,$3,110)', [d.auction, d.buyer, d.bid]);
  await assert.rejects(db.query('INSERT INTO auction_results(auction_id) VALUES($1)', [d.auction]), { code: '23505' });
});

test('failed migration rolls back DDL and ledger, releases lock and can be retried', async t => {
  const db = await database(t);
  const folder = await temporaryMigrations(t);
  await writeFile(join(folder.path, '001_fail.sql'), 'CREATE TABLE rollback_probe(id integer); SELECT * FROM nonexistent_migration_table;');
  await assert.rejects(runMigrations(db, folder.url), { code: '42P01' });
  // A different connection must acquire it: reusing the same pooled session
  // would hide a leaked lock because advisory locks are reentrant per session.
  const probe = new pg.Client({ connectionString, connectionTimeoutMillis: 3000, statement_timeout: 3000 });
  await probe.connect();
  try {
    // Other suites may legitimately migrate their own schemas at the same time.
    // Wait for them, but time out if the failed runner leaked its session lock.
    await probe.query('SELECT pg_advisory_lock(481231)');
    await probe.query('SELECT pg_advisory_unlock(481231)');
  } finally { await probe.end(); }
  assert.equal((await db.query("SELECT to_regclass('rollback_probe') AS relation")).rows[0].relation, null);
  assert.equal((await db.query('SELECT * FROM schema_migrations')).rowCount, 0);
  await writeFile(join(folder.path, '001_fail.sql'), 'CREATE TABLE rollback_probe(id integer);');
  assert.deepEqual(await runMigrations(db, folder.url), ['001_fail.sql']);
  assert.deepEqual(await runMigrations(db, folder.url), []);
});

test('upgrade from 001 preserves valid rows and lifecycle can close winner/no-bid with new constraints', async t => {
  const db = await database(t);
  const folder = await temporaryMigrations(t);
  await writeFile(join(folder.path, '001_initial.sql'), await readFile(new URL('../../migrations/001_initial.sql', import.meta.url)));
  await runMigrations(db, folder.url);
  const d = await domainRows(db);
  assert.deepEqual(await runMigrations(db), ['002_result_integrity.sql']);
  await db.query("UPDATE auctions SET status='ACTIVE',current_price_vnd=110,highest_bidder_id=$1 WHERE id=$2", [d.buyer, d.auction]);
  const noBid = (await db.query(`INSERT INTO auctions(seller_id,category_id,title,description,status,
    opening_price_vnd,current_price_vnd,minimum_increment_vnd,starts_at,ends_at)
    SELECT seller_id,category_id,'No bid','Test','SCHEDULED',100,100,10,starts_at,ends_at FROM auctions WHERE id=$1 RETURNING id`, [d.auction])).rows[0].id;
  const events: string[] = [];
  assert.equal(await processAuctionLifecycle(db, s => events.push(s.id)), 2);
  assert.equal(events.length, 2);
  const rows = (await db.query('SELECT * FROM auction_results')).rows;
  assert.equal(rows.find(r => r.auction_id === d.auction).final_price_vnd, '110');
  const empty = rows.find(r => r.auction_id === noBid);
  assert.equal(empty.winner_id, null); assert.equal(empty.winning_bid_id, null); assert.equal(empty.final_price_vnd, null);
  assert.equal(await processAuctionLifecycle(db, () => assert.fail('duplicate event')), 0);
});

test('invalid legacy result prevents 002 atomically without rewriting existing data', async t => {
  const db = await database(t);
  const folder = await temporaryMigrations(t);
  await writeFile(join(folder.path, '001_initial.sql'), await readFile(new URL('../../migrations/001_initial.sql', import.meta.url)));
  await runMigrations(db, folder.url);
  const d = await domainRows(db);
  await db.query('INSERT INTO auction_results(auction_id,winner_id,winning_bid_id,final_price_vnd) VALUES($1,$2,$3,NULL)', [d.auction, d.buyer, d.bid]);
  await assert.rejects(runMigrations(db), { code: '23514' });
  assert.equal((await db.query("SELECT 1 FROM schema_migrations WHERE name='002_result_integrity.sql'")).rowCount, 0);
  assert.equal((await db.query('SELECT final_price_vnd FROM auction_results')).rows[0].final_price_vnd, null);
  assert.equal((await db.query("SELECT 1 FROM pg_constraint WHERE conname='auctions_version_nonnegative_check' AND conrelid='auctions'::regclass")).rowCount, 0);
});
