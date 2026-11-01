import { expect, test, type Page } from "@playwright/test";
import { contractFixture } from "./api-fixture";

async function login(page: Page, email = "seller@example.test") {
  await page.getByLabel("Email", { exact: true }).fill(email);
  await page.getByLabel("Password", { exact: true }).fill("Goodpass123");
  await page.getByRole("button", { name: "Sign in", exact: true }).click();
}
async function fillDraft(page: Page) {
  await page.getByLabel("Item title").fill("Phu's camera");
  await page
    .getByLabel("Category", { exact: true })
    .selectOption({ label: "Cameras" });
  await page
    .getByLabel("Description", { exact: true })
    .fill("A complete description of the item and its condition.");
  await page.getByLabel("Starting bid (VND)").fill("1500000");
  await page.getByLabel("Bid increment (VND)").fill("100000");
  const start = new Date(Date.now() - 60_000);
  const end = new Date(Date.now() + 86_400_000);
  const local = (date: Date) =>
    new Date(date.getTime() - date.getTimezoneOffset() * 60_000)
      .toISOString()
      .slice(0, 16);
  await page.getByLabel("Starts at", { exact: true }).fill(local(start));
  await page.getByLabel("Ends at", { exact: true }).fill(local(end));
}

test("account restores through cookie, rejects bad login, logs out and keeps private pages protected", async ({
  context,
  page,
}) => {
  const api = contractFixture();
  await api.install(context);
  await page.goto("/auctions/new");
  await expect(page).toHaveURL(/login\?returnTo=/);
  await page.getByLabel("Email", { exact: true }).fill(api.seller.email);
  await page.getByLabel("Password", { exact: true }).fill("WrongPass");
  await page.getByRole("button", { name: "Sign in", exact: true }).click();
  await expect(page.getByRole("alert")).toContainText(
    "Incorrect email or password",
  );
  await login(page);
  await expect(page).toHaveURL(/\/auctions\/new$/);
  await page.reload();
  await expect(
    page.getByRole("button", { name: "Save draft", exact: true }),
  ).toBeVisible();
  expect(
    await page.evaluate(() => ({
      local: { ...localStorage },
      session: { ...sessionStorage },
      cookie: document.cookie,
    })),
  ).toEqual({ local: {}, session: {}, cookie: "" });
  await page.getByRole("button", { name: "Sign out", exact: true }).click();
  await expect(page).toHaveURL(/\/login\?returnTo=/);
  expect(api.writes.every((write) => write.csrf === "contract-test-csrf")).toBe(
    true,
  );
});

test("registration validates confirmation, handles duplicate/rate/CSRF errors and redirects safely", async ({
  context,
  page,
}) => {
  const api = contractFixture();
  await api.install(context);
  await page.goto("/register?returnTo=https://example.com");
  await page.getByLabel("Display name").fill("Phu Test");
  await page.getByLabel("Email", { exact: true }).fill(api.seller.email);
  await page.getByLabel("Password", { exact: true }).fill("Goodpass123");
  await page.getByLabel("Confirm password").fill("Different123");
  await page
    .getByRole("button", { name: "Create account", exact: true })
    .click();
  await expect(page.getByRole("alert")).toContainText("do not match");
  expect(api.writes).toHaveLength(0);
  await page.getByLabel("Confirm password").fill("Goodpass123");
  api.loginError = 409;
  await page
    .getByRole("button", { name: "Create account", exact: true })
    .click();
  await expect(page.getByRole("alert")).toContainText(
    "This email is already in use",
  );
  api.loginError = 429;
  await page
    .getByRole("button", { name: "Create account", exact: true })
    .click();
  await expect(page.getByRole("alert")).toContainText("Too many requests");
  api.loginError = 0;
  api.csrfError = 403;
  await page
    .getByRole("button", { name: "Create account", exact: true })
    .click();
  await expect(page.getByRole("alert")).toContainText(
    "security token has expired",
  );
  api.csrfError = 0;
  await page
    .getByRole("button", { name: "Create account", exact: true })
    .click();
  await expect(page).toHaveURL(/\/dashboard$/);
});

