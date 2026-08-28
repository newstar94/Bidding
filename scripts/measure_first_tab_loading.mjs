import fs from "node:fs/promises";
import path from "node:path";
import process from "node:process";
import { chromium } from "@playwright/test";

const argumentsSet = new Set(process.argv.slice(2));
const shouldAssert = argumentsSet.has("--assert");
const baseURL = String(process.env.E2E_BASE_URL || "http://127.0.0.1:8000").replace(/\/$/, "");
const username = process.env.E2E_USERNAME || process.env.ADMIN_USERNAME || "admin";
const password = process.env.E2E_PASSWORD || process.env.ADMIN_PASSWORD;
const activeRole = process.env.FIRST_TAB_ACTIVE_ROLE || "manager";
const route = process.env.FIRST_TAB_ROUTE || (activeRole === "super_admin" ? "/tong-quan-admin" : "/tong-quan");
const warmSettleMs = Math.max(0, Number(process.env.FIRST_TAB_WARM_SETTLE_MS || 4000));
const tabLimitMs = Math.max(1, Number(process.env.FIRST_TAB_LIMIT_MS || 100));
const outputPath = path.resolve(
  process.env.FIRST_TAB_METRICS_OUTPUT || "data/logs/first-tab-performance.json",
);

if (!password) throw new Error("E2E_PASSWORD or ADMIN_PASSWORD must be configured.");

const tabCases = [
  { tab: "kehoach", table: "kehoach-table", label: "Kế hoạch" },
  { tab: "goithau", table: "goithau-table", label: "Gói thầu" },
  { tab: "chudautu", table: "chudautu-table", label: "Chủ đầu tư" },
  { tab: "nhathau", table: "nhathau-table", label: "Nhà thầu" },
  { tab: "chuyengia", table: "chuyengia-table", label: "Chuyên gia" },
  { tab: "hopdong", table: "hopdong-table", label: "Hợp đồng" },
];

async function authenticate(context) {
  const response = await context.request.post(`${baseURL}/api/auth/login`, {
    data: { username, password, remember: false },
  });
  if (!response.ok()) throw new Error(`Login failed: HTTP ${response.status()}`);
  const csrfToken = (await context.cookies(baseURL))
    .find((cookie) => cookie.name === "csrf_token")?.value;
  const roleResponse = await context.request.post(`${baseURL}/api/auth/active-role`, {
    data: { active_role: activeRole },
    headers: {
      ...(csrfToken ? { "X-CSRF-Token": csrfToken } : {}),
      Origin: baseURL,
      Referer: `${baseURL}/`,
    },
  });
  if (!roleResponse.ok()) {
    const errorBody = (await roleResponse.text().catch(() => "")).slice(0, 300);
    throw new Error(`Active-role switch failed: HTTP ${roleResponse.status()} ${errorBody}`.trim());
  }
  const rolePayload = await roleResponse.json();
  if (rolePayload?.activeRole !== activeRole) {
    throw new Error(`Active role ${activeRole} is unavailable to the benchmark account.`);
  }
}

async function measureTab(page, tabCase, requestCounts) {
  const button = page.locator(`#btn-tab-${tabCase.tab}`);
  if (!await button.isVisible()) {
    return { ...tabCase, skipped: true, reason: "tab-not-visible" };
  }
  const requestsBefore = requestCounts.get(tabCase.tab) || 0;
  const measurement = await page.evaluate(async ({ tab, table }) => {
    const buttonElement = document.getElementById(`btn-tab-${tab}`);
    const tableBody = document.querySelector(`#${table} tbody`);
    if (!buttonElement || !tableBody) throw new Error(`Missing tab measurement DOM for ${tab}`);
    let skeletonObserved = Boolean(tableBody.querySelector('[data-table-state="loading"]'));
    const startedAt = performance.now();
    const diagnosticsStart = window.__bfPerfDiagnostics?.length || 0;
    const longTasksStart = window.__bfLongTasks?.length || 0;
    return new Promise((resolve, reject) => {
      let settled = false;
      const finish = () => {
        if (settled) return;
        skeletonObserved ||= Boolean(tableBody.querySelector('[data-table-state="loading"]'));
        const pane = document.getElementById(`tab-${tab}`);
        const meaningful = Boolean(
          pane?.classList.contains("active")
          && tableBody.children.length > 0
          && !tableBody.querySelector('[data-table-state="loading"]'),
        );
        if (!meaningful) return;
        settled = true;
        observer.disconnect();
        clearTimeout(timeoutId);
        requestAnimationFrame(() => resolve({
          durationMs: Math.round((performance.now() - startedAt) * 10) / 10,
          skeletonObserved,
          diagnostics: (window.__bfPerfDiagnostics || []).slice(diagnosticsStart),
          longTasks: (window.__bfLongTasks || []).slice(longTasksStart),
          resources: performance.getEntriesByType("resource")
            .filter((entry) => entry.startTime >= startedAt)
            .map((entry) => ({
              path: new URL(entry.name).pathname,
              initiatorType: entry.initiatorType,
              startTime: Math.round(entry.startTime),
              duration: Math.round(entry.duration),
              transferSize: entry.transferSize,
              decodedBodySize: entry.decodedBodySize,
            })),
        }));
      };
      const observer = new MutationObserver(finish);
      observer.observe(tableBody, { childList: true, subtree: true });
      const timeoutId = setTimeout(() => {
        if (settled) return;
        settled = true;
        observer.disconnect();
        reject(new Error(`Timed out waiting for meaningful ${tab} table content`));
      }, 10_000);
      buttonElement.click();
      finish();
    });
  }, tabCase);
  return {
    ...tabCase,
    ...measurement,
    paginationRequests: (requestCounts.get(tabCase.tab) || 0) - requestsBefore,
  };
}

