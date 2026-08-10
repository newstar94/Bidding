import { defineConfig, devices } from "@playwright/test";

const baseURL = String(process.env.E2E_BASE_URL || "http://127.0.0.1:8000").replace(/\/$/, "");
const contractorViolationReady = Boolean(
  (process.env.E2E_PASSWORD || process.env.ADMIN_PASSWORD)
    && process.env.E2E_CONTRACTOR_VIOLATION_PACKAGE_ID
    && process.env.VNEPS_VIOLATION_FIXTURE_PATH,
);
const procurementImportReady = Boolean(
  (process.env.E2E_PASSWORD || process.env.ADMIN_PASSWORD)
    && String(process.env.VNEPS_PROCUREMENT_IMPORT_ENABLED || "").toLowerCase() === "true"
    && String(process.env.VNEPS_PROCUREMENT_PROVIDER || "").toLowerCase() === "fixture"
    && process.env.VNEPS_PROCUREMENT_FIXTURE_PATH,
);

const ignoredSpecs = [];
if (!contractorViolationReady) ignoredSpecs.push("contractor-violation.spec.mjs");
if (!procurementImportReady) ignoredSpecs.push("procurement-plan-import.spec.mjs");

export default defineConfig({
  testDir: "./e2e/specs",
  testIgnore: ignoredSpecs,
  timeout: 60_000,
  expect: { timeout: 10_000 },
  fullyParallel: false,
  workers: 1,
  retries: 0,
  reporter: [
    ["list"],
    ["html", { outputFolder: "playwright-report", open: "never" }],
    ["junit", { outputFile: "test-results/e2e-junit.xml" }],
    ["json", { outputFile: "test-results/e2e-results.json" }],
  ],
  use: {
    baseURL,
    locale: "vi-VN",
    timezoneId: "Asia/Ho_Chi_Minh",
    trace: "retain-on-failure",
    screenshot: "only-on-failure",
    video: "retain-on-failure",
    actionTimeout: 10_000,
    navigationTimeout: 20_000,
  },
  projects: [
    { name: "chromium", use: { ...devices["Desktop Chrome"] } },
    { name: "firefox", use: { ...devices["Desktop Firefox"] } },
    { name: "webkit", use: { ...devices["Desktop Safari"] } },
  ],
});
