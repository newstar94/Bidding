import fs from "node:fs/promises";
import path from "node:path";
import process from "node:process";
import { chromium } from "@playwright/test";

const argumentsSet = new Set(process.argv.slice(2));
const shouldAssert = argumentsSet.has("--assert");
const baseURL = String(process.env.E2E_BASE_URL || "http://127.0.0.1:8000").replace(/\/$/, "");
const route = process.env.STARTUP_ROUTE || "/tong-quan-admin";
const username = process.env.E2E_USERNAME || process.env.ADMIN_USERNAME || "admin";
const password = process.env.E2E_PASSWORD || process.env.ADMIN_PASSWORD;
// With only 10 samples, nearest-rank p95 equals the maximum and makes the gate
// overly sensitive to one scheduler/antivirus outlier. Thirty samples keep the
// gate quick while making p95 a useful distribution statistic.
const coldRuns = Math.max(1, Number(process.env.STARTUP_COLD_RUNS || 30));
const warmRuns = Math.max(1, Number(process.env.STARTUP_WARM_RUNS || 30));
const coldP95LimitMs = Math.max(1, Number(process.env.STARTUP_COLD_P95_MS || 800));
// Calibrated from three 30-run local samples (combined warm p95: 308 ms).
// Keep a small scheduler/antivirus margin while still failing meaningful regressions.
const warmP95LimitMs = Math.max(1, Number(process.env.STARTUP_WARM_P95_MS || 325));
const longTaskLimitMs = Math.max(1, Number(process.env.STARTUP_LONG_TASK_MS || 100));
const disableServiceWorker = process.env.STARTUP_DISABLE_SERVICE_WORKER === "1";
const outputPath = path.resolve(process.env.STARTUP_METRICS_OUTPUT || "data/logs/startup-performance.json");

if (!password) {
  throw new Error("E2E_PASSWORD or ADMIN_PASSWORD must be configured.");
}

function percentile(values, ratio) {
  if (!values.length) return null;
  const sorted = [...values].sort((left, right) => left - right);
  return sorted[Math.max(0, Math.ceil(sorted.length * ratio) - 1)];
}

function summarize(samples) {
  const durations = samples.map((sample) => sample.loaderHiddenMs);
  const apiRequestCounts = samples.map((sample) => sample.startupApiRequestCount);
  const apiTransferBytes = samples.map((sample) => sample.startupApiTransferBytes);
  return {
    count: samples.length,
    minMs: Math.min(...durations),
    medianMs: percentile(durations, 0.5),
    p95Ms: percentile(durations, 0.95),
    maxMs: Math.max(...durations),
    longestTaskMs: Math.max(0, ...samples.map((sample) => sample.longestTaskMs)),
    startupApiRequestMedian: percentile(apiRequestCounts, 0.5),
    startupApiRequestP95: percentile(apiRequestCounts, 0.95),
    startupApiTransferBytesMedian: percentile(apiTransferBytes, 0.5),
    startupApiTransferBytesP95: percentile(apiTransferBytes, 0.95),
    samples,
  };
}

async function addPerformanceObserver(context) {
  await context.addInitScript(() => {
    globalThis.__bfStartupLongTasks = [];
    try {
      const observer = new PerformanceObserver((list) => {
        for (const entry of list.getEntries()) {
          globalThis.__bfStartupLongTasks.push({
            startTime: entry.startTime,
            duration: entry.duration,
          });
        }
      });
      observer.observe({ type: "longtask", buffered: true });
    } catch {
      // A browser without Long Tasks support still reports all startup marks.
    }
  });
}

async function authenticate(context) {
  const response = await context.request.post(`${baseURL}/api/auth/login`, {
    data: { username, password, remember: false },
  });
  if (!response.ok()) {
    throw new Error(`Login failed: HTTP ${response.status()}`);
  }
}

