import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import test from 'node:test';
import { expectError, startTestApi } from '../../../test/http.js';
import { publicAuctionExists } from './read.js';

test('HTTP auction writes validate input and enforce owner-only draft transitions', async t => {
  const { client, db } = await startTestApi(t);
  const guest = client();
  const owner = client();
  const other = client();
  const register = (browser: ReturnType<typeof client>, name: string) => browser.write('/auth/register', 'POST', {
    email: `${name}@test.invalid`, password: 'local fixture password', displayName: name,
  });
  const ownerResponse = await register(owner, 'owner');
  assert.equal(ownerResponse.status, 201);
  const { user: seller } = await ownerResponse.json();
  const otherResponse = await register(other, 'other');
  assert.equal(otherResponse.status, 201);
  const { user: admin } = await otherResponse.json();
  await db.query("UPDATE users SET role='ADMIN' WHERE id=$1", [admin.id]);

  const categoryId = (await db.query("INSERT INTO categories(slug,name) VALUES('books','Books') RETURNING id")).rows[0].id;
  const now: Date = (await db.query('SELECT clock_timestamp() AS now')).rows[0].now;
  const at = (hours: number) => new Date(now.getTime() + hours * 3_600_000).toISOString();
  const input = {
    title: ' Vintage atlas ', description: ' Original binding ', categoryId, imageUrl: null,
    openingPriceVnd: '9007199254740993', minimumIncrementVnd: '1000', startsAt: at(1), endsAt: at(2),
  };

  async function create(overrides: Record<string, unknown> = {}) {
    const response = await owner.write('/auctions', 'POST', { ...input, ...overrides });
    assert.equal(response.status, 201, response.status === 201 ? undefined : await response.text());
    const { auction } = await response.json();
    return auction;
  }

  await t.test('rejects anonymous writes, invalid CSRF, invalid input and missing categories', async () => {
    await expectError(await guest.write('/auctions', 'POST', input), 401, 'UNAUTHENTICATED');
    await expectError(await owner.send('/auctions', { method: 'POST', body: JSON.stringify(input) }), 403, 'INVALID_CSRF');
    for (const changes of [
      { sellerId: admin.id }, { title: ' ' }, { description: 'contains\0null' }, { imageUrl: 'javascript:alert(1)' },
      { openingPriceVnd: 1000 }, { minimumIncrementVnd: '9223372036854775808' },
      { startsAt: '2026-02-30T00:00:00Z' }, { startsAt: '2026-12-01T00:00:00+07:00' }, { endsAt: at(0) },
    ]) {
      await expectError(await owner.write('/auctions', 'POST', { ...input, ...changes }), 422, 'INVALID_INPUT');
    }
    await expectError(await owner.write('/auctions', 'POST', { ...input, categoryId: randomUUID() }), 422, 'INVALID_CATEGORY');
    assert.equal((await db.query('SELECT 1 FROM auctions')).rowCount, 0);
  });

  await t.test('creates, edits and publishes a scheduled auction with owner checks', async () => {
    const draft = await create();
    const path = '/auctions/' + draft.id;
    assert.equal(draft.title, 'Vintage atlas');
    assert.equal(draft.status, 'DRAFT');
    assert.equal(draft.currentPriceVnd, input.openingPriceVnd);
    assert.equal(draft.version, 0);
    const persisted = (await db.query('SELECT seller_id,was_published FROM auctions WHERE id=$1', [draft.id])).rows[0];
    assert.deepEqual(persisted, { seller_id: seller.id, was_published: false });
    await expectError(await guest.send(path), 404, 'NOT_FOUND');
    assert.equal((await owner.send(path)).status, 200);

    await expectError(await other.write(path, 'PATCH', { title: 'Other' }), 403, 'FORBIDDEN');
    await expectError(await other.write(path, 'DELETE'), 403, 'FORBIDDEN');
    await expectError(await other.write(path + '/publish', 'POST'), 403, 'FORBIDDEN');
    await expectError(await owner.write(path, 'PATCH', { endsAt: at(0) }), 422, 'INVALID_INPUT');
    await expectError(await owner.write(path, 'PATCH', { categoryId: randomUUID() }), 422, 'INVALID_CATEGORY');

    const edited = await owner.write(path, 'PATCH', { openingPriceVnd: '9223372036854775807', imageUrl: 'https://example.invalid/atlas.jpg' });
    assert.equal(edited.status, 200);
    const { auction: afterEdit } = await edited.json();
    assert.equal(afterEdit.currentPriceVnd, '9223372036854775807');
    assert.equal(afterEdit.version, 1);
    const detail = await (await owner.send(path)).json();
    assert.equal(detail.startsAt, input.startsAt);
    assert.equal(detail.description, 'Original binding');
    assert.equal(detail.imageUrl, 'https://example.invalid/atlas.jpg');

    const published = await owner.write(path + '/publish', 'POST');
    assert.equal(published.status, 200);
    const { auction } = await published.json();
    assert.equal(auction.status, 'SCHEDULED');
    assert.equal(auction.version, 2);
    assert.ok(new Date(auction.serverTime) < new Date(input.startsAt));
    assert.equal((await guest.send(path)).status, 200);
    assert.equal(await publicAuctionExists(db, draft.id), true);
    const list = await (await guest.send('/auctions?status=SCHEDULED')).json();
    assert.deepEqual(list.items.map((item: { auction: { id: string } }) => item.auction.id), [draft.id]);

    await expectError(await owner.write(path, 'PATCH', { openingPriceVnd: '1000' }), 409, 'AUCTION_NOT_DRAFT');
    await expectError(await owner.write(path, 'DELETE'), 409, 'AUCTION_NOT_DRAFT');
    await expectError(await owner.write(path + '/publish', 'POST'), 409, 'AUCTION_NOT_DRAFT');
    const publicRow = (await db.query('SELECT version,was_published FROM auctions WHERE id=$1', [draft.id])).rows[0];
    assert.deepEqual(publicRow, { version: 2, was_published: true });
  });

  await t.test('serializes concurrent publish and checks the database deadline', async () => {
    const live = await create({ startsAt: at(-1), endsAt: at(1) });
    const path = `/auctions/${live.id}/publish`;
    const responses = await Promise.all([owner.write(path, 'POST'), owner.write(path, 'POST')]);
    assert.deepEqual(responses.map(response => response.status).sort(), [200, 409]);
    for (const response of responses) {
      if (response.status === 200) {
        const { auction } = await response.json();
        assert.equal(auction.status, 'ACTIVE');
        assert.equal(auction.version, 1);
      } else {
        await expectError(response, 409, 'AUCTION_NOT_DRAFT');
      }
    }

    const expired = await create({ startsAt: at(-2), endsAt: at(-1) });
    await expectError(await owner.write(`/auctions/${expired.id}/publish`, 'POST'), 422, 'INVALID_AUCTION_TIME');
    const row = (await db.query('SELECT status,version,was_published FROM auctions WHERE id=$1', [expired.id])).rows[0];
    assert.deepEqual(row, { status: 'DRAFT', version: 0, was_published: false });
  });

  await t.test('deletes a draft and rejects expired or disabled identities', async () => {
    const removable = await create();
    const path = '/auctions/' + removable.id;
    const deleted = await owner.write(path, 'DELETE');
    assert.equal(deleted.status, 204);
    assert.equal(await deleted.text(), '');
    await expectError(await owner.send(path), 404, 'NOT_FOUND');
    await expectError(await owner.write(path, 'DELETE'), 404, 'NOT_FOUND');
    await expectError(await owner.write('/auctions/invalid/publish', 'POST'), 404, 'NOT_FOUND');

    await db.query("UPDATE sessions SET expires_at=clock_timestamp()-interval '1 second' WHERE user_id=$1", [seller.id]);
    await expectError(await owner.write('/auctions', 'POST', input), 401, 'UNAUTHENTICATED');
    assert.equal((await owner.write('/auth/login', 'POST', { email: seller.email, password: 'local fixture password' })).status, 200);
    await db.query('UPDATE users SET disabled_at=clock_timestamp() WHERE id=$1', [seller.id]);
    await expectError(await owner.write('/auctions', 'POST', input), 401, 'UNAUTHENTICATED');
  });
});
