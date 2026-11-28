import { expect, test, type Page, type Route } from "@playwright/test";
import { contractFixture } from "./api-fixture";

// HTTP responses below are contract fixtures, not proof of PostgreSQL integration.
function problem(
  route: Route,
  status: number,
  code: string,
  headers?: Record<string, string>,
) {
  return route.fulfill({
    status,
    headers,
    json: {
      error: { code, message: "Fixture error", requestId: "week7-test" },
    },
  });
}
async function bidReads(page: Page, id: string) {
  await page.route(`**/api/v1/auctions/${id}/bids?*`, (route) =>
    route.fulfill({ json: { items: [], total: 0, page: 1, pageSize: 20 } }),
  );
}

test("bid validation, stale price recovery and pending guard preserve intent", async ({
  context,
  page,
}) => {
  const api = contractFixture();
  const item = api.records[0]!;
  await api.install(context, api.buyer);
  await bidReads(page, item.auction.id);
  const attempts: { key: string; amount: string }[] = [];
  const accepted = Promise.withResolvers<void>();
  await page.route(
    `**/api/v1/auctions/${item.auction.id}/bids`,
    async (route) => {
      attempts.push({
        key: route.request().headers()["idempotency-key"]!,
        amount: route.request().postDataJSON().amountVnd,
      });
      expect(route.request().headers()["x-csrf-token"]).toBe(
        "contract-test-csrf",
      );
      if (attempts.length === 1) {
        item.auction.currentPriceVnd = "1100000";
        item.auction.version++;
        return problem(route, 409, "BID_TOO_LOW");
      }
      await accepted.promise;
      return route.fulfill({
        json: { bidId: "accepted", auction: item.auction },
      });
    },
  );
  await page.goto(`/auctions/${item.auction.id}`);
  await expect(
    page.getByText("Opening bid: 1,000,000 VND or more.", { exact: false }),
  ).toBeVisible();
  const input = page.getByLabel("Bid amount (VND)");
  await input.fill("1.5");
  await page.getByRole("button", { name: "Place bid", exact: true }).click();
  await expect(page.getByRole("alert")).toContainText("positive whole VND");
  expect(attempts).toHaveLength(0);
  await input.fill("1000000");
  await page.getByRole("button", { name: "Place bid", exact: true }).click();
  await expect(page.getByRole("alert")).toContainText("latest price");
  await expect(page.locator(".detail-price strong")).toHaveText(
    "1,100,000 VND",
  );
  await expect(input).toHaveValue("1000000");
  await input.fill("1200000");
  await page.getByRole("button", { name: "Place bid", exact: true }).click();
  await expect(
    page.getByRole("button", { name: "Submitting…" }),
  ).toBeDisabled();
  await input.press("Enter");
  expect(attempts).toHaveLength(2);
  expect(attempts[0]!.key).not.toBe(attempts[1]!.key);
  accepted.resolve();
  await expect(
    page.getByRole("status").filter({ hasText: "Bid accepted." }),
  ).toBeVisible();
});

test("lost bid response retries the original amount and key after auction closure", async ({
  context,
  page,
}) => {
  const api = contractFixture();
  const item = api.records[0]!;
  await api.install(context, api.buyer);
  await bidReads(page, item.auction.id);
  const keys: string[] = [];
  await page.route(`**/api/v1/auctions/${item.auction.id}/result`, (route) =>
    route.fulfill({
      json: {
        winner: null,
        finalPriceVnd: null,
        closedAt: new Date().toISOString(),
      },
    }),
  );
  await page.route(`**/api/v1/auctions/${item.auction.id}/bids`, (route) => {
    keys.push(route.request().headers()["idempotency-key"]!);
    expect(route.request().postDataJSON()).toEqual({ amountVnd: "1000000" });
    if (keys.length === 1) {
      item.auction.status = "ENDED";
      item.auction.version++;
      return route.abort("failed");
    }
    return route.fulfill({
      json: { bidId: "original-receipt", auction: item.auction },
    });
  });
  await page.goto(`/auctions/${item.auction.id}`);
  await page.getByLabel("Bid amount (VND)").fill("1000000");
  await page.getByRole("button", { name: "Place bid", exact: true }).click();
  await expect(page.getByRole("alert")).toContainText("could not be confirmed");
  await expect(page.getByLabel("Bid amount (VND)")).toBeDisabled();
  await expect(
    page.getByRole("heading", { name: "Auction result" }),
  ).toBeVisible();
  await page.getByRole("button", { name: "Retry same bid" }).click();
  await expect(
    page.getByRole("status").filter({ hasText: "Bid accepted." }),
  ).toBeVisible();
  expect(keys).toHaveLength(2);
  expect(keys[0]).toMatch(/^[\da-f-]{36}$/);
  expect(keys[0]).toBe(keys[1]);
  await expect(page.getByLabel("Bid amount (VND)")).toHaveCount(0);
});

