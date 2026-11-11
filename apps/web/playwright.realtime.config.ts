import { defineConfig } from "@playwright/test";

export default defineConfig({
  testDir: "./tests/realtime",
  workers: 1,
  reporter: "list",
  use: {
    channel: process.env.PLAYWRIGHT_CHANNEL || undefined,
    trace: "retain-on-failure",
  },
});
