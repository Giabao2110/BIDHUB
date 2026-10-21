import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import pg from 'pg';
import { processAuctionLifecycle } from './auction-lifecycle.js';

// Real PostgreSQL isolated schema, never truncates shared/public tables.
test('lifecycle: restart catch-up, concurrent workers, winner and extended deadline', { skip: !process.env.TEST_DATABASE_URL }, async () => {
  const schema = `lifecycle_${Date.now()}`;
  const admin = new pg.Pool({ connectionString: process.env.TEST_DATABASE_URL });
  await admin.query(`CREATE SCHEMA ${schema}`);
  const db = new pg.Pool({ connectionString: process.env.TEST_DATABASE_URL, options: `-c search_path=${schema}` });
  try {
    await db.query(await readFile(new URL('../../migrations/001_initial.sql', import.meta.url), 'utf8'));
    const user = (await db.query("INSERT INTO users(email,password_hash,display_name) VALUES('test@example.com','not-login-capable','Test') RETURNING id")).rows[0].id;
    const bidder = (await db.query("INSERT INTO users(email,password_hash,display_name) VALUES('bidder@example.com','not-login-capable','Bidder') RETURNING id")).rows[0].id;
    const category = (await db.query("INSERT INTO categories(slug,name) VALUES('test','Test') RETURNING id")).rows[0].id;
    async function create(status: string, end: string) {
      return (await db.query(`INSERT INTO auctions(seller_id,category_id,title,description,status,opening_price_vnd,current_price_vnd,minimum_increment_vnd,starts_at,ends_at)
        VALUES($1,$2,'Test','Test',$3,100,100,10,clock_timestamp()-interval '2 hours',clock_timestamp()+$4::interval) RETURNING id`, [user, category, status, end])).rows[0].id;
    }
    const expired = await create('ACTIVE', '-1 hour');
    const missed = await create('SCHEDULED', '-1 hour');
    const opening = await create('SCHEDULED', '1 hour');
    const extended = await create('ACTIVE', '-1 hour');
    const cancelled = await create('CANCELLED', '-1 hour');
    await db.query(`INSERT INTO bids(auction_id,bidder_id,amount_vnd,idempotency_key) VALUES($1,$2,150,gen_random_uuid())`, [expired, bidder]);
    // Bid service has extended this auction before lifecycle takes its lock.
    await db.query("UPDATE auctions SET ends_at=clock_timestamp()+interval '1 hour' WHERE id=$1", [extended]);
    const events: string[] = [];
    await Promise.all([processAuctionLifecycle(db, s => events.push(s.id)), processAuctionLifecycle(db, s => events.push(s.id))]);
    const results = await db.query('SELECT * FROM auction_results');
    assert.equal(results.rowCount, 2);
    assert.equal(results.rows.find(r => r.auction_id === expired).winner_id, bidder);
    assert.equal(results.rows.find(r => r.auction_id === missed).winner_id, null);
    const statuses = (await db.query('SELECT id,status FROM auctions')).rows;
    assert.equal(statuses.find(r => r.id === opening).status, 'ACTIVE');
    assert.equal(statuses.find(r => r.id === extended).status, 'ACTIVE');
    assert.equal(statuses.find(r => r.id === cancelled).status, 'CANCELLED');
    assert.equal(events.length, 3);
    assert.equal(await processAuctionLifecycle(db, () => assert.fail('duplicate event')), 0);
    // A bid transaction holding the row lock must not be closed by this worker.
    const locked = await create('ACTIVE', '-1 hour');
    const bidderTransaction = await db.connect();
    try {
      await bidderTransaction.query('BEGIN');
      await bidderTransaction.query('SELECT id FROM auctions WHERE id=$1 FOR UPDATE', [locked]);
      assert.equal(await processAuctionLifecycle(db, () => assert.fail('locked auction emitted')), 0);
      await bidderTransaction.query("UPDATE auctions SET ends_at=clock_timestamp()+interval '1 hour',version=version+1 WHERE id=$1", [locked]);
      await bidderTransaction.query('COMMIT');
      assert.equal(await processAuctionLifecycle(db, () => assert.fail('extended auction closed')), 0);
      assert.equal((await db.query('SELECT 1 FROM auction_results WHERE auction_id=$1', [locked])).rowCount, 0);
    } finally { await bidderTransaction.query('ROLLBACK'); bidderTransaction.release(); }
  } finally { await db.end(); await admin.query(`DROP SCHEMA ${schema} CASCADE`); await admin.end(); }
});