test("rate limit respects Retry-After and retains the same bid key", async ({
  context,
  page,
}) => {
  const api = contractFixture();
  const item = api.records[0]!;
  await api.install(context, api.buyer);
  await bidReads(page, item.auction.id);
  const keys: string[] = [];
  await page.route(`**/api/v1/auctions/${item.auction.id}/bids`, (route) => {
    keys.push(route.request().headers()["idempotency-key"]!);
    return keys.length === 1
      ? problem(route, 429, "RATE_LIMITED", { "Retry-After": "2" })
      : route.fulfill({ json: { bidId: "rate-retry" } });
  });
  await page.clock.install();
  await page.goto(`/auctions/${item.auction.id}`);
  await page.getByLabel("Bid amount (VND)").fill("1000000");
  await page.getByRole("button", { name: "Place bid", exact: true }).click();
  await expect(
    page.getByRole("button", { name: "Try again in 2s" }),
  ).toBeDisabled();
  await page.clock.runFor(2100);
  await page.getByRole("button", { name: "Retry same bid" }).click();
  await expect(
    page.getByRole("status").filter({ hasText: "Bid accepted." }),
  ).toBeVisible();
  expect(keys).toHaveLength(2);
  expect(keys[1]).toBe(keys[0]);
});

test("revoked session removes bid controls instead of reporting success", async ({
  context,
  page,
}) => {
  const api = contractFixture();
  const item = api.records[0]!;
  await api.install(context, api.buyer);
  await bidReads(page, item.auction.id);
  await page.route(`**/api/v1/auctions/${item.auction.id}/bids`, (route) => {
    api.expire = true;
    return problem(route, 401, "UNAUTHENTICATED");
  });
  await page.goto(`/auctions/${item.auction.id}`);
  await page.getByLabel("Bid amount (VND)").fill("1000000");
  await page.getByRole("button", { name: "Place bid", exact: true }).click();
  await expect(
    page.getByRole("link", { name: "Sign in to bid" }),
  ).toBeVisible();
  await expect(page.getByLabel("Bid amount (VND)")).toHaveCount(0);
  await expect(page.getByText("Bid accepted.", { exact: true })).toHaveCount(0);
});

test("official result errors can recover; winner, unsold and cancelled states stay distinct", async ({
  context,
  page,
}) => {
  const api = contractFixture();
  const item = api.records[0]!;
  item.auction.status = "ENDED";
  await api.install(context, api.buyer);
  await bidReads(page, item.auction.id);
  let resultError = true;
  let winner = true;
  let reads = 0;
  await page.route(`**/api/v1/auctions/${item.auction.id}/result`, (route) => {
    reads++;
    return resultError
      ? problem(route, 409, "RESULT_NOT_READY")
      : route.fulfill({
          json: {
            winner: winner ? api.buyer : null,
            finalPriceVnd: winner ? "1000000" : null,
            closedAt: new Date().toISOString(),
          },
        });
  });
  await page.goto(`/auctions/${item.auction.id}`);
  await expect(page.getByRole("alert")).toContainText(
    "official result is not available",
  );
  await expect(page.getByText("No winning bid.")).toHaveCount(0);
  resultError = false;
  await page.getByRole("button", { name: "Retry loading result" }).click();
  await expect(
    page.getByText("You won this auction.", { exact: true }),
  ).toBeVisible();
  await expect(page.getByLabel("Bid amount (VND)")).toHaveCount(0);
  winner = false;
  await page.reload();
  await expect(
    page.getByText("No winning bid.", { exact: true }),
  ).toBeVisible();
  item.auction.status = "CANCELLED";
  const beforeCancel = reads;
  await page.reload();
  await expect(
    page.getByText("This auction was cancelled and cannot accept bids."),
  ).toBeVisible();
  await expect(
    page.getByRole("heading", { name: "Auction result" }),
  ).toHaveCount(0);
  expect(reads).toBe(beforeCancel);
});

