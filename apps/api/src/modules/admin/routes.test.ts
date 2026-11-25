import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import test from 'node:test';
import { setTimeout } from 'node:timers/promises';
import { expectError, startTestApi } from '../../../test/http.js';
import type { PublicAuctionSnapshot } from '../../realtime/publisher.js';

test('admin cancels under the bid lock, audits actions, revokes sessions and preserves a last admin', async t => {
  const events: PublicAuctionSnapshot[] = [];
  const { client, db, request } = await startTestApi(t, undefined, auction => events.push(auction));
  async function register(displayName: string) {
    const session = client();
    const response = await session.write('/auth/register', 'POST', { email: `${randomUUID()}@example.invalid`, password: 'fixture-password', displayName });
    assert.equal(response.status, 201);
    return { session, id: (await response.json()).user.id as string };
  }
  const admin = await register('Fixture admin');
  const seller = await register('Fixture seller');
  const bidder = await register('Fixture bidder');
  await db.query("UPDATE users SET role='ADMIN' WHERE id=$1", [admin.id]);
  const category = (await db.query("INSERT INTO categories(slug,name) VALUES ('moderation','Moderation test') RETURNING id")).rows[0].id;
  const makeAuction = async (status: string) => (await db.query(`INSERT INTO auctions
    (seller_id,category_id,title,description,status,opening_price_vnd,current_price_vnd,minimum_increment_vnd,starts_at,ends_at,was_published)
    VALUES ($1,$2,'Moderation fixture','Fixture description',$3,100,100,10,clock_timestamp()-interval '1 hour',clock_timestamp()+interval '1 hour',$4) RETURNING id`,
  [seller.id, category, status, status !== 'DRAFT'])).rows[0].id as string;
  const id = await makeAuction('ACTIVE');
  const draft = await makeAuction('DRAFT');
  const search = '/admin/auctions?q=Moderation';
  await expectError(await request(search), 401, 'UNAUTHENTICATED');
  await expectError(await bidder.session.send(search), 403, 'FORBIDDEN');
  const matches = await admin.session.send(search);
  assert.equal(matches.headers.get('cache-control'), 'no-store');
  assert.deepEqual((await matches.json()).items.map((item: { id: string }) => item.id).sort(), [id, draft].sort());
  const { rows: [{ email }] } = await db.query('SELECT email FROM users WHERE id=$1', [bidder.id]);
  const userLookup = '/admin/users/lookup';
  await expectError(await bidder.session.write(userLookup, 'POST', { email }), 403, 'FORBIDDEN');
  await expectError(await admin.session.send(userLookup, { method: 'POST' }), 403, 'INVALID_CSRF');
  assert.deepEqual(await (await admin.session.write(userLookup, 'POST', { email: email.toUpperCase() })).json(), { items: [{ id: bidder.id, email, displayName: 'Fixture bidder', role: 'MEMBER', disabled: false }] });
  const cancel = (id: string) => `/admin/auctions/${id}/cancel`;
  const bid = `/auctions/${id}/bids`;
  const bidderToken = await bidder.session.csrf();
  const submit = (path = bid) => bidder.session.send(path, { method: 'POST', headers: { 'X-CSRF-Token': bidderToken, 'Idempotency-Key': randomUUID() }, body: '{"amountVnd":"100"}' });
  await expectError(await request(cancel(id), { method: 'POST' }), 401, 'UNAUTHENTICATED');
  await expectError(await seller.session.write(cancel(id), 'POST', { reason: 'Not admin' }), 403, 'FORBIDDEN');
  await expectError(await admin.session.send(cancel(id), { method: 'POST' }), 403, 'INVALID_CSRF');
  await expectError(await admin.session.write(cancel(id), 'POST', { reason: ' ' }), 422, 'INVALID_INPUT');

  const [cancelled, competingBid] = await Promise.all([admin.session.write(cancel(id), 'POST', { reason: 'Fixture cancellation' }), submit()]);
  assert.equal(cancelled.status, 200);
  assert.equal((await cancelled.json()).auction.status, 'CANCELLED');
  assert.ok([201, 409].includes(competingBid.status));
  if (competingBid.status === 409) await expectError(competingBid, 409, 'AUCTION_NOT_ACTIVE');
  else await competingBid.json();
  assert.equal(events.filter(event => event.status === 'CANCELLED').length, 1);
  assert.equal([...events].sort((a, b) => b.version - a.version)[0]?.status, 'CANCELLED');
  assert.equal((await db.query('SELECT 1 FROM bids WHERE auction_id=$1', [id])).rowCount, competingBid.status === 201 ? 1 : 0);
  const anotherId = await makeAuction('ACTIVE');
  const anotherBid = `/auctions/${anotherId}/bids`;
  assert.equal((await submit(anotherBid)).status, 201);
  const mine = await (await bidder.session.send(`/me/bids?bidderId=${seller.id}`)).json();
  assert.equal(mine.total, competingBid.status === 201 ? 2 : 1);
  assert.equal(mine.items[0].auctionId, anotherId);
  assert.equal((await (await seller.session.send(`/me/bids?bidderId=${bidder.id}`)).json()).total, 0);
  await expectError(await request('/me/bids'), 401, 'UNAUTHENTICATED');
  await expectError(await submit(), 409, 'AUCTION_NOT_ACTIVE');
  await expectError(await request(`/auctions/${id}/result`), 409, 'AUCTION_CANCELLED');
  await expectError(await admin.session.write(cancel(id), 'POST', { reason: 'Duplicate' }), 409, 'AUCTION_TERMINAL');
  const publishedEventCount = events.length;
  assert.equal((await admin.session.write(cancel(draft), 'POST', { reason: 'Private draft' })).status, 200);
  assert.equal(events.length, publishedEventCount);
  await expectError(await request(`/auctions/${draft}`), 404, 'NOT_FOUND');

  const disable = (id: string) => `/admin/users/${id}`;
  await expectError(await admin.session.write(disable(admin.id), 'PATCH', { disabled: true, reason: 'Last admin' }), 409, 'LAST_ADMIN');
  assert.equal((await admin.session.write(disable(bidder.id), 'PATCH', { disabled: true, reason: 'Fixture disable' })).status, 200);
  await expectError(await bidder.session.send('/auth/me'), 401, 'UNAUTHENTICATED');
  await expectError(await submit(anotherBid), 401, 'UNAUTHENTICATED');
  assert.equal((await db.query('SELECT 1 FROM sessions WHERE user_id=$1', [bidder.id])).rowCount, 0);
  assert.equal((await admin.session.write(disable(bidder.id), 'PATCH', { disabled: false, reason: 'Fixture enable' })).status, 200);
  await expectError(await bidder.session.send('/auth/me'), 401, 'UNAUTHENTICATED');
  const { rows } = await db.query('SELECT action, details->>\'reason\' AS reason FROM audit_logs WHERE actor_id=$1 ORDER BY created_at,id', [admin.id]);
  assert.deepEqual(rows, [
    { action: 'AUCTION_CANCELLED', reason: 'Fixture cancellation' },
    { action: 'AUCTION_CANCELLED', reason: 'Private draft' },
    { action: 'USER_DISABLED', reason: 'Fixture disable' },
    { action: 'USER_ENABLED', reason: 'Fixture enable' },
  ]);

  // Remove the original administrator from the guard's count for these cases.
  await db.query("UPDATE users SET role='MEMBER' WHERE id=$1", [admin.id]);
  for (const mode of ['self', 'each-other'] as const) {
    await t.test(`concurrent admins disabling ${mode} preserve one active administrator`, async () => {
      const pair = await Promise.all([register('Admin A'), register('Admin B')]);
      await db.query("UPDATE users SET role='ADMIN' WHERE id=ANY($1::uuid[])", [pair.map(a => a.id)]);
      const tokens = await Promise.all(pair.map(a => a.session.csrf()));
      const locker = await db.connect();
      let pending: Promise<Response[]> | undefined;
      try {
        await locker.query('BEGIN');
        await locker.query('SELECT pg_advisory_xact_lock(71286,15)');
        const { rows: [{ pid }] } = await locker.query('SELECT pg_backend_pid() AS pid');
        pending = Promise.all(pair.map((actor, index) => actor.session.send(
          disable(pair[mode === 'self' ? index : 1 - index].id), {
            method: 'PATCH', headers: { 'X-CSRF-Token': tokens[index] },
            body: JSON.stringify({ disabled: true, reason: `Race ${mode}` }),
          })));
        // Both HTTP requests must reach the transaction lock before release.
        const deadline = Date.now() + 5000;
        let waiting = 0;
        while (Date.now() < deadline) {
          const { rows: [state] } = await db.query(`SELECT count(*)::integer AS waiting
            FROM pg_stat_activity WHERE $1=ANY(pg_blocking_pids(pid))`, [pid]);
          waiting = state.waiting;
          if (waiting === 2) break;
          await setTimeout(10);
        }
        assert.equal(waiting, 2, 'Both admin transactions must wait on the held lock');
        await locker.query('COMMIT');
      } finally {
        await locker.query('ROLLBACK');
        locker.release();
        // Drain requests even if the barrier assertion fails, before schema cleanup.
        if (pending) await pending;
      }
      assert.ok(pending);
      const responses = await pending;
      assert.deepEqual(responses.map(r => r.status).sort(), mode === 'self' ? [200, 409] : [200, 403]);
      for (const response of responses) {
        if (response.status === 200) await response.json();
        else await expectError(response, mode === 'self' ? 409 : 403, mode === 'self' ? 'LAST_ADMIN' : 'FORBIDDEN');
      }
      const { rows: accounts } = await db.query("SELECT id,disabled_at FROM users WHERE role='ADMIN'");
      assert.equal(accounts.filter(a => a.disabled_at === null).length, 1);
      const disabledAccount = accounts.find(a => a.disabled_at !== null)!;
      assert.equal((await db.query('SELECT 1 FROM sessions WHERE user_id=$1', [disabledAccount.id])).rowCount, 0);
      const loser = pair.find(a => a.id === disabledAccount.id)!;
      await expectError(await loser.session.send('/auth/me'), 401, 'UNAUTHENTICATED');
      const { rows: audits } = await db.query("SELECT actor_id,entity_id FROM audit_logs WHERE details->>'reason'=$1", [`Race ${mode}`]);
      assert.equal(audits.length, 1, 'Only the committed operation has an audit row');
      assert.equal(audits[0].entity_id, disabledAccount.id);
      const successfulActor = pair[responses.findIndex(r => r.status === 200)];
      assert.equal(audits[0].actor_id, successfulActor.id);
      await db.query("UPDATE users SET role='MEMBER' WHERE id=ANY($1::uuid[])", [pair.map(a => a.id)]);
    });
  }

  await t.test('audit insert failure rolls back disable and session revocation; retry commits all three', async () => {
    await db.query("UPDATE users SET role='ADMIN' WHERE id=$1", [admin.id]);
    const target = await register('Rollback target');
    const before = (await db.query('SELECT * FROM sessions WHERE user_id=$1 ORDER BY id', [target.id])).rows;
    assert.ok(before.length > 0);
    const auditCount = (await db.query('SELECT count(*) FROM audit_logs')).rows[0].count;
    // Failure injection is confined to this disposable test schema.
    await db.query(`CREATE FUNCTION reject_test_audit() RETURNS trigger LANGUAGE plpgsql AS $$
      BEGIN RAISE EXCEPTION 'Injected audit failure'; END $$`);
    await db.query('CREATE TRIGGER reject_test_audit BEFORE INSERT ON audit_logs FOR EACH ROW EXECUTE FUNCTION reject_test_audit()');
    try {
      const message = await expectError(await admin.session.write(disable(target.id), 'PATCH', {
        disabled: true, reason: 'Rollback test',
      }), 500, 'INTERNAL_ERROR');
      assert.ok(!message.includes('Injected'));
      assert.equal((await db.query('SELECT disabled_at FROM users WHERE id=$1', [target.id])).rows[0].disabled_at, null);
      assert.deepEqual((await db.query('SELECT * FROM sessions WHERE user_id=$1 ORDER BY id', [target.id])).rows, before);
      assert.equal((await db.query('SELECT count(*) FROM audit_logs')).rows[0].count, auditCount);
      assert.equal((await target.session.send('/auth/me')).status, 200);
    } finally {
      await db.query('DROP TRIGGER reject_test_audit ON audit_logs');
      await db.query('DROP FUNCTION reject_test_audit()');
    }
    assert.equal((await admin.session.write(disable(target.id), 'PATCH', { disabled: true, reason: 'Rollback test' })).status, 200);
    assert.ok((await db.query('SELECT disabled_at FROM users WHERE id=$1', [target.id])).rows[0].disabled_at);
    assert.equal((await db.query('SELECT 1 FROM sessions WHERE user_id=$1', [target.id])).rowCount, 0);
    assert.equal((await db.query("SELECT 1 FROM audit_logs WHERE entity_id=$1 AND action='USER_DISABLED'", [target.id])).rowCount, 1);
    await expectError(await target.session.send('/auth/me'), 401, 'UNAUTHENTICATED');
  });


  const racer = await register('Race bidder');
  const raceCsrf = await racer.session.csrf();
  const adminCsrf = await admin.session.csrf();
  const cancelRequest = (auctionId: string) => admin.session.send(cancel(auctionId), {
    method: 'POST', headers: { 'X-CSRF-Token': adminCsrf },
    body: JSON.stringify({ reason: 'Barrier cancellation' }),
  });
  const bidRequest = (auctionId: string) => racer.session.send(`/auctions/${auctionId}/bids`, {
    method: 'POST', headers: { 'X-CSRF-Token': raceCsrf, 'Idempotency-Key': randomUUID() },
    body: JSON.stringify({ amountVnd: '100' }),
  });

  for (const first of ['bid', 'cancel'] as const) {
    await t.test(`${first} obtains the auction lock before its competitor`, async () => {
      const auctionId = await makeAuction('ACTIVE');
      const locker = await db.connect();
      const pending: Promise<Response>[] = [];
      try {
        await locker.query('BEGIN');
        await locker.query('SELECT id FROM auctions WHERE id=$1 FOR UPDATE', [auctionId]);
        const { rows: [{ pid }] } = await locker.query('SELECT pg_backend_pid() AS pid');
        async function waitForBlocked(expected: number) {
          const deadline = Date.now() + 5000;
          while (Date.now() < deadline) {
            // Follow the blocker chain: the second request can wait on the
            // first request's tuple lock instead of directly on this connection.
            const { rows: [state] } = await db.query(`WITH RECURSIVE blocked(pid) AS (
              SELECT pid FROM pg_stat_activity WHERE $1=ANY(pg_blocking_pids(pid))
              UNION
              SELECT a.pid FROM pg_stat_activity a JOIN blocked b ON b.pid=ANY(pg_blocking_pids(a.pid))
            ) SELECT count(*)::integer AS waiting FROM blocked`, [pid]);
            if (state.waiting === expected) return;
            await setTimeout(10);
          }
          assert.fail(`Expected ${expected} requests in the auction lock queue`);
        }
        pending.push(first === 'bid' ? bidRequest(auctionId) : cancelRequest(auctionId));
        await waitForBlocked(1);
        pending.push(first === 'bid' ? cancelRequest(auctionId) : bidRequest(auctionId));
        await waitForBlocked(2);
        assert.equal(events.filter(e => e.id === auctionId).length, 0, 'No event before lock release/commit');
        await locker.query('COMMIT');
      } finally {
        await locker.query('ROLLBACK');
        locker.release();
        await Promise.allSettled(pending);
      }
      const responses = await Promise.all(pending);
      const acceptedBid = first === 'bid';
      assert.equal(responses[0].status, acceptedBid ? 201 : 200);
      await responses[0].json();
      if (acceptedBid) {
        assert.equal(responses[1].status, 200);
        await responses[1].json();
      } else await expectError(responses[1], 409, 'AUCTION_NOT_ACTIVE');
      const { rows: [state] } = await db.query('SELECT status,version,current_price_vnd,highest_bidder_id FROM auctions WHERE id=$1', [auctionId]);
      assert.deepEqual(state, { status: 'CANCELLED', version: acceptedBid ? 2 : 1,
        current_price_vnd: '100', highest_bidder_id: acceptedBid ? racer.id : null });
      assert.equal((await db.query('SELECT 1 FROM bids WHERE auction_id=$1', [auctionId])).rowCount, acceptedBid ? 1 : 0);
      assert.equal((await db.query("SELECT 1 FROM audit_logs WHERE entity_id=$1 AND action='AUCTION_CANCELLED'", [auctionId])).rowCount, 1);
      assert.equal((await db.query('SELECT 1 FROM auction_results WHERE auction_id=$1', [auctionId])).rowCount, 0);
      const snapshots = events.filter(e => e.id === auctionId).sort((a,b) => a.version-b.version);
      assert.deepEqual(snapshots.map(e => [e.status,e.version]), acceptedBid ? [['ACTIVE',1],['CANCELLED',2]] : [['CANCELLED',1]]);
      await expectError(await bidRequest(auctionId), 409, 'AUCTION_NOT_ACTIVE');
    });
  }

  await t.test('failed cancellation audit restores auction state and emits nothing; retry commits once', async () => {
    const auctionId = await makeAuction('ACTIVE');
    assert.equal((await bidRequest(auctionId)).status, 201);
    const before = (await db.query('SELECT * FROM auctions WHERE id=$1', [auctionId])).rows;
    const beforeBids = (await db.query('SELECT * FROM bids WHERE auction_id=$1', [auctionId])).rows;
    const beforeEvents = [...events];
    await db.query(`CREATE FUNCTION reject_cancel_audit() RETURNS trigger LANGUAGE plpgsql AS $$
      BEGIN RAISE EXCEPTION 'Injected cancel audit failure'; END $$`);
    await db.query('CREATE TRIGGER reject_cancel_audit BEFORE INSERT ON audit_logs FOR EACH ROW EXECUTE FUNCTION reject_cancel_audit()');
    try {
      const message = await expectError(await cancelRequest(auctionId), 500, 'INTERNAL_ERROR');
      assert.ok(!message.includes('Injected'));
      assert.deepEqual((await db.query('SELECT * FROM auctions WHERE id=$1', [auctionId])).rows, before);
      assert.deepEqual((await db.query('SELECT * FROM bids WHERE auction_id=$1', [auctionId])).rows, beforeBids);
      assert.equal((await db.query('SELECT 1 FROM audit_logs WHERE entity_id=$1', [auctionId])).rowCount, 0);
      assert.deepEqual(events, beforeEvents);
    } finally {
      await db.query('DROP TRIGGER reject_cancel_audit ON audit_logs');
      await db.query('DROP FUNCTION reject_cancel_audit()');
    }
    assert.equal((await cancelRequest(auctionId)).status, 200);
    const { rows: [state] } = await db.query('SELECT status,version FROM auctions WHERE id=$1', [auctionId]);
    assert.deepEqual(state, { status: 'CANCELLED', version: before[0].version + 1 });
    assert.equal((await db.query('SELECT 1 FROM audit_logs WHERE entity_id=$1', [auctionId])).rowCount, 1);
    assert.deepEqual(events.slice(beforeEvents.length).map(e => [e.id,e.status,e.version]), [[auctionId,'CANCELLED',state.version]]);
    await expectError(await cancelRequest(auctionId), 409, 'AUCTION_TERMINAL');
    assert.equal(events.length, beforeEvents.length + 1);
  });

});
