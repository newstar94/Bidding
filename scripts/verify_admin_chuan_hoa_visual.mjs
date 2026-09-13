import process from "node:process";
import AxeBuilder from "@axe-core/playwright";
import { chromium } from "@playwright/test";

const baseURL = String(process.env.E2E_BASE_URL || "http://127.0.0.1:8000").replace(/\/$/, "");
const username = String(process.env.E2E_USERNAME || process.env.ADMIN_USERNAME || "admin");
const password = String(process.env.E2E_PASSWORD || process.env.ADMIN_PASSWORD || "");
if (!password) throw new Error("E2E_PASSWORD or ADMIN_PASSWORD must be configured.");

const browser = await chromium.launch({ headless: true });
const results = [];
try {
  for (const viewport of [{ width: 375, height: 812 }, { width: 1280, height: 800 }]) {
    const context = await browser.newContext({ viewport, locale: "vi-VN" });
    const page = await context.newPage();
    await page.goto(`${baseURL}/dang-nhap`, { waitUntil: "domcontentloaded" });
    await page.locator("#login-username").fill(username);
    await page.locator("#login-password").fill(password);
    await page.locator("#form-auth-login button[type='submit']").click();
    await page.waitForURL(/\/admin(?:\/|$)/, { timeout: 20_000 });
    await page.goto(`${baseURL}/admin/chuan-hoa`, { waitUntil: "networkidle" });
    await page.locator("#admin-route-content").getByRole("heading", { name: "Chuẩn Hóa" }).waitFor({ state: "visible" });
    const layout = await page.evaluate(() => ({
      overflow: document.documentElement.scrollWidth > window.innerWidth + 2,
      title: document.querySelector("h2")?.textContent?.trim(),
      hasApplicationLabel: document.body.innerText.includes("ỨNG DỤNG LIÊN KẾT"),
      hasSourceLabel: document.body.innerText.includes("backend Chuẩn Hóa"),
      statusText: document.querySelector("[role='main']")?.innerText || document.body.innerText,
    }));
    const axe = await new AxeBuilder({ page }).analyze();
    const severe = axe.violations.filter(item => ["serious", "critical"].includes(item.impact));
    if (layout.overflow) throw new Error(`${viewport.width}: horizontal overflow`);
    if (!layout.hasApplicationLabel || !layout.hasSourceLabel) throw new Error(`${viewport.width}: missing source identity ${JSON.stringify(layout)}`);
    if (severe.length) throw new Error(`${viewport.width}: axe ${JSON.stringify(severe.map(item => ({ id: item.id, nodes: item.nodes.map(node => node.target) })))}`);
    results.push({ viewport, title: layout.title, state: layout.statusText.includes("Tích hợp chưa sẵn sàng") ? "not-configured" : "available", seriousAxeViolations: 0, horizontalOverflow: false });
    await context.close();
  }
  process.stdout.write(`${JSON.stringify({ results }, null, 2)}\n`);
} finally {
  await browser.close();
}
