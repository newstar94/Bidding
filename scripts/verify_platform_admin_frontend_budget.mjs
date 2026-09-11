import { createServer } from "node:http";
import { readFile, stat } from "node:fs/promises";
import path from "node:path";
import process from "node:process";
import { fileURLToPath, pathToFileURL } from "node:url";
import { chromium } from "playwright";

export const ADMIN_ENTRY = "frontend/admin-platform/AdminEntry.js";
export const BUDGETS = Object.freeze({
  adminJsBytes: 425_000,
  adminCssBytes: 575_000,
  initialRequests: 12,
  dashboardLoadMs: 1_500,
});

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const DIST_ROOT = path.join(ROOT, "dist");
const MANIFEST_PATH = path.join(DIST_ROOT, ".vite", "manifest.json");
const TEMPLATE_PATH = path.join(ROOT, "views", "admin", "index.html");
const SESSION = {
  valid: true,
  user: {
    id: "admin-budget",
    name: "Quản trị hiệu năng",
    username: "admin-budget",
    platform_role: "super_admin",
  },
};
const OVERVIEW = {
  metrics: {
    organizations: { total: 2 },
    users: { total: 7 },
    subscriptions: { active: 1 },
    billing: { verifiedRevenue: 1_250_000 },
  },
  recentOrganizations: [{ name: "Tổ chức đo hiệu năng", status: "active" }],
  generatedAt: "2026-09-11T00:00:00Z",
};

function safeManifestAsset(relativePath) {
  if (!/^assets\/[A-Za-z0-9_.-]+$/u.test(relativePath)) {
    throw new Error(`Unsafe manifest asset path: ${relativePath}`);
  }
  return relativePath;
}

export function collectAdminManifestAssets(manifest, entryKey = ADMIN_ENTRY) {
  if (!manifest[entryKey]?.isEntry) {
    throw new Error(`Secure build manifest is missing ${entryKey}.`);
  }
  const visited = new Set();
  const javascript = new Set();
  const stylesheets = new Set();

  function visit(key) {
    if (visited.has(key)) return;
    const entry = manifest[key];
    if (!entry) throw new Error(`Manifest import ${key} is missing.`);
    visited.add(key);
    if (entry.file?.endsWith(".js")) javascript.add(safeManifestAsset(entry.file));
    for (const css of entry.css || []) stylesheets.add(safeManifestAsset(css));
    for (const importedKey of entry.imports || []) visit(importedKey);
  }

  visit(entryKey);
  return {
    javascript: [...javascript].sort(),
    stylesheets: [...stylesheets].sort(),
  };
}

async function measuredAssets(distRoot, assets) {
  const rows = [];
  for (const file of assets) {
    const bytes = (await stat(path.join(distRoot, file))).size;
    rows.push({ file, bytes });
  }
  return { files: rows, bytes: rows.reduce((total, row) => total + row.bytes, 0) };
}

export function enforceBudgets(measurements, budgets = BUDGETS) {
  const failures = [];
  for (const [metric, limit] of Object.entries(budgets)) {
    const value = measurements[metric];
    if (!Number.isFinite(value)) failures.push(`${metric} was not measured`);
    else if (value > limit) failures.push(`${metric}=${value} exceeds ${limit}`);
  }
  if (failures.length) throw new Error(`Platform Admin frontend budget failed: ${failures.join("; ")}`);
}

function contentType(file) {
  if (file.endsWith(".js")) return "text/javascript; charset=utf-8";
  if (file.endsWith(".css")) return "text/css; charset=utf-8";
  if (file.endsWith(".woff2")) return "font/woff2";
  return "application/octet-stream";
}

async function buildShell(template, entry) {
  const css = (entry.css || [])
    .map((file) => `<link rel="stylesheet" href="/dist/${safeManifestAsset(file)}">`)
    .join("\n");
  return template
    .replace("__BF_ADMIN_STYLES__", css)
    .replace("__BF_ADMIN_VENDOR_SCRIPT__", "")
    .replace("__BF_ADMIN_ENTRY__", `/dist/${safeManifestAsset(entry.file)}`)
    .replace("__BF_ADMIN_SESSION__", JSON.stringify(SESSION).replaceAll("<", "\\u003c"));
}

async function startHarness(shell, distRoot) {
  const server = createServer(async (request, response) => {
    try {
      const url = new URL(request.url || "/", "http://127.0.0.1");
      if (url.pathname === "/admin") {
        response.writeHead(200, { "content-type": "text/html; charset=utf-8", "cache-control": "no-store" });
        response.end(shell);
        return;
      }
      if (url.pathname === "/api/admin/overview") {
        response.writeHead(200, { "content-type": "application/json", "cache-control": "no-store" });
        response.end(JSON.stringify(OVERVIEW));
        return;
      }
      if (url.pathname.startsWith("/dist/assets/")) {
        const relativePath = safeManifestAsset(url.pathname.slice("/dist/".length));
        const body = await readFile(path.join(distRoot, relativePath));
        response.writeHead(200, { "content-type": contentType(relativePath), "cache-control": "no-store" });
        response.end(body);
        return;
      }
      response.writeHead(404, { "content-type": "text/plain; charset=utf-8" });
      response.end("Not found");
    } catch (error) {
      response.writeHead(500, { "content-type": "text/plain; charset=utf-8" });
      response.end(error.message);
    }
  });
  await new Promise((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", resolve);
  });
  return server;
}

