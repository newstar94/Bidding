import fs from "node:fs/promises";
import os from "node:os";
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
// Recalibrated against the production secure artifact after route modules became
// click-owned (ADR 0024). The previous 800/325 ms limits predated that graph and
// were already below the recorded 2026-08-27 baseline. These limits retain a
// bounded host-scheduler margin over the clean 30-run 1841/391 ms p95 sample.
const coldP95LimitMs = Math.max(1, Number(process.env.STARTUP_COLD_P95_MS || 2100));
const warmP95LimitMs = Math.max(1, Number(process.env.STARTUP_WARM_P95_MS || 450));
const longTaskLimitMs = Math.max(1, Number(process.env.STARTUP_LONG_TASK_MS || 100));
const disableServiceWorker = process.env.STARTUP_DISABLE_SERVICE_WORKER === "1";
// Endpoint protection can inject local scripts into every Chromium page. Keep
// those host-owned resources out of the application benchmark without using
// Playwright routing, which would disable Chromium's HTTP cache and corrupt the
// warm measurement. Override with a comma-separated list; use an empty value to
// disable blocking explicitly.
const blockedURLPatterns = process.env.STARTUP_BLOCKED_URLS === ""
  ? []
  : String(process.env.STARTUP_BLOCKED_URLS || "http://local.adguard.org/*")
    .split(",")
    .map((value) => value.trim())
    .filter(Boolean);
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

function hostCpuSnapshot() {
  return os.cpus().reduce((summary, cpu) => {
    const total = Object.values(cpu.times).reduce((sum, value) => sum + value, 0);
    return {
      idle: summary.idle + cpu.times.idle,
      total: summary.total + total,
    };
  }, { idle: 0, total: 0 });
}

function hostCpuBusyPercent(before, after) {
  const total = after.total - before.total;
  const idle = after.idle - before.idle;
  if (total <= 0) return null;
  return Math.round(((total - idle) / total) * 1000) / 10;
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
            attribution: (entry.attribution || []).map((item) => ({
              name: item.name || "",
              containerType: item.containerType || "",
              containerName: item.containerName || "",
              containerSrc: item.containerSrc || "",
            })),
          });
        }
      });
      observer.observe({ type: "longtask", buffered: true });
    } catch {
      // A browser without Long Tasks support still reports all startup marks.
    }
  });
}

async function isolateHostInjectedResources(page) {
  if (!blockedURLPatterns.length) return null;
  const session = await page.context().newCDPSession(page);
  await session.send("Network.enable");
  await session.send("Network.setBlockedURLs", { urls: blockedURLPatterns });
  return session;
}

async function authenticate(context) {
  const response = await context.request.post(`${baseURL}/api/auth/login`, {
    data: { username, password, remember: false },
  });
  if (!response.ok()) {
    const responseBody = (await response.text().catch(() => "")).slice(0, 500);
    throw new Error(`Login failed: HTTP ${response.status()}${responseBody ? ` ${responseBody}` : ""}`);
  }
}

async function measureNavigation(page, mode, run) {
  const cpuBefore = hostCpuSnapshot();
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
    const marks = {
      appModuleStart: mark("app-module-start"),
      sessionCheckStart: mark("session-check-start"),
      sessionCheckEnd: mark("session-check-end"),
      workspaceImportStart: mark("workspace-import-start"),
      workspaceImportEnd: mark("workspace-import-end"),
      initStart: mark("init:start"),
      loaderHidden: mark("loader:hidden"),
    };
    const startupPhase = (startTime) => {
      if (marks.appModuleStart !== null && startTime < marks.appModuleStart) return "document-bootstrap";
      if (
        marks.workspaceImportStart !== null
        && marks.workspaceImportEnd !== null
        && startTime >= marks.workspaceImportStart
        && startTime <= marks.workspaceImportEnd
      ) return "workspace-module-import";
      if (marks.initStart !== null && startTime >= marks.initStart) return "controller-init-hydration";
      if (marks.sessionCheckStart !== null && startTime >= marks.sessionCheckStart) return "session-bootstrap";
      return "app-bootstrap";
    };
    const serverTiming = (navigation?.serverTiming || []).map((entry) => ({
      name: entry.name,
      duration: Math.round(entry.duration * 10) / 10,
    }));
    return {
      mode: sampleMode,
      run: sampleRun,
      releaseId: String(globalThis.__BIDDINGFLOW_RELEASE__ || "unknown"),
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
      longTasks: longTasks.map((entry) => {
        const endTime = entry.startTime + entry.duration;
        return {
          startTime: Math.round(entry.startTime),
          duration: Math.round(entry.duration),
          phase: startupPhase(entry.startTime),
          attribution: entry.attribution,
          overlappingResources: resources
            .filter((resource) => (
              resource.startTime <= endTime
              && resource.responseEnd >= entry.startTime
            ))
            .map((resource) => ({
              name: resource.name,
              initiatorType: resource.initiatorType,
            })),
        };
      }),
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
    return {
      ...browserMetrics,
      hostCpuBusyPercent: hostCpuBusyPercent(cpuBefore, hostCpuSnapshot()),
      runtimeFailures,
    };
  } finally {
    page.off("pageerror", onPageError);
    page.off("console", onConsole);
    page.off("response", onResponse);
  }
}

