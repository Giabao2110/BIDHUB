import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { chromium } from 'playwright';

if (process.env.BIDHUB_ALLOW_AUTH_SMOKE_WRITE !== '1') throw new Error('Auction smoke requires explicit disposable database opt-in');
const adminPassword = process.env.BIDHUB_ADMIN_SMOKE_PASSWORD;
if (!adminPassword) throw new Error('Auction smoke requires the disposable demo admin password');
const origin = new URL(process.env.WEB_ORIGIN ?? 'http://localhost:8080');
if (!['localhost', '127.0.0.1'].includes(origin.hostname)) throw new Error('Auction smoke requires a loopback endpoint');
const browser = await chromium.launch({ channel: process.env.PLAYWRIGHT_CHANNEL || undefined });
const localInput = date => new Date(date.getTime() - date.getTimezoneOffset() * 60_000).toISOString().slice(0, 16);
try {
  const seller = await browser.newContext({ baseURL: origin.origin });
  const visitor = await browser.newContext({ baseURL: origin.origin });
  const page = await seller.newPage();
  page.setDefaultTimeout(10_000);
  await page.goto('/register?returnTo=/auctions/new');
  const token = randomUUID();
  await page.getByLabel('Display name', { exact: true }).fill('CI seller browser');
  await page.getByLabel('Email', { exact: true }).fill(`auction-${token}@example.invalid`);
  await page.getByLabel('Password', { exact: true }).fill(token);
  await page.getByLabel('Confirm password', { exact: true }).fill(token);
  await page.getByRole('button', { name: 'Create account', exact: true }).click();
  await page.waitForURL('**/auctions/new');

  const title = `CI auction ${token.slice(0, 8)}`;
  await page.getByLabel('Item title').fill(title);
  await page.getByLabel('Category', { exact: true }).selectOption({ label: 'CI recovery' });
  await page.getByLabel('Description', { exact: true }).fill('A disposable auction used to verify the seller flow in CI.');
  await page.getByLabel('Starting bid (VND)').fill('1500000');
  await page.getByLabel('Bid increment (VND)').fill('100000');
  await page.getByLabel('Starts at', { exact: true }).fill(localInput(new Date(Date.now() - 60_000)));
  await page.getByLabel('Ends at', { exact: true }).fill(localInput(new Date(Date.now() + 86_400_000)));
  await page.getByRole('button', { name: 'Save draft', exact: true }).click();
  await page.waitForURL('**/dashboard?notice=saved');
  const row = page.locator('.dashboard-row').filter({ hasText: title });
  const edit = await row.getByRole('link', { name: 'Edit draft' }).getAttribute('href');
  const id = edit?.match(/^\/auctions\/([\w-]+)\/edit$/)?.[1];
  assert.ok(id, 'seller dashboard should link to persisted draft');
  const path = `/api/v1/auctions/${id}`;
  assert.equal((await visitor.request.get(path)).status(), 404);

  await row.getByRole('button', { name: 'Publish', exact: true }).click();
  await page.getByRole('button', { name: 'Confirm publish' }).click();
  await page.getByRole('status').filter({ hasText: 'Auction published' }).waitFor();
  const publicResponse = await visitor.request.get(path);
  assert.equal(publicResponse.status(), 200);
  assert.equal((await publicResponse.json()).auction.status, 'ACTIVE');

  const buyerPage = await visitor.newPage();
  buyerPage.setDefaultTimeout(10_000);
  await buyerPage.goto(`/auctions?query=${encodeURIComponent(title)}`);
  await buyerPage.getByRole('link', { name: title, exact: true }).click();
  await buyerPage.getByRole('heading', { name: title, exact: true, level: 1 }).waitFor();
  await buyerPage.getByText('Live updates connected.', { exact: true }).waitFor();

  await page.goto(`/auctions/${id}`);
  await page.getByText('Live updates connected.', { exact: true }).waitFor();
  await buyerPage.goto(`/register?returnTo=${encodeURIComponent(`/auctions/${id}`)}`);
  const bidToken = randomUUID();
  await buyerPage.getByLabel('Display name', { exact: true }).fill('CI browser bidder');
  await buyerPage.getByLabel('Email', { exact: true }).fill(`bid-${bidToken}@example.invalid`);
  await buyerPage.getByLabel('Password', { exact: true }).fill(bidToken);
  await buyerPage.getByLabel('Confirm password', { exact: true }).fill(bidToken);
  await buyerPage.getByRole('button', { name: 'Create account', exact: true }).click();
  await buyerPage.waitForURL(`**/auctions/${id}`);

  const attempts = [];
  await buyerPage.route(`${origin.origin}${path}/bids`, async route => {
    if (route.request().method() !== 'POST') return route.continue();
    const response = await route.fetch();
    attempts.push({ key: route.request().headers()['idempotency-key'], status: response.status() });
    // Commit the first bid on the real server, but lose its response at the browser.
    if (attempts.length === 1) return route.abort();
    await route.fulfill({ response });
  });
  await buyerPage.getByLabel('Bid amount (VND)').fill('1700000');
  await buyerPage.getByRole('button', { name: 'Place bid', exact: true }).click();
  await buyerPage.getByRole('alert').filter({ hasText: 'Bid could not be confirmed' }).waitFor();
  await page.locator('.detail-price strong').filter({ hasText: '1,700,000 VND' }).waitFor();
  await buyerPage.getByRole('button', { name: 'Retry same bid', exact: true }).click();
  await buyerPage.getByRole('status').filter({ hasText: 'Bid accepted.' }).waitFor();
  assert.equal(attempts.length, 2);
  assert.ok(attempts[0].key);
  assert.deepEqual(attempts, [{ key: attempts[0].key, status: 201 }, { key: attempts[0].key, status: 200 }]);
  const history = await (await visitor.request.get(`${path}/bids`)).json();
  assert.equal(history.total, 1);
  assert.equal(history.items[0].amountVnd, '1700000');

  await buyerPage.goto('/dashboard');
  await buyerPage.getByRole('link', { name: 'My bids', exact: true }).click();
  await buyerPage.getByRole('heading', { name: 'My bids', exact: true }).waitFor();
  await buyerPage.getByRole('link', { name: title, exact: true }).waitFor();
  assert.equal(await buyerPage.locator('.dashboard-row').count(), 1);
  await buyerPage.goto('/admin');
  await buyerPage.getByRole('heading', { name: 'Administrator access required' }).waitFor();

  const admin = await browser.newContext({ baseURL: origin.origin, viewport: { width: 390, height: 844 } });
  const adminPage = await admin.newPage();
  adminPage.setDefaultTimeout(10_000);
  await adminPage.goto('/admin');
  await adminPage.waitForURL('**/login?*');
  await adminPage.getByLabel('Email', { exact: true }).fill('admin@demo.bidhub.invalid');
  await adminPage.getByLabel('Password', { exact: true }).fill(adminPassword);
  await adminPage.getByRole('button', { name: 'Sign in', exact: true }).click();
  await adminPage.getByRole('heading', { name: 'Moderation', exact: true }).waitFor();
  await adminPage.getByLabel('Auction title or ID').fill(title);
  await adminPage.getByRole('button', { name: 'Find auctions' }).click();
  await adminPage.getByRole('button', { name: 'Cancel auction', exact: true }).click();
  await adminPage.getByLabel('Reason').fill('Disposable browser cancellation');
  await adminPage.getByRole('button', { name: 'Confirm cancel auction' }).click();
  await adminPage.getByRole('status').filter({ hasText: 'Auction cancelled.' }).waitFor();
  await page.getByText('This auction was cancelled and cannot accept bids.', { exact: true }).waitFor();

  await adminPage.getByLabel('Account email').fill(`bid-${bidToken}@example.invalid`);
  await adminPage.getByRole('button', { name: 'Find account' }).click();
  await adminPage.getByRole('button', { name: 'Disable account', exact: true }).click();
  await adminPage.getByLabel('Reason').fill('Disposable session revocation');
  await adminPage.getByRole('button', { name: 'Confirm disable account' }).click();
  await adminPage.getByRole('status').filter({ hasText: 'Account disabled.' }).waitFor();
  assert.equal((await visitor.request.get('/api/v1/me/bids')).status(), 401);
  await buyerPage.goto('/dashboard/bids');
  await buyerPage.waitForURL('**/login?*');
  assert.equal(await adminPage.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth), true);
  // Read the seeded sold and unsold results from the real API.
  await page.goto('/auctions/d3000000-0000-4000-8000-000000000104');
  await page.getByText('Demo Bidder won at 120,000 VND.', { exact: true }).waitFor();
  await page.goto('/auctions/d3000000-0000-4000-8000-000000000106');
  await page.getByText('No winning bid.', { exact: true }).waitFor();

  console.log('Browser auction smoke passed: publish, idempotent UI bid, realtime price/cancellation, personal bids, moderation and sold/unsold results');
} finally { await browser.close(); }
