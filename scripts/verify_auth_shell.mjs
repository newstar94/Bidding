import process from "node:process";
import { chromium } from "@playwright/test";

const baseURL = String(process.env.E2E_BASE_URL || "http://127.0.0.1:8000").replace(/\/$/, "");
const username = String(process.env.E2E_USERNAME || process.env.ADMIN_USERNAME || "admin");
const password = String(process.env.E2E_PASSWORD || process.env.ADMIN_PASSWORD || "");
if (!password) throw new Error("E2E_PASSWORD or ADMIN_PASSWORD must be configured.");
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
  await page.locator("#login-username").fill(username);
  await page.locator("#login-password").fill(password);
  await page.locator("#form-auth-login button[type='submit']").click();
  await page.waitForFunction(() => {
    const overlay = document.getElementById("auth-overlay");
    const loader = document.getElementById("system-init-loader");
    return overlay
      && getComputedStyle(overlay).display === "none"
      && loader?.getAttribute("aria-busy") === "false"
      && getComputedStyle(loader).visibility === "hidden";
  }, null, { timeout: 15_000 });
  const profileTrigger = page.locator("#header-profile-trigger");
  await profileTrigger.click();
  const interactiveState = await page.evaluate(() => {
    const trigger = document.getElementById("header-profile-trigger");
    const menu = document.getElementById("profile-dropdown-menu");
    return {
      profileMenuOpen: Boolean(menu?.classList.contains("active") && !menu.hidden),
      profileEventsBound: Boolean(document.__bfProfileDropdownEventsBound),
      triggerExpanded: trigger?.getAttribute("aria-expanded") || "",
      triggerConnected: Boolean(trigger?.isConnected),
      menuClass: menu?.className || "",
      menuHidden: menu?.hidden,
      path: window.location.pathname,
    };
  });
  if (!interactiveState.profileMenuOpen) {
    throw new Error(`Authenticated shell profile menu is not interactive until reload: ${JSON.stringify({ interactiveState, pageErrors })}`);
  }
  const ownerResponse = await page.goto(`${baseURL}/chu-dau-tu`, { waitUntil: "domcontentloaded" });
  if (!ownerResponse?.ok()) throw new Error(`Owner route failed: HTTP ${ownerResponse?.status() || "unknown"}`);
  await page.waitForFunction(() => {
    const loader = document.getElementById("system-init-loader");
    return loader?.getAttribute("aria-busy") === "false"
      && getComputedStyle(loader).visibility === "hidden";
  }, null, { timeout: 15_000 });
  const addOwnerButton = page.locator("#btn-add-chudautu");
  await addOwnerButton.click();
  await page.locator("#modal-chudautu.active").waitFor({ state: "visible", timeout: 10_000 });
  const ownerState = await page.evaluate(() => ({
    ownerCreateModalOpen: document.getElementById("modal-chudautu")?.classList.contains("active") === true,
  }));
  process.stdout.write(`${JSON.stringify({ ...state, ...interactiveState, ...ownerState })}\n`);
} finally {
  await browser.close();
}
