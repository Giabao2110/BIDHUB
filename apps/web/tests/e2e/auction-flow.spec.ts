import { randomUUID } from "node:crypto";
import { test, expect, type BrowserContext, type Page } from "@playwright/test";
import pg from "pg";

async function register(page: Page, name: string) {
  const token = randomUUID();
  await page.goto("/register?returnTo=/dashboard");
  await page.getByLabel("Display name", { exact: true }).fill(name);
  await page
    .getByLabel("Email", { exact: true })
    .fill(`${token}@example.invalid`);
  await page.getByLabel("Password", { exact: true }).fill(token);
  await page.getByLabel("Confirm password", { exact: true }).fill(token);
  await page.getByLabel("Confirm password", { exact: true }).press("Enter");
  await expect(page).toHaveURL(/\/dashboard$/);
  return { email: `${token}@example.invalid`, password: token };
}

async function write(context: BrowserContext, path: string, body: object) {
  const csrf = await context.request.get("/api/v1/auth/csrf");
  expect(csrf.ok()).toBeTruthy();
  const { csrfToken } = await csrf.json();
  return context.request.post(`/api/v1${path}`, {
    data: body,
    headers: { "X-CSRF-Token": csrfToken },
  });
}

async function createAuction(context: BrowserContext, suffix: string) {
  const categories = await (
    await context.request.get("/api/v1/categories")
  ).json();
  const response = await write(context, "/auctions", {
    title: `Browser auction ${suffix}`,
    description: "Disposable E2E auction.",
    categoryId: categories.items[0].id,
    imageUrl: null,
    openingPriceVnd: "100000",
    minimumIncrementVnd: "10000",
    startsAt: new Date(Date.now() - 60_000).toISOString(),
    endsAt: new Date(Date.now() + 3_600_000).toISOString(),
  });
  expect(response.status()).toBe(201);
  return (await response.json()).auction;
}

async function fits(page: Page) {
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= window.innerWidth,
    ),
  ).toBe(true);
}

test("seller publishes through the UI and an outbid buyer receives a real 409 without losing input", async ({
  browser,
  page,
  baseURL,
}, testInfo) => {
  const seller = await browser.newContext({
    baseURL,
    viewport: page.viewportSize(),
  });
  const peer = await browser.newContext({
    baseURL,
    viewport: page.viewportSize(),
  });
  try {
    const sellerPage = await seller.newPage();
    const peerPage = await peer.newPage();
    await register(sellerPage, "Test seller");
    await register(page, "First bidder");
    await register(peerPage, "Second bidder");
    const auction = await createAuction(seller, randomUUID().slice(0, 8));
    expect(
      (await page.request.get(`/api/v1/auctions/${auction.id}`)).status(),
    ).toBe(404);
    await sellerPage.goto("/dashboard");
    const row = sellerPage
      .locator(".dashboard-row")
      .filter({ hasText: auction.title });
    await row.getByRole("button", { name: "Publish", exact: true }).click();
    await sellerPage.getByRole("button", { name: "Confirm publish" }).click();
    await expect(
      sellerPage.getByRole("status").filter({ hasText: "Auction published" }),
    ).toBeVisible();
    const path = `/auctions/${auction.id}`;
    await sellerPage.goto(path);
    await expect(
      sellerPage.getByText("You cannot bid on your own auction.", {
        exact: true,
      }),
    ).toBeVisible();
    await page.goto(path);
    await peerPage.goto(path);
    await expect(
      page.getByText("Live updates connected.", { exact: true }),
    ).toBeVisible();
    await page.getByLabel("Bid amount (VND)").fill("100000");
    await peerPage.getByLabel("Bid amount (VND)").fill("100000");
    await page.getByLabel("Bid amount (VND)").press("Enter");
    await expect(
      page.getByText("Bid accepted.", { exact: true }),
    ).toBeVisible();
    await expect(peerPage.locator(".detail-price strong")).toHaveText(
      "100,000 VND",
    );
    const denied = peerPage.waitForResponse(
      (response) =>
        response.request().method() === "POST" &&
        response.url().endsWith(`/api/v1${path}/bids`),
    );
    await peerPage.getByLabel("Bid amount (VND)").press("Enter");
    const rejected = await denied;
    expect(rejected.status()).toBe(409);
    expect((await rejected.json()).error.code).toBe("BID_TOO_LOW");
    await expect(peerPage.getByRole("alert")).toContainText(
      "The auction data or status has changed.",
    );
    await expect(peerPage.getByLabel("Bid amount (VND)")).toHaveValue("100000");
    await peerPage.getByLabel("Bid amount (VND)").fill("110000");
    await peerPage.getByLabel("Bid amount (VND)").press("Enter");
    await expect(
      peerPage.getByText("Bid accepted.", { exact: true }),
    ).toBeVisible();
    await expect(page.locator(".detail-price strong")).toHaveText(
      "110,000 VND",
    );
    const history = await (
      await page.request.get(`/api/v1${path}/bids`)
    ).json();
    expect(history.total).toBe(2);
    expect(
      history.items.map((bid: { amountVnd: string }) => bid.amountVnd),
    ).toEqual(["110000", "100000"]);
    await fits(peerPage);
    await peerPage.screenshot({
      path: testInfo.outputPath("outbid-recovered.png"),
      fullPage: true,
    });
  } finally {
    await seller.close();
    await peer.close();
  }
});

