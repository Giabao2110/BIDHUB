import { expect, test } from "@playwright/test";

const firstId = "10000000-0000-4000-8000-000000000001";

test("discovery filters, empty recovery and detail navigation", async ({
  page,
}) => {
  await page.goto("/");
  await expect(page).toHaveURL(/\/auctions$/);
  await expect(page.locator(".auction-card")).toHaveCount(6);
  await page.getByRole("searchbox").fill("Seiko");
  await expect(page.locator(".auction-card")).toHaveCount(1);
  await page.reload();
  await expect(page.getByRole("searchbox")).toHaveValue("Seiko");
  await page.getByRole("searchbox").fill("không tồn tại");
  await expect(
    page.getByRole("heading", { name: "Chưa tìm thấy phiên phù hợp" }),
  ).toBeVisible();
  await page
    .getByRole("button", { name: "Xóa bộ lọc", exact: true })
    .last()
    .click();
  await expect(page).toHaveURL(/\/auctions$/);
  await expect(page.getByRole("searchbox")).toHaveValue("");
  await expect(page.locator(".auction-card")).toHaveCount(6);
  await page.getByLabel("Danh mục", { exact: true }).selectOption("Âm thanh");
  await expect(page.locator(".auction-card")).toHaveCount(2);
  await page
    .getByLabel("Trạng thái phiên", { exact: true })
    .selectOption("ENDED");
  await expect(page.locator(".auction-card")).toHaveCount(1);
  await page
    .getByRole("link", { name: "Mâm đĩa than vintage", exact: true })
    .click();
  await expect(page.getByRole("heading", { level: 1 })).toHaveText(
    "Mâm đĩa than vintage",
  );
  await expect(
    page.getByRole("button", { name: "Chờ tích hợp trả giá" }),
  ).toBeDisabled();
  await expect(
    page.getByText("Kết quả người thắng sẽ được xác nhận bằng API kết quả."),
  ).toBeVisible();
});

test("loading, error and empty states can be reviewed and recovered", async ({
  page,
}) => {
  await page.goto("/auctions?state=loading");
  await expect(
    page.getByRole("heading", { name: "Đang tải phiên đấu giá" }),
  ).toBeVisible();
  await page.getByLabel("Trạng thái giao diện mẫu").selectOption("error");
  await expect(page.getByRole("alert")).toContainText("Chưa thể tải dữ liệu");
  await page.getByRole("button", { name: "Thử lại" }).click();
  await expect(page.locator(".auction-card")).toHaveCount(6);
  await page.getByLabel("Trạng thái giao diện mẫu").selectOption("empty");
  await expect(
    page.getByRole("heading", { name: "Chưa tìm thấy phiên phù hợp" }),
  ).toBeVisible();
  await page.getByRole("button", { name: "Xóa bộ lọc" }).click();
  await expect(page.locator(".auction-card")).toHaveCount(6);
});

test("login only validates locally and sends no authentication request", async ({
  page,
}) => {
  const requests: string[] = [];
  page.on("request", (request) => {
    if (request.url().includes("/api/")) requests.push(request.url());
  });
  await page.goto("/login");
  await page.getByRole("button", { name: "Kiểm tra biểu mẫu" }).click();
  expect(
    await page
      .locator("form")
      .evaluate((form: HTMLFormElement) => form.checkValidity()),
  ).toBe(false);
  await page.getByLabel("Email", { exact: true }).fill("preview@example.com");
  await page.getByLabel("Mật khẩu", { exact: true }).fill("preview-only");
  await page.getByRole("button", { name: "Kiểm tra biểu mẫu" }).click();
  await expect(page.getByRole("status")).toContainText("Chưa gửi thông tin");
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
  await page.goto("/auctions/new");
  await page.getByLabel("Tên sản phẩm").fill("Máy ảnh mẫu");
  await page
    .getByLabel("Danh mục", { exact: true })
    .selectOption({ label: "Máy ảnh" });
  await page
    .getByLabel("Mô tả", { exact: true })
    .fill("Mô tả minh họa, không đăng bán thật.");
  await page.getByLabel("Giá khởi điểm (VND)").fill("9223372036854775808");
  await page.getByLabel("Bước giá (VND)").fill("100000");
  const localDate = (offset: number) => {
    const date = new Date(Date.now() + offset * 86_400_000);
    return new Date(date.getTime() - date.getTimezoneOffset() * 60_000)
      .toISOString()
      .slice(0, 16);
  };
  await page.getByLabel("Bắt đầu", { exact: true }).fill(localDate(2));
  await page.getByLabel("Kết thúc", { exact: true }).fill(localDate(1));
  await page.getByRole("button", { name: "Kiểm tra bản nháp" }).click();
  await expect(page.getByRole("alert")).toContainText("BIGINT");
  await page.getByLabel("Giá khởi điểm (VND)").fill("1000000");
  await page.getByRole("button", { name: "Kiểm tra bản nháp" }).click();
  await expect(page.getByRole("alert")).toContainText(
    "kết thúc sau thời gian bắt đầu",
  );
  await page.getByLabel("Kết thúc", { exact: true }).fill(localDate(3));
  await page.getByRole("button", { name: "Kiểm tra bản nháp" }).click();
  await expect(page.getByRole("status")).toContainText(
    "Chưa tạo hoặc lưu phiên",
  );
  expect(writes).toEqual([]);
});

test("dashboard navigation and unavailable pages stay explicit", async ({
  page,
}) => {
  await page.goto("/dashboard");
  await expect(
    page.getByText("Bố cục tài khoản mẫu, chưa có người dùng đăng nhập."),
  ).toBeVisible();
  await expect(page.locator(".dashboard-row")).toHaveCount(5);
  await page
    .getByRole("link", { name: "Lượt trả giá của tôi", exact: true })
    .click();
  await expect(page.locator(".dashboard-row")).toHaveCount(4);
  await page.goto("/auctions/10000000-0000-4000-8000-000000000007");
  await expect(
    page.getByRole("heading", { name: "Không tìm thấy phiên đấu giá" }),
  ).toBeVisible();
  await page.goto("/missing-page");
  await expect(
    page.getByRole("heading", { name: "Trang này chưa có ở BIDHUB" }),
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
    ["/auctions", "list"],
    [`/auctions/${firstId}`, "detail"],
    ["/login", "login"],
    ["/auctions/new", "create"],
    ["/dashboard", "dashboard"],
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
  await page.goto("/auctions");
  await page.keyboard.press("Tab");
  await expect(
    page.getByRole("link", { name: "Đến nội dung chính" }),
  ).toBeFocused();
  await page.keyboard.press("Enter");
  await expect(page.locator("main")).toBeFocused();
  await page.keyboard.press("Tab");
  const outlineStyle = await page.evaluate(
    () => getComputedStyle(document.activeElement!).outlineStyle,
  );
  expect(outlineStyle).toBe("solid");
});
