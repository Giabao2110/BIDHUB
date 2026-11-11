import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import test, { type TestContext } from 'node:test';
import { setTimeout } from 'node:timers/promises';
import pg, { type Pool, type PoolClient } from 'pg';
import { runMigrations } from '../../database/migrations.js';
import { processAuctionLifecycle } from '../../jobs/auction-lifecycle.js';
import { withTransaction } from '../../realtime/after-commit.js';
import type { PublicAuctionSnapshot } from '../../realtime/publisher.js';
import { BidError, placeBid, type PlaceBidInput, type PlaceBidResult } from './bid-service.js';

const connectionString = process.env.TEST_DATABASE_URL;
if (!connectionString) throw new Error('TEST_DATABASE_URL is required; use a dedicated PostgreSQL test database.');
const testDatabaseUrl = new URL(connectionString);

async function fixture(t: TestContext) {
  const schema = `bid_test_${randomUUID().replaceAll('-', '')}`;
  const admin = new pg.Pool({ connectionString: testDatabaseUrl.toString(), connectionTimeoutMillis: 5_000 });
  const schemaUrl = new URL(testDatabaseUrl);
  schemaUrl.searchParams.set('options', `-c search_path=${schema}`);
  schemaUrl.searchParams.set('application_name', schema);
  const db = new pg.Pool({
    connectionString: schemaUrl.toString(),
    max: 16,
    connectionTimeoutMillis: 5_000,
    statement_timeout: 15_000,
  });
  t.after(async () => {
    try {
      await db.end();
      await admin.query(`DROP SCHEMA IF EXISTS ${schema} CASCADE`);
    } finally {
      await admin.end();
    }
  });
  await admin.query(`CREATE SCHEMA ${schema}`);
  await runMigrations(db);

  async function createUser(): Promise<string> {
    const { rows } = await db.query(
      "INSERT INTO users(email,password_hash,display_name) VALUES($1,'fixture','Test user') RETURNING id",
      [`${randomUUID()}@example.test`],
    );
    return rows[0].id;
  }

  const sellerId = await createUser();
  const { rows: [category] } = await db.query("INSERT INTO categories(slug,name) VALUES('test','Test') RETURNING id");
  async function createAuction(): Promise<string> {
    const { rows } = await db.query(
      `INSERT INTO auctions(seller_id,category_id,title,description,status,opening_price_vnd,
         current_price_vnd,minimum_increment_vnd,starts_at,ends_at)
       VALUES($1,$2,'Test auction','Test description','ACTIVE',100,100,10,
         clock_timestamp()-interval '1 hour',clock_timestamp()+interval '1 hour')
       RETURNING id`,
      [sellerId, category.id],
    );
    return rows[0].id;
  }

  const auctionId = await createAuction();
  const bidderId = await createUser();
  const input = { auctionId, bidderId, idempotencyKey: randomUUID(), amountVnd: '100' };
  const events: PublicAuctionSnapshot[] = [];
  const submit = (request: PlaceBidInput = input) => placeBid(db, request, snapshot => { events.push(snapshot); });
  return { db, createAuction, createUser, sellerId, input, submit, events };
}

async function waitForLockWaiters(db: Pool, expected: number) {
  const deadline = Date.now() + 5_000;
  while (Date.now() < deadline) {
    const { rows: [state] } = await db.query(
      `SELECT count(*)::integer AS waiting FROM pg_stat_activity
       WHERE application_name=current_setting('application_name') AND wait_event_type='Lock'`,
    );
    if (state.waiting === expected) return;
    await setTimeout(15);
  }
  assert.fail(`Expected ${expected} bid transactions waiting on locks`);
}

async function submitWhileLocked(
  f: Awaited<ReturnType<typeof fixture>>,
  requests: PlaceBidInput[],
  acquire: (locker: PoolClient) => Promise<unknown>,
  beforeRelease?: (locker: PoolClient) => Promise<void>,
) {
  let pending: Promise<PromiseSettledResult<PlaceBidResult>[]> | undefined;
  try {
    await withTransaction(f.db, async locker => {
      await acquire(locker);
      pending = Promise.allSettled(requests.map(f.submit));
      await waitForLockWaiters(f.db, requests.length);
      await beforeRelease?.(locker);
    });
  } finally {
    await pending;
  }
  assert.ok(pending);
  return pending;
}