async function createAuthenticatedContext(browser, authenticatedState) {
  const context = await browser.newContext({
    locale: "vi-VN",
    timezoneId: "Asia/Ho_Chi_Minh",
    storageState: authenticatedState,
  });
  await addPerformanceObserver(context);
  if (disableServiceWorker) {
    await context.addInitScript(() => {
      if (typeof ServiceWorkerContainer !== "function") return;
      Object.defineProperty(ServiceWorkerContainer.prototype, "register", {
        configurable: true,
        writable: true,
        value: () => Promise.reject(
          new DOMException("Disabled by startup benchmark", "AbortError"),
        ),
      });
    });
  }
  return context;
}

const launchOptions = { headless: true };
if (process.env.STARTUP_BROWSER_CHANNEL) launchOptions.channel = process.env.STARTUP_BROWSER_CHANNEL;
const browser = await chromium.launch(launchOptions);
const browserVersion = browser.version();
const coldSamples = [];
const warmSamples = [];

try {
  const authenticatedContext = await browser.newContext();
  await authenticate(authenticatedContext);
  const authenticatedState = await authenticatedContext.storageState();
  await authenticatedContext.close();

  for (let run = 1; run <= coldRuns; run += 1) {
    const context = await createAuthenticatedContext(browser, authenticatedState);
    const page = await context.newPage();
    await isolateHostInjectedResources(page);
    coldSamples.push(await measureNavigation(page, "cold", run));
    await context.close();
  }

  const warmContext = await createAuthenticatedContext(browser, authenticatedState);
  const warmPage = await warmContext.newPage();
  await isolateHostInjectedResources(warmPage);
  await measureNavigation(warmPage, "warmup", 0);
  for (let run = 1; run <= warmRuns; run += 1) {
    warmSamples.push(await measureNavigation(warmPage, "warm", run));
  }
  await warmContext.close();
} finally {
  await browser.close();
}

const releaseIds = [...new Set(
  [...coldSamples, ...warmSamples]
    .map((sample) => sample.releaseId)
    .filter(Boolean),
)];
const result = {
  generatedAt: new Date().toISOString(),
  baseURL,
  route,
  releaseId: releaseIds.length === 1 ? releaseIds[0] : null,
  releaseIds,
  browserVersion,
  runtime: {
    node: process.version,
    platform: process.platform,
    arch: process.arch,
    logicalCpuCount: os.cpus().length,
  },
  disableServiceWorker,
  blockedURLPatterns,
  thresholds: { coldP95LimitMs, warmP95LimitMs, longTaskLimitMs },
  cold: summarize(coldSamples),
  warm: summarize(warmSamples),
};
result.passed = result.cold.p95Ms <= coldP95LimitMs
  && result.warm.p95Ms <= warmP95LimitMs
  && result.cold.longestTaskMs <= longTaskLimitMs
  && result.warm.longestTaskMs <= longTaskLimitMs
  && releaseIds.length === 1
  && [...coldSamples, ...warmSamples].every((sample) => sample.runtimeFailures.length === 0);

await fs.mkdir(path.dirname(outputPath), { recursive: true });
await fs.writeFile(outputPath, `${JSON.stringify(result, null, 2)}\n`, "utf8");
process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);

if (shouldAssert && !result.passed) process.exitCode = 1;