async function measureNavigation(page, mode, run) {
  const runtimeFailures = [];
  const appOrigin = new URL(baseURL).origin;
  const onPageError = (error) => runtimeFailures.push(`pageerror: ${error.message}`);
  const onConsole = (message) => {
    if (message.type() !== "error") return;
    const location = message.location();
    if (location.url && !location.url.startsWith(appOrigin)) return;
    runtimeFailures.push(`console: ${message.text()}`);
  };
  const onResponse = (response) => {
    if (response.status() >= 400 && response.url().startsWith(appOrigin)) {
      runtimeFailures.push(`http: ${response.status()} ${response.url()}`);
    }
  };
  page.on("pageerror", onPageError);
  page.on("console", onConsole);
  page.on("response", onResponse);
  try {
    const response = await page.goto(`${baseURL}${route}`, { waitUntil: "domcontentloaded" });
    if (!response?.ok()) {
      throw new Error(`Navigation failed: HTTP ${response?.status() || "unknown"}`);
    }
    await page.waitForFunction(() => performance.getEntriesByName("bf:loader:hidden").length > 0);
    const browserMetrics = await page.evaluate(({ mode: sampleMode, run: sampleRun }) => {
    const mark = (name) => performance.getEntriesByName(`bf:${name}`).at(-1)?.startTime ?? null;
    const navigation = performance.getEntriesByType("navigation").at(-1);
    const resources = performance.getEntriesByType("resource");
    const loaderHiddenMs = Math.round(mark("loader:hidden"));
    const startupApiResources = resources.filter((entry) => {
      try {
        return new URL(entry.name).pathname.startsWith("/api/")
          && entry.responseEnd <= loaderHiddenMs;
      } catch {
        return false;
      }
    });
    const longTasks = (globalThis.__bfStartupLongTasks || []).filter(
      (entry) => entry.startTime <= loaderHiddenMs,
    );
    const serverTiming = (navigation?.serverTiming || []).map((entry) => ({
      name: entry.name,
      duration: Math.round(entry.duration * 10) / 10,
    }));
    return {
      mode: sampleMode,
      run: sampleRun,
      loaderHiddenMs,
      appModuleStartMs: Math.round(mark("app-module-start") ?? 0),
      workspaceImportMs: Math.round((mark("workspace-import-end") ?? 0) - (mark("workspace-import-start") ?? 0)),
      initToLoaderMs: Math.round((mark("loader:hidden") ?? 0) - (mark("init:start") ?? 0)),
      domContentLoadedMs: Math.round(navigation?.domContentLoadedEventEnd ?? 0),
      responseStartMs: Math.round(navigation?.responseStart ?? 0),
      transferBytes: Math.round(resources.reduce((total, entry) => total + (entry.transferSize || 0), 0)),
      resourceCount: resources.length,
      startupApiRequestCount: startupApiResources.length,
      startupApiTransferBytes: Math.round(startupApiResources.reduce(
        (total, entry) => total + (entry.transferSize || 0), 0,
      )),
      startupApiPaths: startupApiResources.map((entry) => new URL(entry.name).pathname),
      serviceWorkerControlled: Boolean(navigator.serviceWorker?.controller),
      longTaskCount: longTasks.length,
      longestTaskMs: Math.round(Math.max(0, ...longTasks.map((entry) => entry.duration))),
      longTasks: longTasks.map((entry) => ({
        startTime: Math.round(entry.startTime),
        duration: Math.round(entry.duration),
      })),
      slowestResources: [...resources]
        .sort((left, right) => right.duration - left.duration)
        .slice(0, 10)
        .map((entry) => ({
          name: entry.name,
          initiatorType: entry.initiatorType,
          startTime: Math.round(entry.startTime),
          duration: Math.round(entry.duration),
          transferSize: entry.transferSize || 0,
        })),
      documentScripts: [...document.scripts].map((script) => script.src || "inline"),
      serverTiming,
    };
    }, { mode, run });
    return { ...browserMetrics, runtimeFailures };
  } finally {
    page.off("pageerror", onPageError);
    page.off("console", onConsole);
    page.off("response", onResponse);
  }
}

async function createAuthenticatedContext(browser) {
  const context = await browser.newContext({ locale: "vi-VN", timezoneId: "Asia/Ho_Chi_Minh" });
  await addPerformanceObserver(context);
  if (disableServiceWorker) {
    await context.route("**/service-worker.js?**", (requestRoute) => requestRoute.abort());
  }
  await authenticate(context);
  return context;
}

const launchOptions = { headless: true };
if (process.env.STARTUP_BROWSER_CHANNEL) launchOptions.channel = process.env.STARTUP_BROWSER_CHANNEL;
const browser = await chromium.launch(launchOptions);
const coldSamples = [];
const warmSamples = [];

try {
  for (let run = 1; run <= coldRuns; run += 1) {
    const context = await createAuthenticatedContext(browser);
    const page = await context.newPage();
    coldSamples.push(await measureNavigation(page, "cold", run));
    await context.close();
  }

  const warmContext = await createAuthenticatedContext(browser);
  const warmPage = await warmContext.newPage();
  await measureNavigation(warmPage, "warmup", 0);
  for (let run = 1; run <= warmRuns; run += 1) {
    warmSamples.push(await measureNavigation(warmPage, "warm", run));
  }
  await warmContext.close();
} finally {
  await browser.close();
}

const result = {
  generatedAt: new Date().toISOString(),
  baseURL,
  route,
  disableServiceWorker,
  thresholds: { coldP95LimitMs, warmP95LimitMs, longTaskLimitMs },
  cold: summarize(coldSamples),
  warm: summarize(warmSamples),
};
result.passed = result.cold.p95Ms <= coldP95LimitMs
  && result.warm.p95Ms <= warmP95LimitMs
  && result.cold.longestTaskMs <= longTaskLimitMs
  && result.warm.longestTaskMs <= longTaskLimitMs
  && [...coldSamples, ...warmSamples].every((sample) => sample.runtimeFailures.length === 0);

await fs.mkdir(path.dirname(outputPath), { recursive: true });
await fs.writeFile(outputPath, `${JSON.stringify(result, null, 2)}\n`, "utf8");
process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);

if (shouldAssert && !result.passed) process.exitCode = 1;