test('ten concurrent bids at the same price commit exactly one bid and one public snapshot', async t => {
  const f = await fixture(t);
  const bidderIds = [f.input.bidderId, ...await Promise.all(Array.from({ length: 9 }, () => f.createUser()))];
  const requests = bidderIds.map(bidderId => ({ ...f.input, bidderId, idempotencyKey: randomUUID() }));
  const { rows: [initial] } = await f.db.query(
    'SELECT ends_at, ends_at::text AS precise_deadline FROM auctions WHERE id=$1', [f.input.auctionId],
  );
  const attempts = await submitWhileLocked(f, requests, locker =>
    locker.query('SELECT id FROM auctions WHERE id=$1 FOR UPDATE', [f.input.auctionId]));

  const accepted = attempts.filter(attempt => attempt.status === 'fulfilled');
  assert.equal(accepted.length, 1);
  const first = accepted[0];
  assert.ok(first);
  const result = first.value;
  assert.equal(result.replayed, false);
  for (const attempt of attempts.filter(attempt => attempt.status === 'rejected')) {
    assert.ok(attempt.reason instanceof BidError);
    assert.equal(attempt.reason.code, 'BID_TOO_LOW');
  }
  const { rows: [row] } = await f.db.query(
    'SELECT current_price_vnd, highest_bidder_id, version, ends_at::text FROM auctions WHERE id=$1',
    [f.input.auctionId],
  );
  const winnerIndex = attempts.findIndex(attempt => attempt.status === 'fulfilled');
  const { rows: bids } = await f.db.query('SELECT id,bidder_id,amount_vnd FROM bids WHERE auction_id=$1', [f.input.auctionId]);
  assert.deepEqual(bids, [{ id: result.bidId, bidder_id: bidderIds[winnerIndex], amount_vnd: '100' }]);
  assert.deepEqual(row, {
    current_price_vnd: '100', highest_bidder_id: bidderIds[winnerIndex], version: 1, ends_at: initial.precise_deadline,
  });
  assert.deepEqual(result.auction, {
    id: f.input.auctionId,
    title: 'Test auction',
    status: 'ACTIVE',
    currentPriceVnd: '100',
    minimumIncrementVnd: '10',
    endsAt: initial.ends_at.toISOString(),
    serverTime: result.auction.serverTime,
    version: 1,
  });
  assert.equal(new Date(result.auction.serverTime).toISOString(), result.auction.serverTime);
  assert.deepEqual(f.events, [result.auction]);
});

test('concurrent same-key retries return one bid ID and replay the latest auction version without publishing', async t => {
  const f = await fixture(t);
  const attempts = await submitWhileLocked(f, Array.from({ length: 5 }, () => f.input), locker =>
    locker.query('SELECT id FROM users WHERE id=$1 FOR NO KEY UPDATE', [f.input.bidderId]));
  const results = attempts.map(attempt => {
    assert.equal(attempt.status, 'fulfilled');
    return attempt.value;
  });
  const first = results.find(result => !result.replayed);
  assert.ok(first);
  assert.equal(results.filter(result => result.replayed).length, 4);
  assert.ok(results.every(result => result.bidId === first.bidId && result.auction.version === 1));
  assert.deepEqual(f.events, [first.auction]);
  assert.equal((await f.db.query('SELECT id FROM bids')).rowCount, 1);

  // A different bidder has a separate key scope.
  const newer = await f.submit({ ...f.input, bidderId: await f.createUser(), amountVnd: '110' });
  const replay = await f.submit({ ...f.input, amountVnd: '000100', idempotencyKey: f.input.idempotencyKey.toUpperCase() });
  assert.equal(replay.replayed, true);
  assert.equal(replay.bidId, first.bidId);
  assert.equal(replay.auction.currentPriceVnd, '110');
  assert.equal(replay.auction.version, 2);
  await assert.rejects(f.submit({ ...f.input, amountVnd: '101' }), { code: 'IDEMPOTENCY_CONFLICT' });
  assert.deepEqual(f.events, [first.auction, newer.auction]);
  assert.equal((await f.db.query('SELECT id FROM bids')).rowCount, 2);
});

test('competing bids by one user with the same key on different auctions produce a conflict', async t => {
  const f = await fixture(t);
  const otherAuction = await f.createAuction();
  const attempts = await submitWhileLocked(f, [f.input, { ...f.input, auctionId: otherAuction }], locker =>
    locker.query('SELECT id FROM users WHERE id=$1 FOR NO KEY UPDATE', [f.input.bidderId]));
  const accepted = attempts.find(attempt => attempt.status === 'fulfilled');
  const rejected = attempts.find(attempt => attempt.status === 'rejected');
  assert.ok(accepted);
  assert.ok(rejected?.reason instanceof BidError);
  assert.equal(rejected.reason.code, 'IDEMPOTENCY_CONFLICT');
  const { rows } = await f.db.query('SELECT id,auction_id FROM bids');
  assert.deepEqual(rows, [{ id: accepted.value.bidId, auction_id: accepted.value.auction.id }]);
  assert.deepEqual(f.events, [accepted.value.auction]);
});

