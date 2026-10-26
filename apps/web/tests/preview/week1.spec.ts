import { expect, test } from "@playwright/test";

const firstId = "10000000-0000-4000-8000-000000000001";

test("discovery filters, empty recovery and detail navigation", async ({
  page,
}) => {
  await page.goto("/preview/");
  await expect(page).toHaveURL(/\/auctions$/);
  await expect(page.locator(".auction-card")).toHaveCount(6);
  await page.getByRole("searchbox").fill("Seiko");
  await expect(page.locator(".auction-card")).toHaveCount(1);
  await page.reload();
  await expect(page.getByRole("searchbox")).toHaveValue("Seiko");
  await page.getByRole("searchbox").fill("no results");
  await expect(
    page.getByRole("heading", { name: "No matching auctions" }),
  ).toBeVisible();
  await page
    .getByRole("button", { name: "Clear filters", exact: true })
    .last()
    .click();
  await expect(page).toHaveURL(/\/auctions$/);
  await expect(page.getByRole("searchbox")).toHaveValue("");
  await expect(page.locator(".auction-card")).toHaveCount(6);
  await page.getByLabel("Category", { exact: true }).selectOption("Audio");
  await expect(page.locator(".auction-card")).toHaveCount(2);
  await page
    .getByLabel("Auction status", { exact: true })
    .selectOption("ENDED");
  await expect(page.locator(".auction-card")).toHaveCount(1);
  await page
    .getByRole("link", { name: "Vintage turntable", exact: true })
    .click();
  await expect(page.getByRole("heading", { level: 1 })).toHaveText(
    "Vintage turntable",
  );
  await expect(
    page.getByRole("button", { name: "Bidding coming soon" }),
  ).toBeDisabled();
  await expect(
    page.getByText("The winner will be confirmed by the server."),
  ).toBeVisible();
});

test("loading, error and empty states can be reviewed and recovered", async ({
  page,
}) => {
  await page.goto("/preview/auctions?state=loading");
  await expect(
    page.getByRole("heading", { name: "Loading auctions" }),
  ).toBeVisible();
  await page.getByLabel("Preview state").selectOption("error");
  await expect(page.getByRole("alert")).toContainText("Unable to load data");
  await page.getByRole("button", { name: "Try again" }).click();
  await expect(page.locator(".auction-card")).toHaveCount(6);
  await page.getByLabel("Preview state").selectOption("empty");
  await expect(
    page.getByRole("heading", { name: "No matching auctions" }),
  ).toBeVisible();
  await page.getByRole("button", { name: "Clear filters" }).click();
  await expect(page.locator(".auction-card")).toHaveCount(6);
});

test("login only validates locally and sends no authentication request", async ({
  page,
}) => {
  const requests: string[] = [];
  page.on("request", (request) => {
    if (request.url().includes("/api/")) requests.push(request.url());
  });
  await page.goto("/preview/login");
  await page.getByRole("button", { name: "Validate form" }).click();
  expect(
    await page
      .locator("form")
      .evaluate((form: HTMLFormElement) => form.checkValidity()),
  ).toBe(false);
  await page.getByLabel("Email", { exact: true }).fill("preview@example.com");
  await page.getByLabel("Password", { exact: true }).fill("preview-only");
  await page.getByRole("button", { name: "Validate form" }).click();
  await expect(page.getByRole("status")).toContainText("Nothing was sent");
  expect(requests).toEqual([]);
});

test("seller form rejects invalid amounts and dates without creating an auction", async ({
  page,
}) => {
  const writes: string[] = [];
  page.on("request", (request) => {
    if (request.method() !== "GET" && request.url().includes("/api/"))
      writes.push(request.url());
  });
  await page.goto("/preview/auctions/new");
  await page.getByLabel("Item title").fill("Sample camera");
  await page
    .getByLabel("Category", { exact: true })
    .selectOption({ label: "Cameras" });
  await page
    .getByLabel("Description", { exact: true })
    .fill("Sample description. This is not a real listing.");
  await page.getByLabel("Starting bid (VND)").fill("9223372036854775808");
  await page.getByLabel("Bid increment (VND)").fill("100000");
  const localDate = (offset: number) => {
    const date = new Date(Date.now() + offset * 86_400_000);
    return new Date(date.getTime() - date.getTimezoneOffset() * 60_000)
      .toISOString()
      .slice(0, 16);
  };
  await page.getByLabel("Starts at", { exact: true }).fill(localDate(2));
  await page.getByLabel("Ends at", { exact: true }).fill(localDate(1));
  await page.getByRole("button", { name: "Validate draft" }).click();
  await expect(page.getByRole("alert")).toContainText("BIGINT");
  await page.getByLabel("Starting bid (VND)").fill("1000000");
  await page.getByRole("button", { name: "Validate draft" }).click();
  await expect(page.getByRole("alert")).toContainText(
    "end time after the start",
  );
  await page.getByLabel("Ends at", { exact: true }).fill(localDate(3));
  await page.getByRole("button", { name: "Validate draft" }).click();
  await expect(page.getByRole("status")).toContainText(
    "No auction has been created or saved",
  );
  expect(writes).toEqual([]);
});

test("dashboard navigation and unavailable pages stay explicit", async ({
  page,
}) => {
  await page.goto("/preview/dashboard");
  await expect(
    page.getByText("Sample account layout. No user is signed in."),
  ).toBeVisible();
  await expect(page.locator(".dashboard-row")).toHaveCount(5);
  await page.getByRole("link", { name: "My bids", exact: true }).click();
  await expect(page.locator(".dashboard-row")).toHaveCount(4);
  await page.goto("/preview/auctions/10000000-0000-4000-8000-000000000007");
  await expect(
    page.getByRole("heading", { name: "Auction not found" }),
  ).toBeVisible();
  await page.goto("/preview/missing-page");
  await expect(
    page.getByRole("heading", { name: "This page is not on BIDHUB" }),
  ).toBeVisible();
});

test("five wireframes fit the viewport and render without browser errors", async ({
  page,
}, testInfo) => {
  const errors: string[] = [];
  page.on("pageerror", (error) => errors.push(error.message));
  page.on("console", (message) => {
    if (message.type() === "error") errors.push(message.text());
  });
  const routes = [
    ["/preview/auctions", "list"],
    [`/preview/auctions/${firstId}`, "detail"],
    ["/preview/login", "login"],
    ["/preview/auctions/new", "create"],
    ["/preview/dashboard", "dashboard"],
  ];
  for (const [route, name] of routes) {
    await page.goto(route!);
    await expect(page.getByRole("heading", { level: 1 })).toBeVisible();
    if (name === "list")
      await expect(page.locator(".auction-card")).toHaveCount(6);
    expect(
      await page.evaluate(
        () => document.documentElement.scrollWidth <= innerWidth,
      ),
      `${name} should have no horizontal overflow`,
    ).toBe(true);
    await page.screenshot({
      path: testInfo.outputPath(`${name}-${testInfo.project.name}.png`),
      fullPage: true,
    });
  }
  expect(errors).toEqual([]);
});

test("keyboard access reaches content and shows focus", async ({ page }) => {
  await page.goto("/preview/auctions");
  await page.keyboard.press("Tab");
  await expect(
    page.getByRole("link", { name: "Skip to main content" }),
  ).toBeFocused();
  await page.keyboard.press("Enter");
  await expect(page.locator("main")).toBeFocused();
  await page.keyboard.press("Tab");
  const outlineStyle = await page.evaluate(
    () => getComputedStyle(document.activeElement!).outlineStyle,
  );
  expect(outlineStyle).toBe("solid");
});