async function measureBrowserRun(browser, baseUrl) {
  const context = await browser.newContext({ locale: "vi-VN", timezoneId: "Asia/Ho_Chi_Minh" });
  const page = await context.newPage();
  const requests = [];
  const pageErrors = [];
  const networkErrors = [];
  page.on("request", (request) => {
    if (request.url().startsWith(baseUrl)) {
      requests.push({ type: request.resourceType(), path: new URL(request.url()).pathname });
    }
  });
  page.on("pageerror", (error) => pageErrors.push(error.message));
  page.on("requestfailed", (request) => {
    if (request.url().startsWith(baseUrl)) {
      networkErrors.push(`${request.method()} ${request.url()}: ${request.failure()?.errorText || "failed"}`);
    }
  });
  page.on("response", (response) => {
    if (response.url().startsWith(baseUrl) && response.status() >= 400) {
      networkErrors.push(`${response.request().method()} ${response.url()}: HTTP ${response.status()}`);
    }
  });
  try {
    const response = await page.goto(`${baseUrl}/admin`, { waitUntil: "domcontentloaded" });
    if (!response?.ok()) throw new Error(`Admin harness returned HTTP ${response?.status() || "unknown"}.`);
    await page.locator("#recent-activity-title").waitFor({ state: "visible", timeout: 10_000 });
    await page.evaluate(() => document.fonts.ready);
    const timing = await page.evaluate(() => ({
      dashboardLoadMs: performance.now(),
      appModuleStartMs: performance.getEntriesByName("bf:app-module-start").at(-1)?.startTime ?? null,
      loaderHiddenMs: performance.getEntriesByName("bf:loader:hidden").at(-1)?.startTime ?? null,
    }));
    if (pageErrors.length) throw new Error(`Admin page errors: ${pageErrors.join(" | ")}`);
    if (networkErrors.length) throw new Error(`Admin network errors: ${networkErrors.join(" | ")}`);
    return {
      ...timing,
      initialRequests: requests.length,
      requests,
    };
  } finally {
    await context.close();
  }
}

export async function run({ repetitions = 3, distRoot = DIST_ROOT } = {}) {
  const manifestPath = path.join(distRoot, ".vite", "manifest.json");
  let manifest;
  try {
    manifest = JSON.parse(await readFile(manifestPath, "utf8"));
  } catch (error) {
    throw new Error(`Secure build manifest is unavailable at ${manifestPath}; run npm run build:secure first. (${error.message})`);
  }
  const assets = collectAdminManifestAssets(manifest);
  const [javascript, stylesheets, template] = await Promise.all([
    measuredAssets(distRoot, assets.javascript),
    measuredAssets(distRoot, assets.stylesheets),
    readFile(TEMPLATE_PATH, "utf8"),
  ]);
  const shell = await buildShell(template, manifest[ADMIN_ENTRY]);
  const server = await startHarness(shell, distRoot);
  const address = server.address();
  const baseUrl = `http://127.0.0.1:${address.port}`;
  let browser;
  try {
    browser = await chromium.launch({ headless: true });
    const runs = [];
    for (let iteration = 0; iteration < repetitions; iteration += 1) {
      runs.push(await measureBrowserRun(browser, baseUrl));
    }
    const measurements = {
      adminJsBytes: javascript.bytes,
      adminCssBytes: stylesheets.bytes,
      initialRequests: Math.max(...runs.map((result) => result.initialRequests)),
      dashboardLoadMs: Math.round(Math.max(...runs.map((result) => result.dashboardLoadMs)) * 100) / 100,
    };
    enforceBudgets(measurements);
    return {
      status: "PASS",
      budgets: BUDGETS,
      measurements,
      assets: { javascript, stylesheets },
      runs,
      evidence: "secure-build files and fresh Chromium contexts against an isolated local admin shell",
    };
  } finally {
    await browser?.close();
    await new Promise((resolve, reject) => server.close((error) => (error ? reject(error) : resolve())));
  }
}

async function main() {
  const argument = process.argv.find((value) => value.startsWith("--repetitions="));
  const repetitions = argument ? Number(argument.split("=", 2)[1]) : 3;
  if (!Number.isInteger(repetitions) || repetitions < 1 || repetitions > 10) {
    throw new Error("--repetitions must be an integer between 1 and 10.");
  }
  const report = await run({ repetitions });
  process.stdout.write(`${JSON.stringify(report, null, 2)}\n`);
}

if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) {
  main().catch((error) => {
    process.stderr.write(`${JSON.stringify({ status: "FAIL", error: error.message })}\n`);
    process.exitCode = 1;
  });
}