test('a bid that waits for an auction row checks the deadline against the post-lock wall clock', async t => {
  const f = await fixture(t);
  const [attempt] = await submitWhileLocked(
    f, [f.input],
    locker => locker.query('SELECT id FROM auctions WHERE id=$1 FOR UPDATE', [f.input.auctionId]),
    async locker => { await locker.query('UPDATE auctions SET ends_at=clock_timestamp() WHERE id=$1', [f.input.auctionId]); },
  );
  assert.ok(attempt);
  assert.equal(attempt.status, 'rejected');
  assert.ok(attempt.reason instanceof BidError);
  assert.equal(attempt.reason.code, 'AUCTION_NOT_ACTIVE');
  assert.equal((await f.db.query('SELECT id FROM bids')).rowCount, 0);
  assert.deepEqual(f.events, []);
});

test('a bid waiting on an account disable cannot write after the disable commits', async t => {
  const f = await fixture(t);
  const [attempt] = await submitWhileLocked(f, [f.input], locker => locker.query(
    'UPDATE users SET disabled_at=clock_timestamp() WHERE id=$1', [f.input.bidderId],
  ));
  assert.ok(attempt);
  assert.equal(attempt.status, 'rejected');
  assert.ok(attempt.reason instanceof BidError);
  assert.equal(attempt.reason.code, 'ACCOUNT_DISABLED');
  assert.equal((await f.db.query('SELECT id FROM bids')).rowCount, 0);
  assert.deepEqual(f.events, []);
});

test('scheduler skips an in-flight late bid and closes once using the extended auction state', async t => {
  const f = await fixture(t);
  // Pause the real bid after its time check but before it updates the auction.
  await f.db.query(`
    CREATE FUNCTION pause_bid_insert() RETURNS trigger LANGUAGE plpgsql AS $$
    BEGIN
      PERFORM pg_advisory_xact_lock(hashtextextended(current_schema(), 0));
      RETURN NEW;
    END;
    $$;
    CREATE TRIGGER pause_bid_insert BEFORE INSERT ON bids FOR EACH ROW EXECUTE FUNCTION pause_bid_insert();
  `);
  const { rows: [initial] } = await f.db.query(
    "UPDATE auctions SET ends_at=clock_timestamp()+interval '3 seconds' WHERE id=$1 RETURNING ends_at::text",
    [f.input.auctionId],
  );
  const close = () => processAuctionLifecycle(f.db, snapshot => { f.events.push(snapshot); });
  const [attempt] = await submitWhileLocked(
    f, [f.input],
    locker => locker.query('SELECT pg_advisory_xact_lock(hashtextextended(current_schema(), 0))'),
    async () => {
      await f.db.query('SELECT pg_sleep(GREATEST(0, EXTRACT(EPOCH FROM ends_at-clock_timestamp()))) FROM auctions WHERE id=$1',
        [f.input.auctionId]);
      const { rows: [state] } = await f.db.query('SELECT ends_at <= clock_timestamp() AS due FROM auctions WHERE id=$1',
        [f.input.auctionId]);
      assert.equal(state.due, true);
      assert.equal(await close(), 0);
      assert.deepEqual(f.events, []);
    },
  );
  assert.ok(attempt);
  assert.equal(attempt.status, 'fulfilled');
  const { auction, bidId } = attempt.value;
  assert.equal(auction.version, 1);
  const { rows: [timing] } = await f.db.query(
    `SELECT b.created_at < $2::timestamptz AS bid_before_old_deadline,
         a.ends_at = b.created_at + interval '60 seconds' AS extended
     FROM auctions a JOIN bids b ON b.auction_id=a.id WHERE b.id=$1`,
    [bidId, initial.ends_at],
  );
  assert.deepEqual(timing, { bid_before_old_deadline: true, extended: true });
  assert.equal(await close(), 0);
  assert.equal((await f.db.query('SELECT auction_id FROM auction_results')).rowCount, 0);
  assert.deepEqual(f.events, [auction]);

  // Advance the fixture to expiry without waiting through the full extension.
  await f.db.query('UPDATE auctions SET ends_at=clock_timestamp() WHERE id=$1', [f.input.auctionId]);
  const batches = await Promise.all([close(), close()]);
  assert.deepEqual(batches.sort(), [0, 1]);
  const { rows: results } = await f.db.query(
    'SELECT winner_id,winning_bid_id,final_price_vnd FROM auction_results WHERE auction_id=$1', [f.input.auctionId],
  );
  assert.deepEqual(results, [{ winner_id: f.input.bidderId, winning_bid_id: bidId, final_price_vnd: '100' }]);
  await assert.rejects(f.submit({ ...f.input, idempotencyKey: randomUUID(), amountVnd: '110' }), { code: 'AUCTION_NOT_ACTIVE' });
  const replay = await f.submit();
  assert.equal(replay.bidId, bidId);
  assert.equal(replay.replayed, true);
  assert.equal(replay.auction.status, 'ENDED');
  assert.deepEqual(f.events.map(s => [s.status, s.version]), [['ACTIVE', 1], ['ENDED', 2]]);
});

