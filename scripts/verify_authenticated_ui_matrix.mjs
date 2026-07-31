import process from "node:process";
import AxeBuilder from "@axe-core/playwright";
import { chromium } from "@playwright/test";

const baseURL = String(process.env.E2E_BASE_URL || "http://127.0.0.1:8000").replace(/\/$/, "");
const username = String(process.env.E2E_USERNAME || process.env.ADMIN_USERNAME || "admin");
const password = String(process.env.E2E_PASSWORD || process.env.ADMIN_PASSWORD || "");
if (!password) throw new Error("E2E_PASSWORD or ADMIN_PASSWORD must be configured.");

const viewports = [
  { width: 320, height: 720 },
  { width: 375, height: 812 },
  { width: 414, height: 896 },
  { width: 768, height: 1024 },
  { width: 1280, height: 720 },
];
const results = [];

async function waitForShell(page) {
  await page.waitForFunction(() => {
    const loader = document.getElementById("system-init-loader");
    return loader?.getAttribute("aria-busy") === "false"
      && getComputedStyle(loader).visibility === "hidden";
  }, null, { timeout: 20_000 });
}

async function login(page) {
  await page.goto(`${baseURL}/dang-nhap`, { waitUntil: "domcontentloaded" });
  await waitForShell(page);
  await page.locator("#login-username").fill(username);
  await page.locator("#login-password").fill(password);
  await page.locator("#form-auth-login button[type='submit']").click();
  await page.waitForFunction(() => (
    getComputedStyle(document.getElementById("auth-overlay")).display === "none"
  ), null, { timeout: 20_000 });
}

async function auditScreen(page, name) {
  await page.waitForTimeout(100);
  const layout = await page.evaluate(() => {
    const visible = (element) => element.getClientRects().length > 0
      && getComputedStyle(element).visibility !== "hidden";
    const overflowing = [...document.querySelectorAll("main, [role='main'], .tab-content, .modal-card")]
      .filter(visible)
      .filter((element) => element.scrollWidth > element.clientWidth + 2)
      .map((element) => element.id || element.className || element.tagName);
    const text = document.body.innerText;
    return {
      documentOverflow: document.documentElement.scrollWidth > innerWidth + 2,
      overflowing,
      rawIds: text.match(/\buser-[A-Za-z0-9_-]+\b|\b[0-9a-f]{8}-[0-9a-f-]{27,}\b/gi) || [],
    };
  });
  if (layout.documentOverflow || layout.overflowing.length) {
    throw new Error(`${name}: responsive overflow ${JSON.stringify(layout)}`);
  }
  if (layout.rawIds.length) throw new Error(`${name}: raw internal IDs ${layout.rawIds.join(", ")}`);
  const axe = await new AxeBuilder({ page }).analyze();
  const severe = axe.violations.filter((violation) => ["serious", "critical"].includes(violation.impact));
  if (severe.length) {
    throw new Error(`${name}: axe ${severe.map((item) => item.id).join(", ")}`);
  }
  await page.evaluate(() => document.activeElement?.blur?.());
  await page.keyboard.press("Tab");
  const focus = await page.evaluate(() => {
    const element = document.activeElement;
    if (!element || element === document.body) return null;
      const style = getComputedStyle(element);
    return {
      width: parseFloat(style.outlineWidth) || 0,
      style: style.outlineStyle,
      element: `${element.tagName.toLowerCase()}#${element.id}.${element.className}`,
    };
  });
  if (focus) {
    if (focus.width < 2 || focus.style === "none") {
      throw new Error(`${name}: focused control has no reviewed 2px indicator ${JSON.stringify(focus)}`);
    }
  }
  return layout;
}

const browser = await chromium.launch({ headless: true });
try {
  for (const viewport of viewports) {
    const context = await browser.newContext({ viewport, locale: "vi-VN", timezoneId: "Asia/Ho_Chi_Minh" });
    const page = await context.newPage();
    await login(page);

    const screens = [];
    for (const [name, path] of [["dashboard", "/tong-quan"], ["packages", "/goi-thau"]]) {
      await page.goto(`${baseURL}${path}`, { waitUntil: "domcontentloaded" });
      await waitForShell(page);
      await auditScreen(page, `${viewport.width}:${name}`);
      screens.push(name);
    }

    const packageLink = page.locator('[data-bf-action="show-package"]').first();
    if (await packageLink.count()) {
      await packageLink.click();
      await page.waitForURL(/goi-thau-chi-tiet/u, { timeout: 10_000 });
      const detailURL = page.url();
      await auditScreen(page, `${viewport.width}:package-detail`);
      screens.push("package-detail");
      await page.reload({ waitUntil: "domcontentloaded" });
      await waitForShell(page);
      if (page.url() !== detailURL) throw new Error(`${viewport.width}: deep link changed after reload`);

      for (const [name, tab] of [["detailed-evaluation", "eval_tech"], ["bidder-goods", "goods"]]) {
        const tabButton = page.locator(`[data-workflow-tab="${tab}"]`);
        if (await tabButton.count()) {
          await tabButton.click();
          await auditScreen(page, `${viewport.width}:${name}`);
          screens.push(name);
        }
      }
      await page.goBack({ waitUntil: "domcontentloaded" });
      await waitForShell(page);
    }

    await page.goto(`${baseURL}/goi-thau`, { waitUntil: "domcontentloaded" });
    await waitForShell(page);
    const createButton = page.locator("#btn-add-goithau");
    if (await createButton.count()) {
      await createButton.click();
      const modal = page.locator("#modal-goithau.active");
      await modal.waitFor({ state: "visible", timeout: 10_000 });
      await auditScreen(page, `${viewport.width}:long-package-modal`);
      screens.push("long-package-modal");
      const assignee = modal.locator("[data-multi-assignee], .multi-assignee-select").first();
      if (await assignee.count()) {
        await assignee.focus();
        screens.push("multi-assignee");
      }
      await page.keyboard.press("Escape");
    }

    const denied = await context.request.get(`${baseURL}/images/not-a-managed-file.png`);
    if (![400, 403, 404].includes(denied.status())) {
      throw new Error(`${viewport.width}: protected media deny returned ${denied.status()}`);
    }
    screens.push("protected-media-deny");
    results.push({ viewport, screens });
    await context.close();
  }
  process.stdout.write(`${JSON.stringify({ results }, null, 2)}\n`);
} finally {
  await browser.close();
}