test("seller creates, edits and publishes; second browser sees public result and cannot edit", async ({
  browser,
  context,
  page,
}, info) => {
  const api = contractFixture();
  await api.install(context, api.seller);
  api.createDelay = 500;
  const buyerContext = await browser.newContext({
    viewport: info.project.use.viewport,
  });
  try {
    await api.install(buyerContext, api.buyer);
    const buyer = await buyerContext.newPage();
    await page.goto("/auctions/new");
    await fillDraft(page);
    await page.getByRole("button", { name: "Save draft", exact: true }).click();
    await expect(
      page.getByRole("button", { name: "Saving…", exact: true }),
    ).toBeDisabled();
    await expect(page).toHaveURL(/dashboard\?notice=saved/);
    const created = api.records.find(
      (item) => item.auction.title === "Phu's camera",
    )!;
    expect(
      api.writes.filter((write) => write.path === "/auctions"),
    ).toHaveLength(1);
    const input = api.writes.find((write) => write.path === "/auctions")!.body;
    expect(input.openingPriceVnd).toBe("1500000");
    expect(String(input.startsAt)).toMatch(/Z$/);
    expect(input).not.toHaveProperty("sellerId");
    // New draft is on page 2 of the seller's 22-item list.
    await page.getByRole("button", { name: "Next page" }).click();
    const row = page
      .locator(".dashboard-row")
      .filter({ hasText: "Phu's camera" });
    await row.getByRole("link", { name: "Edit draft" }).click();
    await expect(page.getByLabel("Item title")).toHaveValue("Phu's camera");
    await page.getByLabel("Item title").fill("Updated camera");
    await page.getByRole("button", { name: "Save changes" }).click();
    await expect(page).toHaveURL(/dashboard\?notice=saved/);
    await page.getByRole("button", { name: "Next page" }).click();
    const updatedRow = page
      .locator(".dashboard-row")
      .filter({ hasText: "Updated camera" });
    await updatedRow
      .getByRole("button", { name: "Publish", exact: true })
      .click();
    expect(created.auction.status).toBe("DRAFT");
    await page.getByRole("button", { name: "Confirm publish" }).click();
    await expect(
      page.getByRole("status").filter({ hasText: "Auction published" }),
    ).toBeVisible();
    expect(created.auction.status).toBe("ACTIVE");
    await buyer.goto("/auctions?query=Updated camera");
    await expect(buyer.locator(".auction-card")).toHaveCount(1);
    await buyer
      .getByRole("link", { name: "Updated camera", exact: true })
      .click();
    await expect(buyer.getByRole("heading", { level: 1 })).toHaveText(
      "Updated camera",
    );
    await buyer.goto(`/auctions/${created.auction.id}/edit`);
    await expect(
      buyer.getByRole("heading", { name: "You cannot edit this auction" }),
    ).toBeVisible();
    await page.goto(`/auctions/${created.auction.id}/edit`);
    await expect(
      page.getByRole("heading", {
        name: "Published auctions cannot be edited",
      }),
    ).toBeVisible();
  } finally {
    await buyerContext.close();
  }
});

test("draft delete requires confirmation; conflict never displays success", async ({
  context,
  page,
}) => {
  const api = contractFixture();
  const draft = api.record("Draft to delete", api.seller, "DRAFT");
  await api.install(context, api.seller);
  await page.goto("/dashboard?page=2");
  await page.getByRole("button", { name: "Delete", exact: true }).click();
  await page.getByRole("button", { name: "Keep draft" }).click();
  expect(api.writes).toHaveLength(0);
  await page.getByRole("button", { name: "Publish", exact: true }).click();
  api.writeError = 409;
  await page.getByRole("button", { name: "Confirm publish" }).click();
  await expect(page.getByRole("alert")).toContainText("status has changed");
  expect(draft.auction.status).toBe("DRAFT");
  await page.getByRole("button", { name: "Keep draft" }).click();
  api.writeError = 0;
  await page.getByRole("button", { name: "Delete", exact: true }).click();
  await page.getByRole("button", { name: "Confirm delete" }).click();
  await expect(
    page.getByRole("status").filter({ hasText: "Draft deleted" }),
  ).toBeVisible();
  expect(api.records.some((item) => item.auction.id === draft.auction.id)).toBe(
    false,
  );
});