test('validates account, auction state and signed BIGINT boundaries before writing', async t => {
  const f = await fixture(t);
  for (const amountVnd of [undefined, null, 100, '', '0', '-100', '+100', '100.0', '1e2', '100\n', ' 100', '9223372036854775808']) {
    await assert.rejects(f.submit({ ...f.input, amountVnd }), { code: 'INVALID_INPUT' });
  }
  await assert.rejects(f.submit({ ...f.input, idempotencyKey: 'not-a-key' }), { code: 'INVALID_INPUT' });
  await assert.rejects(f.submit({ ...f.input, auctionId: 'not-an-auction' }), { code: 'INVALID_INPUT' });
  await assert.rejects(f.submit({ ...f.input, auctionId: randomUUID() }), { code: 'NOT_FOUND' });
  await assert.rejects(f.submit({ ...f.input, bidderId: randomUUID() }), { code: 'UNAUTHENTICATED' });
  await assert.rejects(f.submit({ ...f.input, bidderId: f.sellerId.toUpperCase() }), { code: 'SELF_BIDDING' });
  await assert.rejects(f.submit({ ...f.input, amountVnd: '99' }), { code: 'BID_TOO_LOW' });
  const disabledId = await f.createUser();
  await f.db.query('UPDATE users SET disabled_at=clock_timestamp() WHERE id=$1', [disabledId]);
  await assert.rejects(f.submit({ ...f.input, bidderId: disabledId }), { code: 'ACCOUNT_DISABLED' });
  const future = await f.createAuction();
  await f.db.query("UPDATE auctions SET starts_at=clock_timestamp()+interval '30 minutes' WHERE id=$1", [future]);
  await assert.rejects(f.submit({ ...f.input, auctionId: future }), { code: 'AUCTION_NOT_ACTIVE' });
  await f.db.query("UPDATE auctions SET status='CANCELLED' WHERE id=$1", [future]);
  await assert.rejects(f.submit({ ...f.input, auctionId: future }), { code: 'AUCTION_NOT_ACTIVE' });
  assert.equal((await f.db.query('SELECT id FROM bids')).rowCount, 0);
  assert.deepEqual(f.events, []);

  const maxAmount = '9223372036854775807';
  const max = await f.submit({ ...f.input, amountVnd: maxAmount });
  assert.equal(max.auction.currentPriceVnd, maxAmount);
  const { rows: bids } = await f.db.query('SELECT amount_vnd FROM bids');
  assert.deepEqual(bids, [{ amount_vnd: maxAmount }]);
  await assert.rejects(f.submit({ ...f.input, idempotencyKey: randomUUID(), amountVnd: maxAmount }), { code: 'BID_TOO_LOW' });
  assert.deepEqual(f.events, [max.auction]);
});

test('a failed PostgreSQL COMMIT rolls back the bid and auction update without publishing', async t => {
  const f = await fixture(t);
  await f.db.query(`
    CREATE FUNCTION fail_bid_commit() RETURNS trigger LANGUAGE plpgsql AS $$
    BEGIN
      RAISE EXCEPTION 'forced bid commit failure' USING ERRCODE='23514';
    END;
    $$;
    CREATE CONSTRAINT TRIGGER fail_bid_commit AFTER UPDATE ON auctions
    DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION fail_bid_commit();
  `);
  const query = 'SELECT current_price_vnd,highest_bidder_id,ends_at,version FROM auctions WHERE id=$1';
  const { rows: before } = await f.db.query(query, [f.input.auctionId]);
  await assert.rejects(f.submit({ ...f.input, amountVnd: '120' }), { code: '23514', message: 'forced bid commit failure' });
  assert.deepEqual((await f.db.query(query, [f.input.auctionId])).rows, before);
  assert.equal((await f.db.query('SELECT id FROM bids')).rowCount, 0);
  assert.deepEqual(f.events, []);

  await f.db.query('DROP TRIGGER fail_bid_commit ON auctions');
  const retry = await f.submit({ ...f.input, amountVnd: '120' });
  assert.equal(retry.replayed, false);
  assert.equal(retry.auction.version, 1);
  assert.deepEqual(f.events, [retry.auction]);
});
