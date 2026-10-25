import { defineConfig, devices } from "@playwright/test";

// Runs against the Firebase Hosting emulator by default (same rewrites and headers as
// production), or against any deployment with E2E_BASE_URL=https://<site>.web.app.
// Signed-in tests need a dedicated account: E2E_EMAIL and E2E_PASSWORD. They delete that
// account's buildings, so never point them at a real user.
export default defineConfig({
  testDir: "e2e",
  fullyParallel: false,
  workers: 1,
  retries: process.env["CI"] ? 1 : 0,
  reporter: process.env["CI"] ? [["github"], ["html", { open: "never" }]] : "list",
  use: {
    baseURL: process.env["E2E_BASE_URL"] ?? "http://localhost:5050",
    trace: "retain-on-failure",
  },
  projects: [{ name: "chromium", use: { ...devices["Desktop Chrome"] } }],
});
