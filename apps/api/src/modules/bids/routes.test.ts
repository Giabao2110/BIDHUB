import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import test from 'node:test';
import { expectError, startTestApi } from '../../../test/http.js';
import { processAuctionLifecycle } from '../../jobs/auction-lifecycle.js';
import type { PublicAuctionSnapshot } from '../../realtime/publisher.js';

test('bid HTTP uses session and CSRF, replays concurrent retry, hides private bids and returns the stored winner', async t => {
  const events: PublicAuctionSnapshot[] = [];
  const publish = (auction: PublicAuctionSnapshot) => events.push(auction);
  const { db, client, request } = await startTestApi(t, undefined, publish);
  const seller = client();
  const bidder = client();
  const register = async (agent: ReturnType<typeof client>, name: string) => {
    const response = await agent.write('/auth/register', 'POST', { displayName: name, email: `${randomUUID()}@example.invalid`, password: 'fixture-password' });
    assert.equal(response.status, 201);
    return (await response.json()).user.id as string;
  };
  const sellerId = await register(seller, 'Fixture seller');
  const bidderId = await register(bidder, 'Fixture bidder');
  const categoryId = (await db.query("INSERT INTO categories(slug,name) VALUES ('bid-test','Bid test') RETURNING id")).rows[0].id;
  const makeAuction = async (status: string) => (await db.query(`INSERT INTO auctions
    (seller_id,category_id,title,description,status,opening_price_vnd,current_price_vnd,minimum_increment_vnd,starts_at,ends_at,was_published)
    VALUES ($1,$2,'Fixture auction','Fixture description',$3,100,100,10,clock_timestamp()-interval '1 hour',clock_timestamp()+interval '1 hour',$4)
    RETURNING id`, [sellerId, categoryId, status, status !== 'DRAFT'])).rows[0].id as string;
  const id = await makeAuction('ACTIVE');
  const draftId = await makeAuction('DRAFT');
  const path = `/auctions/${id}/bids`;
  const key = randomUUID();
  const submit = (agent: ReturnType<typeof client>, csrf: string, amount: unknown, requestKey = key, url = path) => agent.send(url, {
    method: 'POST', headers: { 'X-CSRF-Token': csrf, 'Idempotency-Key': requestKey },
    body: JSON.stringify({ amountVnd: amount, bidderId: sellerId }), // caller cannot set bidder identity
  });
  const bidderCsrf = await bidder.csrf();
  await expectError(await request(path, { method: 'POST' }), 401, 'UNAUTHENTICATED');
  await expectError(await submit(bidder, '', '100'), 403, 'INVALID_CSRF');
  await expectError(await submit(seller, await seller.csrf(), '100'), 403, 'SELF_BIDDING');
  await expectError(await submit(bidder, bidderCsrf, '100', key, `/auctions/${draftId}/bids`), 404, 'NOT_FOUND');
  await expectError(await request(`/auctions/${draftId}/bids`), 404, 'NOT_FOUND');
  await expectError(await submit(bidder, bidderCsrf, 100), 422, 'INVALID_INPUT');
  await expectError(await submit(bidder, bidderCsrf, '99'), 409, 'BID_TOO_LOW');
  assert.equal(events.length, 0);

  const accepted = await Promise.all([submit(bidder, bidderCsrf, '100'), submit(bidder, bidderCsrf, '100')]);
  assert.deepEqual(accepted.map(response => response.status).sort(), [200, 201]);
  const [first, replay] = await Promise.all(accepted.map(response => response.json()));
  assert.deepEqual(Object.keys(first).sort(), ['auction', 'bidId']);
  assert.equal(first.bidId, replay.bidId);
  assert.equal(events.length, 1);
  assert.equal(events[0]?.currentPriceVnd, '100');
  const { rows: [stored] } = await db.query('SELECT bidder_id,amount_vnd FROM bids WHERE auction_id=$1', [id]);
  assert.equal(stored.bidder_id, bidderId);
  assert.equal(stored.amount_vnd, '100');
  await expectError(await submit(bidder, bidderCsrf, '110'), 409, 'IDEMPOTENCY_CONFLICT');
  await expectError(await submit(bidder, bidderCsrf, '109', randomUUID()), 409, 'BID_TOO_LOW');

  const history = await (await request(path)).json();
  assert.deepEqual(history.items, [{ id: first.bidId, amountVnd: '100', bidderDisplayName: 'Fixture bidder', createdAt: history.items[0].createdAt }]);
  assert.deepEqual(await (await request(`${path}?page=2&pageSize=1`)).json(), { items: [], total: 1, page: 2, pageSize: 1 });
  await expectError(await request(`/auctions/${id}/result`), 409, 'RESULT_NOT_READY');
  await db.query("UPDATE auctions SET ends_at=clock_timestamp()-interval '1 second' WHERE id=$1", [id]);
  assert.equal(await processAuctionLifecycle(db, publish), 1);
  assert.equal(await processAuctionLifecycle(db, publish), 0);
  const result = await (await request(`/auctions/${id}/result`)).json();
  assert.deepEqual(result, { auctionId: id, winner: { id: bidderId, displayName: 'Fixture bidder' }, finalPriceVnd: '100', closedAt: result.closedAt });
  assert.equal(events.length, 2);
  await expectError(await submit(bidder, bidderCsrf, '110', randomUUID()), 409, 'AUCTION_NOT_ACTIVE');
});