test("search filters use server query, page resets and URL survives reload", async ({
  context,
  page,
}) => {
  const api = contractFixture();
  await api.install(context);
  await page.goto("/auctions");
  await expect(page.locator(".auction-card")).toHaveCount(20);
  await page.getByRole("button", { name: "Next page" }).click();
  await expect(page).toHaveURL(/page=2/);
  await expect(page.locator(".auction-card")).toHaveCount(1);
  await page
    .getByLabel("Category", { exact: true })
    .selectOption(api.categories[0]!.id);
  await expect(page).not.toHaveURL(/page=2/);
  await expect(page.locator(".auction-card")).toHaveCount(11);
  await page.getByRole("searchbox").fill("Test item 01");
  await page.getByRole("button", { name: "Search", exact: true }).click();
  await expect(page.locator(".auction-card")).toHaveCount(1);
  await page.reload();
  await expect(page.getByRole("searchbox")).toHaveValue("Test item 01");
  await page.getByRole("searchbox").fill("No results");
  await page.getByRole("button", { name: "Search", exact: true }).click();
  await expect(
    page.getByRole("heading", { name: "No matching auctions" }),
  ).toBeVisible();
});

test("unavailable API never falls back to fixtures; expired private session redirects", async ({
  context,
  page,
}) => {
  const api = contractFixture();
  api.listError = 503;
  await api.install(context, api.seller);
  await page.goto("/auctions");
  await expect(page.getByRole("alert")).toBeVisible();
  await expect(page.locator(".auction-card")).toHaveCount(0);
  await expect(
    page.getByText("Fujifilm X100V camera", { exact: true }),
  ).toHaveCount(0);
  api.listError = 0;
  await page.getByRole("button", { name: "Try again" }).click();
  await expect(page.locator(".auction-card")).toHaveCount(20);
  await page.goto("/dashboard");
  await expect(page.locator(".dashboard-row")).toHaveCount(20);
  api.expire = true;
  await page.getByRole("button", { name: "Next page" }).click();
  await expect(page).toHaveURL(/\/login\?returnTo=/);
});

test("missing draft fields block editing; backend denial keeps entered values", async ({
  context,
  page,
}) => {
  const api = contractFixture();
  const draft = api.record("Draft with missing schedule", api.seller, "DRAFT");
  delete draft.startsAt;
  await api.install(context, api.seller);
  await page.goto(`/auctions/${draft.auction.id}/edit`);
  await expect(
    page.getByRole("heading", { name: "Draft details are incomplete" }),
  ).toBeVisible();
  await page.goto("/auctions/new");
  await fillDraft(page);
  api.writeError = 403;
  await page.getByRole("button", { name: "Save draft", exact: true }).click();
  await expect(page.getByRole("alert")).toContainText("do not have permission");
  await expect(page.getByLabel("Item title")).toHaveValue("Phu's camera");
  expect(
    api.records.filter((item) => item.auction.title === "Phu's camera"),
  ).toHaveLength(0);
});

test("live pages have no horizontal overflow or runtime errors at the viewport", async ({
  browser,
  context,
  page,
}, info) => {
  const api = contractFixture();
  await api.install(context, api.seller);
  const draft = api.record("Layout preview draft", api.seller, "DRAFT");
  const errors: string[] = [];
  page.on("pageerror", (error) => errors.push(error.message));
  for (const [route, name] of [
    ["/auctions", "live-list"],
    ["/auctions/new", "live-create"],
    ["/dashboard", "live-dashboard"],
    [`/auctions/${api.records[0]!.auction.id}`, "live-detail"],
    [`/auctions/${draft.auction.id}/edit`, "live-edit"],
  ]) {
    await page.goto(route!);
    await expect(page.getByRole("heading", { level: 1 })).toBeVisible();
    await page.evaluate(() => document.fonts.ready);
    expect(
      await page.evaluate(
        () => document.documentElement.scrollWidth <= innerWidth,
      ),
      name,
    ).toBe(true);
    await page.screenshot({
      path: info.outputPath(`${name}-${info.project.name}.png`),
      fullPage: true,
    });
  }
  const anonymous = await browser.newContext({
    viewport: info.project.use.viewport,
  });
  try {
    await api.install(anonymous);
    const account = await anonymous.newPage();
    for (const route of ["login", "register"]) {
      await account.goto(`/${route}`);
      await expect(account.getByRole("heading", { level: 1 })).toBeVisible();
      expect(
        await account.evaluate(
          () => document.documentElement.scrollWidth <= innerWidth,
        ),
      ).toBe(true);
      await account.screenshot({
        path: info.outputPath(`live-${route}-${info.project.name}.png`),
        fullPage: true,
      });
    }
  } finally {
    await anonymous.close();
  }
  expect(errors).toEqual([]);
});
