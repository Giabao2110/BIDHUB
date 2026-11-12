import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import test from 'node:test';
import { expectError, startTestApi } from '../../../test/http.js';
import { publicAuctionExists } from './read.js';

test('HTTP auction reads share guest visibility with rooms, preserve filters and pagination, and scope private reads', async t => {
  const { client, db } = await startTestApi(t);
  const guest = client();
  const seller = client();
  const other = client();
  const register = (browser: ReturnType<typeof client>, name: string) => browser.write('/auth/register', 'POST', {
    email: `${name}@test.invalid`, password: 'local fixture password', displayName: name,
  });
  const sellerResponse = await register(seller, 'seller');
  assert.equal(sellerResponse.status, 201);
  const localCookie = sellerResponse.headers.getSetCookie()[0];
  assert.match(localCookie, /^bidhub_session=/);
  assert.doesNotMatch(localCookie, /; Secure/);
  const { user: owner } = await sellerResponse.json();
  const otherResponse = await register(other, 'other');
  assert.equal(otherResponse.status, 201);
  const { user: admin } = await otherResponse.json();
  await db.query("UPDATE users SET role='ADMIN' WHERE id=$1", [admin.id]);

  const categories = await db.query("INSERT INTO categories(slug,name) VALUES('camera','Cameras'),('audio','Audio') RETURNING id");
  const camera = categories.rows[0].id;
  const audio = categories.rows[1].id;
  async function add(title: string, status: string, wasPublished: boolean, category = camera, sellerId = owner.id, day = '02') {
    const result = await db.query(`INSERT INTO auctions(seller_id,category_id,title,description,status,was_published,
      opening_price_vnd,current_price_vnd,minimum_increment_vnd,starts_at,ends_at,created_at)
      VALUES($1,$2,$3,'A lens',$4,$5,9223372036854775807,9223372036854775807,10,
        '2026-12-01T00:00:00Z',$6,'2026-11-01T00:00:00Z') RETURNING id`,
      [sellerId, category, title, status, wasPublished, `2026-12-${day}T00:00:00Z`]);
    return result.rows[0].id as string;
  }

  const draft = await add('Private draft', 'DRAFT', false);
  const hidden = await add('Private cancelled', 'CANCELLED', false);
  const cancelled = await add('Published cancelled', 'CANCELLED', true);
  const scheduled = await add('Camera scheduled', 'SCHEDULED', true, camera, owner.id, '04');
  const active = await add('CAMERA 20% off', 'ACTIVE', true);
  const ended = await add('Audio ended', 'ENDED', true, audio, admin.id);

  await t.test('visibility and response fields', async () => {
    const response = await guest.send('/auctions');
    assert.equal(response.status, 200);
    const { items, total, page, pageSize } = await response.json();
    const published = [cancelled, scheduled, active, ended].sort().reverse();
    assert.deepEqual(items.map((item: { auction: { id: string } }) => item.auction.id), published);
    assert.deepEqual({ total, page, pageSize }, { total: 4, page: 1, pageSize: 20 });

    const detail = await guest.send('/auctions/' + active);
    assert.equal(detail.status, 200);
    const item = await detail.json();
    assert.deepEqual(Object.keys(item).sort(), ['auction', 'category', 'description', 'imageUrl', 'openingPriceVnd', 'seller', 'startsAt']);
    assert.deepEqual(item.seller, { id: owner.id, displayName: 'seller' });
    assert.deepEqual(item.category, { id: camera, name: 'Cameras' });
    assert.equal(item.imageUrl, null);
    assert.equal(item.auction.currentPriceVnd, '9223372036854775807');
    assert.equal(item.openingPriceVnd, '9223372036854775807');
    assert.equal(item.startsAt, '2026-12-01T00:00:00.000Z');
    assert.match(item.auction.serverTime, /Z$/);

    for (const id of [draft, hidden, randomUUID(), 'invalid']) {
      await expectError(await guest.send('/auctions/' + id), 404, 'NOT_FOUND');
      await expectError(await other.send('/auctions/' + id), 404, 'NOT_FOUND');
    }
    for (const id of [draft, hidden]) {
      const ownerDetail = await seller.send('/auctions/' + id);
      assert.equal(ownerDetail.status, 200);
      assert.equal(ownerDetail.headers.get('cache-control'), 'no-store');
      assert.equal(await publicAuctionExists(db, id), false);
    }
    for (const id of published) {
      assert.equal((await guest.send('/auctions/' + id)).status, 200);
      assert.equal(await publicAuctionExists(db, id), true);
    }
  });

  await t.test('filtering, stable pagination and validation', async () => {
    const filtered = await guest.send(`/auctions?query=camera&categoryId=${camera}&pageSize=1&sort=endingSoon`);
    assert.equal(filtered.status, 200);
    const first = await filtered.json();
    assert.equal(first.items[0].auction.id, active);
    assert.equal(first.total, 2);
    const second = await (await guest.send('/auctions?query=camera&pageSize=1&page=2&sort=endingSoon')).json();
    assert.equal(second.items[0].auction.id, scheduled);
    assert.equal(second.total, 2);
    const past = await (await guest.send('/auctions?query=camera&pageSize=1&page=3')).json();
    assert.deepEqual(past, { items: [], total: 2, page: 3, pageSize: 1 });
    const literal = await (await guest.send('/auctions?query=%25&status=ACTIVE')).json();
    assert.equal(literal.total, 1);
    assert.equal(literal.items[0].auction.id, active);
    for (const search of ['query=%27%20OR%20true%20--', 'status=DRAFT', `categoryId=${randomUUID()}`]) {
      const empty = await (await guest.send('/auctions?' + search)).json();
      assert.deepEqual(empty, { items: [], total: 0, page: 1, pageSize: 20 });
    }
    for (const search of ['sort=DROP%20TABLE', 'page=0', 'pageSize=51', 'status=UNKNOWN', 'categoryId=bad', 'query=a&query=b']) {
      await expectError(await guest.send('/auctions?' + search), 422, 'INVALID_QUERY');
    }
  });

  await t.test('my auctions only returns the current user’s rows', async () => {
    await expectError(await guest.send('/me/auctions'), 401, 'UNAUTHENTICATED');
    const mine = await seller.send('/me/auctions?sellerId=' + admin.id);
    assert.equal(mine.status, 200);
    assert.equal(mine.headers.get('cache-control'), 'no-store');
    const minePage = await mine.json();
    assert.equal(minePage.total, 5);
    assert.deepEqual(minePage.items.map((item: { auction: { id: string } }) => item.auction.id).sort(),
      [draft, hidden, cancelled, scheduled, active].sort());
    const otherPage = await (await other.send('/me/auctions?sellerId=' + owner.id)).json();
    assert.equal(otherPage.total, 1);
    assert.equal(otherPage.items[0].auction.id, ended);
  });
});
