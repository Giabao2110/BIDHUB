import { randomUUID } from "node:crypto";
import { expect, test, type Page } from "@playwright/test";

// Real HTTP, PostgreSQL and WebSocket traffic; no route interception or fixture responses.
const localDate = (value: Date) =>
  new Date(value.getTime() - value.getTimezoneOffset() * 60_000)
    .toISOString()
    .slice(0, 16);

async function register(page: Page, name: string, returnTo: string) {
  const token = randomUUID();
  await page.goto(`/register?returnTo=${encodeURIComponent(returnTo)}`);
  await page.getByLabel("Display name", { exact: true }).fill(name);
  await page
    .getByLabel("Email", { exact: true })
    .fill(`phu-${token}@example.invalid`);
  await page.getByLabel("Password", { exact: true }).fill(token);
  await page.getByLabel("Confirm password", { exact: true }).fill(token);
  await page
    .getByRole("button", { name: "Create account", exact: true })
    .click();
  await expect(page).toHaveURL(new RegExp(`${returnTo}$`));
}

test("two bidders compete, receive the extended deadline and the official result", async ({
  browser,
  page,
  baseURL,
}, info) => {
  const token = randomUUID().slice(0, 8);
  const title = `Week 7 competition ${token}`;
  const errors: string[] = [];
  const first = await browser.newContext({
    baseURL,
    viewport: { width: 390, height: 844 },
  });
  const second = await browser.newContext({
    baseURL,
    viewport: { width: 360, height: 800 },
  });
  try {
    const bidderA = await first.newPage();
    const bidderB = await second.newPage();
    for (const target of [page, bidderA, bidderB])
      target.on("pageerror", (error) => errors.push(error.message));
    await Promise.all([
      register(page, `Seller ${token}`, "/auctions/new"),
      register(bidderA, `Bidder A ${token}`, "/auctions"),
      register(bidderB, `Bidder B ${token}`, "/auctions"),
    ]);
    await page.getByLabel("Item title").fill(title);
    await page
      .getByLabel("Category", { exact: true })
      .selectOption({ index: 1 });
    await page
      .getByLabel("Description", { exact: true })
      .fill("Disposable real-backend browser acceptance auction.");
    await page.getByLabel("Starting bid (VND)").fill("1000000");
    await page.getByLabel("Bid increment (VND)").fill("100000");
    await page
      .getByLabel("Starts at", { exact: true })
      .fill(localDate(new Date(Date.now() - 60_000)));
    // The seller form uses minute precision. Enter the next full minute, then wait for the late-bid window.
    const originalEnd = new Date(
      Math.ceil((Date.now() + 30_000) / 60_000) * 60_000,
    );
    await page
      .getByLabel("Ends at", { exact: true })
      .fill(localDate(originalEnd));
    await page.getByRole("button", { name: "Save draft", exact: true }).click();
    const row = page.locator(".dashboard-row").filter({ hasText: title });
    const edit = await row
      .getByRole("link", { name: "Edit draft" })
      .getAttribute("href");
    const id = edit?.match(/\/auctions\/([^/]+)\/edit/)?.[1];
    expect(id).toBeTruthy();
    await row.getByRole("button", { name: "Publish", exact: true }).click();
    await page.getByRole("button", { name: "Confirm publish" }).click();
    await expect(
      page.getByRole("status").filter({ hasText: "Auction published" }),
    ).toBeVisible();
    const path = `/auctions/${id}`;
    await Promise.all([
      page.goto(path),
      bidderA.goto(path),
      bidderB.goto(path),
    ]);
    for (const target of [page, bidderA, bidderB])
      await expect(
        target.getByText("Live updates connected.", { exact: true }),
      ).toBeVisible();
    await expect(
      page.getByText("You cannot bid on your own auction."),
    ).toBeVisible();
    await page.waitForTimeout(
      Math.max(0, originalEnd.getTime() - Date.now() - 29_000),
    );
    for (const bidder of [bidderA, bidderB])
      await bidder.getByLabel("Bid amount (VND)").fill("1000000");
    const response = (bidder: Page) =>
      bidder.waitForResponse(
        (reply) =>
          reply.url().endsWith(`${path}/bids`) &&
          reply.request().method() === "POST",
      );
    const [replyA, replyB] = await Promise.all([
      response(bidderA),
      response(bidderB),
      bidderA.getByRole("button", { name: "Place bid", exact: true }).click(),
      bidderB.getByRole("button", { name: "Place bid", exact: true }).click(),
    ]);
    expect([replyA.status(), replyB.status()].sort()).toEqual([201, 409]);
    const nextWinner = replyA.status() === 409 ? bidderA : bidderB;
    await expect(nextWinner.getByRole("alert")).toContainText("latest price");
    await nextWinner.getByLabel("Bid amount (VND)").fill("1100000");
    await nextWinner
      .getByRole("button", { name: "Place bid", exact: true })
      .click();
    await expect(
      nextWinner.getByRole("status").filter({ hasText: "Bid accepted." }),
    ).toBeVisible();
    for (const target of [page, bidderA, bidderB]) {
      await expect(target.locator(".detail-price strong")).toHaveText(
        "1,100,000 VND",
      );
      await expect(
        target.getByText("The auction was extended after a late bid.", {
          exact: false,
        }),
      ).toBeVisible();
      expect(
        await target.evaluate(
          () => document.documentElement.scrollWidth <= innerWidth,
        ),
      ).toBe(true);
    }
    const detail = await (await page.request.get(`/api/v1${path}`)).json();
    expect(Date.parse(detail.auction.endsAt)).toBeGreaterThan(
      originalEnd.getTime(),
    );
    const history = await (
      await page.request.get(`/api/v1${path}/bids`)
    ).json();
    expect(history.total).toBe(2);
    expect(
      new Set(history.items.map((bid: { id: string }) => bid.id)).size,
    ).toBe(2);
    await nextWinner.screenshot({
      path: info.outputPath("live-bid-mobile.png"),
      fullPage: true,
    });
    // Wait for the real lifecycle worker; never infer a winner from the countdown.
    await expect(
      nextWinner.getByText("You won this auction.", { exact: true }),
    ).toBeVisible({ timeout: 80_000 });
    for (const target of [page, bidderA, bidderB]) {
      await expect(
        target.getByRole("heading", { name: "Auction result" }),
      ).toBeVisible();
      await expect(target.getByLabel("Bid amount (VND)")).toHaveCount(0);
    }
    await nextWinner.screenshot({
      path: info.outputPath("official-result-mobile.png"),
      fullPage: true,
    });
    expect(errors).toEqual([]);
  } finally {
    await first.close();
    await second.close();
  }
});
