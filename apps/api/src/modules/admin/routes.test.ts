import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import test from 'node:test';
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
});
