import { defineConfig } from "@playwright/test";

const baseURL = process.env.WEB_ORIGIN ?? "http://127.0.0.1:5173";
if (process.env.BIDHUB_ALLOW_AUTH_SMOKE_WRITE !== "1")
  throw new Error(
    "Integration tests create accounts and auctions. Set BIDHUB_ALLOW_AUTH_SMOKE_WRITE=1 and use a disposable database.",
  );
if (!["127.0.0.1", "localhost"].includes(new URL(baseURL).hostname))
  throw new Error(
    "Integration tests require a loopback application backed by a disposable database.",
  );

export default defineConfig({
  testDir: "./tests/integration",
  timeout: 180_000,
  expect: { timeout: 10_000 },
  workers: 1,
  reporter: "list",
  use: {
    baseURL,
    channel: process.env.PLAYWRIGHT_CHANNEL || undefined,
    viewport: { width: 1440, height: 1000 },
    trace: "retain-on-failure",
  },
});
