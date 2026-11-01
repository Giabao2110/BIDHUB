import test from 'node:test';
import assert from 'node:assert/strict';
import { scenarios, acceptedBid, bidTooLow, serverTime } from './auctions.js';

const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;
function money(value: string) {
  assert.match(value, /^[1-9][0-9]*$/);
  assert.ok(BigInt(value) <= 9223372036854775807n);
}
function utc(value: string) {
  assert.equal(new Date(value).toISOString(), value);
  assert.ok(value.endsWith('Z'));
}

test('mock scenarios cover all five statuses with coherent UUID, VND, UTC and lifecycle values', () => {
  assert.deepEqual([...new Set(scenarios.map(s => s.response.auction.status))].sort(), ['ACTIVE', 'CANCELLED', 'DRAFT', 'ENDED', 'SCHEDULED']);
  assert.equal(new Set(scenarios.map(s => s.response.auction.id)).size, scenarios.length);
  for (const s of scenarios) {
    const a = s.response.auction;
    for (const id of [a.id, s.response.seller.id, s.response.category.id]) assert.match(id, uuid);
    for (const value of [s.openingPriceVnd, a.currentPriceVnd, a.minimumIncrementVnd]) money(value);
    for (const value of [s.startsAt, a.endsAt, a.serverTime]) utc(value);
    assert.equal(a.serverTime, serverTime);
    assert.ok(Number.isInteger(a.version) && a.version >= 0);
    assert.ok(s.startsAt < a.endsAt);
    assert.ok(BigInt(a.currentPriceVnd) >= BigInt(s.openingPriceVnd));
    if (a.status === 'SCHEDULED') assert.ok(s.startsAt > serverTime);
    if (a.status === 'ACTIVE') assert.ok(s.startsAt <= serverTime && serverTime < a.endsAt);
    if (a.status === 'ENDED') assert.ok(a.endsAt <= serverTime);
    if (a.status === 'DRAFT') assert.equal(s.audience, 'owner');
    for (const bid of s.history) {
      assert.match(bid.id, uuid); money(bid.amountVnd); utc(bid.createdAt);
      assert.ok(s.startsAt <= bid.createdAt && bid.createdAt < a.endsAt);
      assert.ok(bid.createdAt <= serverTime);
    }
    if (!s.history.length) assert.equal(a.currentPriceVnd, s.openingPriceVnd);
    else assert.equal(s.history[0].amountVnd, a.currentPriceVnd);
  }
});

test('ended winner and no-bid responses are consistent; pending/cancelled have no invented result', () => {
  for (const s of scenarios) {
    const a = s.response.auction;
    if (a.status !== 'ENDED') { assert.equal(s.result, null); continue; }
    assert.ok(s.result);
    assert.equal(s.result.auctionId, a.id);
    utc(s.result.closedAt);
    assert.ok(a.endsAt <= s.result.closedAt && s.result.closedAt <= serverTime);
    if (s.result.winner === null) {
      assert.equal(s.history.length, 0); assert.equal(s.result.finalPriceVnd, null);
    } else {
      assert.match(s.result.winner.id, uuid);
      assert.notEqual(s.result.winner.id, s.response.seller.id);
      assert.equal(s.result.winner.displayName, s.history[0]?.bidderDisplayName);
      assert.equal(s.result.finalPriceVnd, a.currentPriceVnd);
    }
  }
});

test('public responses exclude sensitive fields and bid/error examples reference valid scenarios', () => {
  const forbidden = /^(email|password_?hash|token_?hash|sessionToken|csrfToken|ip|idempotency_?key|bidderId)$/i;
  function inspect(value: unknown) {
    if (!value || typeof value !== 'object') return;
    for (const [key, child] of Object.entries(value)) { assert.ok(!forbidden.test(key), key); inspect(child); }
  }
  for (const s of scenarios) inspect({ ...s.response, history: s.history, result: s.result });
  assert.equal(acceptedBid.bidId, scenarios[2].history[0].id);
  assert.deepEqual(acceptedBid.auction, { ...scenarios[2].response.auction, serverTime: scenarios[2].history[0].createdAt });
  assert.match(bidTooLow.error.requestId, uuid);
  assert.equal(bidTooLow.error.code, 'BID_TOO_LOW');
});
