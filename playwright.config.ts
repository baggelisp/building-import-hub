import { defineConfig, devices } from "@playwright/test";

// Runs against the Firebase Hosting emulator by default (same rewrites and headers as
// production), or against any deployment with APP_URL=https://<site>.web.app.
// Signed-in tests need a dedicated account: TEST_ACCOUNT_EMAIL and TEST_ACCOUNT_PASSWORD. They delete that
// account's buildings, so never point them at a real user.
export default defineConfig({
  testDir: "e2e",
  fullyParallel: false,
  workers: 1,
  retries: process.env["CI"] ? 1 : 0,
  reporter: process.env["CI"] ? [["github"], ["html", { open: "never" }]] : "list",
  use: {
    baseURL: process.env["APP_URL"] ?? "http://localhost:5002",
    trace: "retain-on-failure",
  },
  projects: [{ name: "chromium", use: { ...devices["Desktop Chrome"] } }],
});