test("my bids handles pagination, official result links, errors and session expiry", async ({
  context,
  page,
}) => {
  const api = contractFixture();
  await api.install(context, api.buyer);
  let failure = false;
  await page.route("**/api/v1/me/bids?*", (route) => {
    if (api.expire) return problem(route, 401, "UNAUTHENTICATED");
    if (failure) return problem(route, 503, "UNAVAILABLE");
    const page = Number(
      new URL(route.request().url()).searchParams.get("page"),
    );
    return route.fulfill({
      json: {
        items:
          page === 1
            ? [
                {
                  id: "my-bid",
                  amountVnd: "1000000",
                  createdAt: new Date().toISOString(),
                  auctionId: api.records[0]!.auction.id,
                  auctionTitle: "My ended auction",
                  auctionStatus: "ENDED",
                },
              ]
            : [],
        total: 21,
        page,
        pageSize: 20,
      },
    });
  });
  await page.goto("/dashboard/bids");
  await expect(
    page.getByRole("link", { name: "View official result" }),
  ).toBeVisible();
  await page.getByRole("button", { name: "Next page" }).click();
  await expect(page).toHaveURL(/page=2/);
  await expect(page.getByText("No bids on this page.")).toBeVisible();
  await page.getByRole("button", { name: "Previous page" }).click();
  failure = true;
  await page.reload();
  await expect(
    page.getByRole("heading", { name: "Unable to load data" }),
  ).toBeVisible();
  failure = false;
  await page.getByRole("button", { name: "Try again", exact: true }).click();
  await expect(
    page.getByRole("link", { name: "My ended auction", exact: true }),
  ).toBeVisible();
  api.expire = true;
  await page.reload();
  await expect(page).toHaveURL(/\/login\?returnTo=/);
});

test("seller confirmation traps focus, cancels on Escape and returns focus without a write", async ({
  context,
  page,
}) => {
  const api = contractFixture();
  api.record("Keyboard draft", api.seller, "DRAFT");
  await api.install(context, api.seller);
  await page.goto("/dashboard?page=2");
  const trigger = page.getByRole("button", { name: "Publish", exact: true });
  await trigger.focus();
  await page.keyboard.press("Enter");
  const dialog = page.getByRole("dialog", { name: "Publish this auction?" });
  await expect(dialog).toBeVisible();
  await expect(page.getByRole("button", { name: "Keep draft" })).toBeFocused();
  await page.keyboard.press("Tab");
  await expect(
    page.getByRole("button", { name: "Confirm publish" }),
  ).toBeFocused();
  await page.keyboard.press("Escape");
  await expect(dialog).toHaveCount(0);
  await expect(trigger).toBeFocused();
  expect(api.writes).toHaveLength(0);
});

test("admin moderation requires a reason, handles last-admin errors and updates only after confirmation", async ({
  context,
  page,
}, info) => {
  const api = contractFixture();
  api.seller.role = "ADMIN";
  await api.install(context, api.seller);
  let fail = true;
  const writes: object[] = [];
  await page.route("**/api/v1/admin/users/lookup", (route) =>
    route.fulfill({ json: { items: [{ ...api.buyer, disabled: false }] } }),
  );
  await page.route(`**/api/v1/admin/users/${api.buyer.id}`, (route) => {
    writes.push(route.request().postDataJSON());
    return fail
      ? problem(route, 409, "LAST_ADMIN")
      : route.fulfill({ json: { user: { id: api.buyer.id, disabled: true } } });
  });
  await page.goto("/admin");
  await page.getByLabel("Account email").fill(api.buyer.email);
  await page.getByRole("button", { name: "Find account" }).click();
  const trigger = page.getByRole("button", {
    name: "Disable account",
    exact: true,
  });
  await trigger.click();
  await expect(page.getByLabel("Reason", { exact: true })).toBeFocused();
  const confirm = page.getByRole("button", { name: "Confirm disable account" });
  await expect(confirm).toBeDisabled();
  await page
    .getByLabel("Reason", { exact: true })
    .fill("Review fixture account");
  await confirm.click();
  await expect(page.getByRole("alert")).toContainText(
    "last active administrator",
  );
  await expect(
    page.getByText("Account disabled.", { exact: false }),
  ).toHaveCount(0);
  expect(writes).toEqual([
    { disabled: true, reason: "Review fixture account" },
  ]);
  await page.evaluate(() => document.fonts.ready);
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= innerWidth,
    ),
  ).toBe(true);
  await page.screenshot({
    path: info.outputPath(`moderation-${info.project.name}.png`),
    fullPage: true,
  });
  await page.keyboard.press("Escape");
  await expect(trigger).toBeFocused();
  await trigger.click();
  await page
    .getByLabel("Reason", { exact: true })
    .fill("Confirmed fixture action");
  fail = false;
  await confirm.click();
  await expect(
    page.getByRole("status").filter({ hasText: "Account disabled." }),
  ).toBeVisible();
  await expect(page.getByRole("dialog")).toHaveCount(0);
});