test("late bid extends the deadline and both browsers display the scheduler's persisted result", async ({
  browser,
  page,
  baseURL,
}, testInfo) => {
  const seller = await browser.newContext({
    baseURL,
    viewport: page.viewportSize(),
  });
  const connectionString = process.env.BIDHUB_E2E_DATABASE_URL;
  if (!connectionString)
    throw new Error("The isolated E2E schema was not initialized");
  const db = new pg.Pool({ connectionString });
  try {
    const owner = await seller.newPage();
    await register(owner, "Closing seller");
    await register(page, "Closing winner");
    const auction = await createAuction(seller, randomUUID().slice(0, 8));
    expect(
      (await write(seller, `/auctions/${auction.id}/publish`, {})).status(),
    ).toBe(200);
    // Change only this test-owned fixture's deadline in the isolated schema.
    await db.query(
      "UPDATE auctions SET ends_at=clock_timestamp()+interval '20 seconds' WHERE id=$1",
      [auction.id],
    );
    const path = `/auctions/${auction.id}`;
    await owner.goto(path);
    await page.goto(path);
    await expect(
      owner.getByText("Live updates connected.", { exact: true }),
    ).toBeVisible();
    await page.getByLabel("Bid amount (VND)").fill("100000");
    await page.getByLabel("Bid amount (VND)").press("Enter");
    await expect(
      page.getByText("Bid accepted.", { exact: true }),
    ).toBeVisible();
    const state = await db.query(
      `SELECT a.ends_at >= b.created_at+interval '60 seconds' AS extended, a.version
       FROM auctions a JOIN bids b ON b.auction_id=a.id WHERE a.id=$1`,
      [auction.id],
    );
    expect(state.rows).toEqual([{ extended: true, version: 2 }]);
    // Move the fixture to expiry so the normal scheduler can close it.
    await db.query(
      "UPDATE auctions SET ends_at=clock_timestamp()-interval '1 millisecond' WHERE id=$1",
      [auction.id],
    );
    for (const current of [page, owner]) {
      await expect(
        current.getByText("Closing winner won at 100,000 VND.", {
          exact: true,
        }),
      ).toBeVisible();
      await expect(current.getByLabel("Bid amount (VND)")).toHaveCount(0);
      await fits(current);
    }
    const result = await (
      await page.request.get(`/api/v1${path}/result`)
    ).json();
    expect(result.winner.displayName).toBe("Closing winner");
    expect(result.finalPriceVnd).toBe("100000");
    expect(
      (
        await db.query(
          "SELECT auction_id FROM auction_results WHERE auction_id=$1",
          [auction.id],
        )
      ).rowCount,
    ).toBe(1);
    await page.screenshot({
      path: testInfo.outputPath("persisted-result.png"),
      fullPage: true,
    });
  } finally {
    await db.end();
    await seller.close();
  }
});

test("keyboard access, failed real login and interrupted REST recover without fixture responses", async ({
  page,
}, testInfo) => {
  await page.goto("/auctions");
  await page.keyboard.press("Tab");
  await expect(
    page.getByRole("link", { name: "Skip to main content" }),
  ).toBeFocused();
  await page.keyboard.press("Enter");
  await expect(page.locator("#content")).toBeFocused();
  await page.goto("/login");
  await page
    .getByLabel("Email", { exact: true })
    .fill(`${randomUUID()}@example.invalid`);
  await page
    .getByLabel("Password", { exact: true })
    .fill("disposable-wrong-password");
  await page.getByLabel("Password", { exact: true }).press("Enter");
  await expect(page.getByRole("alert")).toContainText(
    "Incorrect email or password.",
  );
  await fits(page);
  await page.route("**/api/v1/auctions?*", (route) => route.abort());
  await page.goto("/auctions");
  await expect(page.getByRole("alert")).toBeVisible();
  await expect(page.locator(".auction-card")).toHaveCount(0);
  await page.unroute("**/api/v1/auctions?*");
  await page.getByRole("button", { name: "Try again", exact: true }).click();
  await expect(page.getByRole("alert")).toHaveCount(0);
  await expect(page.locator(".listing-meta")).toContainText(/\d+ auctions/);
  await fits(page);
  await page.screenshot({
    path: testInfo.outputPath("rest-recovered.png"),
    fullPage: true,
  });
});