const browser = await chromium.launch({ headless: true });
const context = await browser.newContext();
const page = await context.newPage();
await page.addInitScript(() => {
  localStorage.setItem("bf_perf_debug", "true");
  window.__bfPerfDiagnostics = [];
  window.__bfLongTasks = [];
  const originalInfo = console.info.bind(console);
  console.info = (...args) => {
    if (args[0] === "[bf-perf]" && args[1] && typeof args[1] === "object") {
      window.__bfPerfDiagnostics.push({ ...args[1], at: Math.round(performance.now()) });
    }
    originalInfo(...args);
  };
  if (typeof PerformanceObserver === "function") {
    try {
      const observer = new PerformanceObserver((list) => {
        list.getEntries().forEach((entry) => {
          window.__bfLongTasks.push({
            startTime: Math.round(entry.startTime),
            duration: Math.round(entry.duration),
          });
        });
      });
      observer.observe({ type: "longtask", buffered: true });
    } catch {
      // Long-task entries are not available in every browser runtime.
    }
  }
});
const requestCounts = new Map();
const runtimeFailures = [];
page.on("request", (request) => {
  const url = new URL(request.url());
  if (url.origin !== new URL(baseURL).origin || url.pathname !== "/api/paginate") return;
  const table = url.searchParams.get("table") || "unknown";
  requestCounts.set(table, (requestCounts.get(table) || 0) + 1);
});
page.on("pageerror", (error) => runtimeFailures.push(`pageerror: ${error.message}`));
page.on("console", (message) => {
  if (message.type() === "error") runtimeFailures.push(`console: ${message.text()}`);
});

try {
  await authenticate(context);
  await page.goto(`${baseURL}${route}?bf_perf_debug=true`, { waitUntil: "domcontentloaded" });
  await page.waitForFunction(() => performance.getEntriesByName("bf:loader:hidden").length > 0);
  const loaderHiddenMs = await page.evaluate(
    () => Math.round(performance.getEntriesByName("bf:loader:hidden").at(-1)?.startTime || 0),
  );
  await page.waitForTimeout(warmSettleMs);

  const firstVisits = [];
  for (const tabCase of tabCases) firstVisits.push(await measureTab(page, tabCase, requestCounts));
  const repeatVisits = [];
  for (const tabCase of tabCases.slice(0, 2)) {
    repeatVisits.push(await measureTab(page, { ...tabCase, label: `${tabCase.label} (lặp lại)` }, requestCounts));
  }

  const measuredVisits = [...firstVisits, ...repeatVisits].filter((item) => !item.skipped);
  const failures = measuredVisits.length === 0
    ? ["No visible business tabs were available for measurement"]
    : measuredVisits.flatMap((item) => {
    const itemFailures = [];
    if (item.durationMs > tabLimitMs) itemFailures.push(`${item.label}: ${item.durationMs} ms > ${tabLimitMs} ms`);
    if (item.skeletonObserved) itemFailures.push(`${item.label}: skeleton observed after warming`);
    if (item.paginationRequests > 0) itemFailures.push(`${item.label}: ${item.paginationRequests} duplicate pagination request(s)`);
    return itemFailures;
    });
  failures.push(...runtimeFailures);
  const result = {
    generatedAt: new Date().toISOString(),
    baseURL,
    route,
    activeRole,
    warmSettleMs,
    tabLimitMs,
    loaderHiddenMs,
    firstVisits,
    repeatVisits,
    warmPaginationRequests: Object.fromEntries(requestCounts),
    runtimeFailures,
    passed: failures.length === 0,
    failures,
  };
  await fs.mkdir(path.dirname(outputPath), { recursive: true });
  await fs.writeFile(outputPath, `${JSON.stringify(result, null, 2)}\n`, "utf8");
  console.log(JSON.stringify(result, null, 2));
  if (shouldAssert && failures.length > 0) process.exitCode = 1;
} finally {
  await context.close();
  await browser.close();
}
