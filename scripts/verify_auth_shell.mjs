import process from "node:process";
import { chromium } from "@playwright/test";

const baseURL = String(process.env.E2E_BASE_URL || "http://127.0.0.1:8000").replace(/\/$/, "");
const launchOptions = { headless: true };
if (process.env.STARTUP_BROWSER_CHANNEL) launchOptions.channel = process.env.STARTUP_BROWSER_CHANNEL;
const browser = await chromium.launch(launchOptions);

try {
  const page = await browser.newPage({ locale: "vi-VN", timezoneId: "Asia/Ho_Chi_Minh" });
  const pageErrors = [];
  page.on("pageerror", (error) => pageErrors.push(error.message));
  const response = await page.goto(`${baseURL}/dang-nhap`, { waitUntil: "domcontentloaded" });
  if (!response?.ok()) throw new Error(`Auth shell navigation failed: HTTP ${response?.status() || "unknown"}`);
  await page.waitForFunction(() => {
    const overlay = document.getElementById("auth-overlay");
    const loader = document.getElementById("system-init-loader");
    return overlay
      && getComputedStyle(overlay).display === "flex"
      && loader?.getAttribute("aria-busy") === "false"
      && getComputedStyle(loader).visibility === "hidden";
  }, null, { timeout: 15_000 });
  const state = await page.evaluate(() => ({
    overlayDisplay: getComputedStyle(document.getElementById("auth-overlay")).display,
    loaderVisibility: getComputedStyle(document.getElementById("system-init-loader")).visibility,
    stylesheetCount: document.querySelectorAll('link[rel="stylesheet"]').length,
    runtimeStylesheetReady: Boolean(document.querySelector('link[data-runtime-styles]')?.sheet),
  }));
  if (pageErrors.length) throw new Error(`Auth shell page errors: ${pageErrors.join(" | ")}`);
  if (!state.runtimeStylesheetReady) throw new Error("Runtime stylesheet is not available.");
  process.stdout.write(`${JSON.stringify(state)}\n`);
} finally {
  await browser.close();
}
