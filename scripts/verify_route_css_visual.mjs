import fs from "node:fs";
import http from "node:http";
import path from "node:path";
import os from "node:os";
import { chromium } from "playwright";
import { STARTUP_LONG_TASK_LIMIT_MS } from "./profile_startup_long_tasks.mjs";
import {
  installRoutePerformanceCollectors,
  waitForRoutePerformanceSnapshot,
} from "./route_performance_collectors.mjs";
import {
  landingFixturePreloadTags,
  resolveLandingFixturePreloads,
  routeFixtureCacheControl,
} from "./route_fixture_policy.mjs";
import { withRouteFixtureNavigation } from "./route_fixture_navigation.mjs";

const DIST_ROOT = path.resolve("dist");
const TEST_HOST = "127.0.0.1";
const manifest = JSON.parse(
  fs.readFileSync(path.join(DIST_ROOT, ".vite", "manifest.json"), "utf8"),
);
const appCss = manifest["frontend/app/app.js"]?.css?.[0];
const appScript = manifest["frontend/app/app.js"]?.file;
const landingShellCss = manifest["views/css/landing-shell.css"]?.file;
if (!appCss) throw new Error("Route CSS visual smoke requires a built app stylesheet.");
if (!appScript) throw new Error("Route CSS visual smoke requires a built app script.");
if (!landingShellCss?.endsWith(".css")) {
  throw new Error("Route CSS visual smoke requires the built landing shell stylesheet.");
}
if (!fs.statSync(path.join(DIST_ROOT, landingShellCss), { throwIfNoEntry: false })?.isFile()) {
  throw new Error("Route CSS visual smoke requires an existing landing shell stylesheet.");
}
const landingMarkup = fs.readFileSync("views/components/landing_page.html", "utf8");
// Representative test data only; these prices are never published or persisted.
const commercialFixture = {
  releaseId: "route-fixture", releaseChecksum: "route-fixture-checksum",
  offers: [
    ["account", "personal", "Cá nhân"],
    ["organization", "silver", "Bạc"],
    ["organization", "gold", "Vàng"],
    ["organization", "diamond", "Kim cương"],
  ].flatMap(([ownerKind, tier, name], index) => ["internal", "connected"].flatMap((variant) => ["yearly", "monthly"].map((period) => ({
    code: `fixture.${tier}.${variant}.${period}`, ownerKind, tier, variant,
    salesState: "sellable", memberQuota: index + 1,
    includedProcurementQuota: variant === "connected" ? 20 : 0,
    violationCheckEnabled: false,
    price: { period, currency: "VND", subtotal: 100000 * (index + 1), tax: 0, total: 100000 * (index + 1) },
    display: { name, description: "Dữ liệu minh họa kiểm tra giao diện", visibility: "public", benefits: ["Quyền lợi minh họa"] },
  })))),
  creditPacks: [], quotaWarnings: [70, 90, 100],
};
const landingPreloads = resolveLandingFixturePreloads(manifest, (file) => (
  fs.statSync(path.join(DIST_ROOT, file), { throwIfNoEntry: false })?.isFile() === true
));
const requiredStartupAssets = [...new Set([
  ...landingPreloads.moduleFiles, ...landingPreloads.fontFiles, landingShellCss,
])].map((file) => "/dist/" + file);
const indexMarkup = fs.readFileSync("views/index.html", "utf8");
const shellScriptTags = [...indexMarkup.matchAll(
  /<script src="(\/vendor\/(?:route-shell\.js|lucide\/lucide-shim\.js)\?[^"]+)"><\/script>/g,
)].map((match) => match[0]);
if (shellScriptTags.length !== 2) throw new Error("Landing fixture requires both production shell scripts.");

const routeCss = (manifestKey) => {
  const entry = manifest[manifestKey] || {};
  const file = [...(entry.css || []), ...(entry.assets || [])]
    .find((candidate) => candidate.endsWith(".css"));
  if (!file) throw new Error("Missing route stylesheet for " + manifestKey);
  return file;
};

const routes = {
  landing: {
    css: routeCss("frontend/landing/LandingPage.js"),
    shell: "landing",
    body: '<div class="landing-page"><header class="landing-header"><div class="landing-container landing-header-inner"><strong>BiddingFlow</strong><button class="landing-menu-toggle">Menu</button><a class="landing-button landing-button-primary">Bắt đầu</a></div></header><main><section class="landing-hero"><div class="landing-container landing-hero-layout"><div class="landing-hero-copy"><div class="landing-eyebrow"><span></span>Quy trình thống nhất</div><h1>Quản lý đấu thầu liền mạch.</h1><p>Dữ liệu xuyên suốt từ kế hoạch đến hợp đồng.</p></div><figure class="landing-product-proof"><figcaption>Dữ liệu minh họa</figcaption></figure></div></section></main></div>',
  },
  legal: {
    css: routeCss("frontend/legal/LegalPage.js"),
    shell: "legal",
    body: '<div class="legal-page"><header class="legal-header"><div class="legal-container legal-header-inner"><strong>BiddingFlow</strong><a class="legal-login-link">Đăng nhập</a></div></header><main class="legal-main"><section class="legal-hero"><div class="legal-container legal-hero-inner"><p class="legal-eyebrow">Thông tin pháp lý</p><h1>Điều khoản và chính sách</h1></div></section><div class="legal-container legal-layout"><article class="legal-document"><div class="legal-document-note">Nội dung đã kiểm tra bố cục.</div></article></div></main></div>',
  },
  assistant: {
    css: routeCss("frontend/assistant/AssistantLoader.js"),
    shell: "workspace",
    body: '<section class="bf-assistant-panel"><header class="bf-assistant-header"><div class="bf-assistant-heading"><span class="bf-assistant-eyebrow">Trợ lý</span><h2 class="bf-assistant-title">BiddingFlow Assistant</h2></div></header><div class="bf-assistant-context">Không gian làm việc hiện tại</div><div class="bf-assistant-messages"></div></section>',
  },
  dashboard: {
    css: routeCss("frontend/app/DashboardView.js"),
    shell: "workspace",
    body: '<main class="dashboard-operations"><section class="dashboard-metric-grid"><article class="dashboard-metric-card metric-blue"><div class="dashboard-metric-head"><span class="dashboard-metric-icon"></span><div><span>Gói thầu</span><strong>12</strong></div></div></article><article class="dashboard-metric-card metric-green"><div class="dashboard-metric-head"><span class="dashboard-metric-icon"></span><div><span>Hợp đồng</span><strong>4</strong></div></div></article></section></main>',
  },
};
const htmlHeaders = {
  "content-type": "text/html; charset=utf-8",
  "content-security-policy": "default-src 'self'; script-src 'self'; style-src 'self'; img-src 'self'; font-src 'self'; object-src 'none'; base-uri 'self'",
};
const landingDocument = (assetOrigin = "") => (
  '<!doctype html><html lang="vi" data-trial-full-access="false" data-bf-shell="landing"><head>'
  + (assetOrigin ? '<base href="' + assetOrigin + '/">' : '')
  + '<meta name="viewport" content="width=device-width,initial-scale=1">'
  + '<meta name="bf-app-debug" content="false">'
  + shellScriptTags[0]
  + landingFixturePreloadTags(landingPreloads, assetOrigin)
  + '<link rel="stylesheet" href="' + assetOrigin + '/dist/' + landingShellCss
  + '" data-runtime-styles data-bf-shell-styles="landing">'
  + '<script id="bf-session-bootstrap" type="application/json">{"valid":false}</script>'
  + '</head><body class="bf-init-loading">' + landingMarkup
  + shellScriptTags[1]
  + '<script type="module" src="' + assetOrigin + '/dist/' + appScript + '"></script>'
  + '</body></html>'
);

let measuredAssetRequests = 0;
const server = http.createServer((request, response) => {
  const originalWriteHead = response.writeHead.bind(response);
  response.writeHead = (statusCode, ...args) => {
    const cacheControl = routeFixtureCacheControl(request.url, statusCode);
    if (cacheControl) response.setHeader("cache-control", cacheControl);
    return originalWriteHead(statusCode, ...args);
  };
  const pathname = new URL(request.url, "http://127.0.0.1").pathname;
  if (pathname === "/") {
    response.writeHead(200, htmlHeaders);
    response.end(landingDocument());
    return;
  }
  if (pathname === "/favicon.ico") {
    response.writeHead(204).end();
    return;
  }
  if (pathname === "/api/public/packages") {
    response.writeHead(200, { "content-type": "application/json" });
    response.end('{"packages":[]}');
    return;
  }
  if (pathname === "/api/public/commercial/offers") {
    response.writeHead(200, { "content-type": "application/json" });
    response.end(JSON.stringify(commercialFixture));
    return;
  }
  const routeName = pathname.slice(1);
  if (routes[routeName]) {
    const route = routes[routeName];
    response.writeHead(200, htmlHeaders);
    response.end(
      '<!doctype html><html data-bf-shell="' + route.shell
      + '"><head><meta name="viewport" content="width=device-width,initial-scale=1">'
      + '<link rel="stylesheet" href="/dist/' + appCss + '">'
      + '<link rel="stylesheet" href="/dist/' + route.css + '"></head><body>'
      + route.body + "</body></html>",
    );
    return;
  }
  if (pathname.startsWith("/dist/assets/")) {
    measuredAssetRequests += 1;
    const asset = path.resolve(DIST_ROOT, pathname.slice("/dist/".length));
    if (path.dirname(asset) !== path.resolve(DIST_ROOT, "assets") || !fs.existsSync(asset)) {
      response.writeHead(404).end();
      return;
    }
    const type = asset.endsWith(".css")
      ? "text/css"
      : asset.endsWith(".js")
        ? "text/javascript"
        : asset.endsWith(".woff2") ? "font/woff2" : "application/octet-stream";
    response.writeHead(200, {
      "content-type": type,
      "access-control-allow-origin": "*",
      "access-control-allow-private-network": "true",
    });
    response.end(fs.readFileSync(asset));
    return;
  }
  if (pathname.startsWith("/vendor/")) {
    const asset = path.resolve("views", pathname.slice(1));
    const vendorRoot = path.resolve("views", "vendor");
    if (!asset.startsWith(vendorRoot + path.sep) || !fs.existsSync(asset)) {
      response.writeHead(404).end();
      return;
    }
    response.writeHead(200, {
      "content-type": asset.endsWith(".js") ? "text/javascript" : "application/octet-stream",
    });
    response.end(fs.readFileSync(asset));
    return;
  }
  if (pathname.startsWith("/assets/")) {
    const asset = path.resolve("views", pathname.slice(1));
    const assetRoot = path.resolve("views", "assets");
    if (!asset.startsWith(assetRoot + path.sep) || !fs.existsSync(asset)) {
      response.writeHead(404).end();
      return;
    }
    const type = asset.endsWith(".svg")
      ? "image/svg+xml"
      : asset.endsWith(".webp") ? "image/webp" : "application/octet-stream";
    response.writeHead(200, {
      "content-type": type,
      "access-control-allow-origin": "*",
      "access-control-allow-private-network": "true",
    });
    response.end(fs.readFileSync(asset));
    return;
  }
  response.writeHead(404).end();
});

await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
const port = server.address().port;
const baseUrl = `http://${TEST_HOST}:${port}`;
const browser = await chromium.launch({
  headless: true,
  args: [
    "--no-proxy-server",
  ],
});
const results = [];
const startup = { cold: [], warm: [] };
const layoutOnly = process.argv.includes("--layout-only");
const traceOnce = process.argv.includes("--trace-once");
const percentile = (values, ratio) => {
  if (!values.length) return 0;
  const sorted = [...values].sort((left, right) => left - right);
  return sorted[Math.max(0, Math.ceil(sorted.length * ratio) - 1)];
};
const measureNavigation = async (page) => {
  const assetRequestsBefore = measuredAssetRequests;
  const diagnostics = [];
  const failures = [];
  const onConsole = (message) => {
    const diagnostic = `console:${message.type()}:${message.text()}`;
    diagnostics.push(diagnostic);
    if (message.type() === "error") failures.push(diagnostic);
  };
  const onPageError = (error) => failures.push(`pageerror:${error.message}`);
  const onRequestFailed = (request) => {
    if (request.url().startsWith("http://local.adguard.org/")) return;
    failures.push(`requestfailed:${request.url()}:${request.failure()?.errorText || "unknown"}`);
  };
  const onResponse = (response) => {
    if (response.status() >= 400) failures.push(`response:${response.status()}:${response.url()}`);
  };
  page.on("console", onConsole);
  page.on("pageerror", onPageError);
  page.on("requestfailed", onRequestFailed);
  page.on("response", onResponse);
  try {
    return await withRouteFixtureNavigation(page, {
      url: baseUrl + "/", html: landingDocument(), headers: htmlHeaders,
    }, async () => {
  try {
    await page.waitForFunction(
      () => ["ready", "failed"].includes(document.documentElement.dataset.bfBootstrap),
    );
    const state = await page.evaluate(() => ({
      bootstrap: document.documentElement.dataset.bfBootstrap,
      landingReady: document.body.classList.contains("landing-ready"),
      fatal: Boolean(document.getElementById("bf-bootstrap-fatal")),
    }));
    if (state.bootstrap !== "ready" || !state.landingReady || state.fatal) {
      throw new Error(`Landing bootstrap failed: ${JSON.stringify(state)}`);
    }
  } catch (error) {
    const state = await page.evaluate(() => ({
      bodyClass: document.body.className,
      shell: document.documentElement.dataset.bfShell || "",
      fatal: document.getElementById("bf-bootstrap-fatal")?.textContent || "",
    }));
    throw new Error(
      `Built landing route did not become ready: ${JSON.stringify({
        state,
        diagnostics: [...diagnostics, ...failures].slice(-12),
      })}`,
      { cause: error },
    );
  }
  await page.waitForFunction(() => (
    document.querySelectorAll("#landing-pricing-grid [data-commercial-offer-code]").length === 4
    && document.getElementById("landing-pricing-grid")?.dataset.offerCount === "16"
    && document.querySelector("[data-landing-pricing-notice]")?.hidden === true
  ));
  const readyMs = await page.evaluate(() => Math.round(performance.now() * 100) / 100);
  // Include font application as well as app readiness. Access the FontFaceSet
  // only after a natural first paint, avoiding an eager forced initial layout.
  const productVisual = await page.evaluate(async () => {
    await new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve)));
    await document.fonts.ready;
    const frame = document.querySelector(".landing-product-window");
    const preview = document.querySelector(".landing-app-preview");
    const frameRect = frame?.getBoundingClientRect();
    const previewRect = preview?.getBoundingClientRect();
    return frameRect && previewRect ? {
      frameWidth: frameRect.width,
      frameHeight: frameRect.height,
      previewWidth: previewRect.width,
      previewHeight: previewRect.height,
      rendered: frame.checkVisibility({ contentVisibilityAuto: true })
        && preview.checkVisibility({ contentVisibilityAuto: true }),
    } : null;
  });
  const snapshot = await page.evaluate(waitForRoutePerformanceSnapshot);
  snapshot.readyMs = readyMs;
  const metrics = await page.evaluate((collected) => {
    const { readyMs, observationEndMs, observerStatus } = collected;
    const longTasks = [...collected.longTasks]
      .sort((left, right) => right.duration - left.duration);
    const longAnimationFrames = [...collected.longAnimationFrames];
    const longestTask = longTasks[0] || null;
    const longestAnimationFrame = [...longAnimationFrames]
      .sort((left, right) => right.duration - left.duration)[0] || null;
    const longestTaskMs = Math.round(Number(longestTask?.duration || 0) * 100) / 100;
    return {
      readyMs,
      observationEndMs,
      observerStatus,
      longestTaskMs,
      longestTask,
      longestAnimationFrame,
      longTasks,
      longAnimationFrames,
      marks: performance.getEntriesByType("mark").map((entry) => ({
        name: entry.name,
        startTime: Math.round(entry.startTime * 100) / 100,
      })),
      resources: performance.getEntriesByType("resource").map((entry) => ({
        name: new URL(entry.name).pathname,
        startTime: Math.round(entry.startTime * 100) / 100,
        responseEnd: Math.round(entry.responseEnd * 100) / 100,
        duration: Math.round(entry.duration * 100) / 100,
        transferSize: entry.transferSize,
        decodedBodySize: entry.decodedBodySize,
      })).filter((entry) => entry.startTime <= observationEndMs),
    };
  }, snapshot);
  metrics.productVisual = productVisual;
  if (failures.length) {
    throw new Error("Landing runtime/network errors: " + JSON.stringify(failures.slice(-12)));
  }
  for (const name of requiredStartupAssets) {
    if (!metrics.resources.some((resource) => resource.name === name && resource.decodedBodySize > 0)) {
      throw new Error("Missing successful startup resource: " + name);
    }
  }
  if (
    !metrics.productVisual
    || !metrics.productVisual.rendered
    || metrics.productVisual.frameWidth <= 0
    || metrics.productVisual.frameHeight <= 0
    || metrics.productVisual.previewWidth <= 0
    || metrics.productVisual.previewHeight <= 0
    || metrics.productVisual.previewWidth > metrics.productVisual.frameWidth + 1
    || metrics.productVisual.previewHeight > metrics.productVisual.frameHeight + 1
  ) {
    throw new Error(
      "landing product preview escapes its restored frame: "
      + JSON.stringify(metrics.productVisual),
    );
  }
  return {
    ...metrics,
    assetRequests: measuredAssetRequests - assetRequestsBefore,
    longTasks: undefined,
    longAnimationFrames: undefined,
  };
    });
  } finally {
    page.off("console", onConsole);
    page.off("pageerror", onPageError);
    page.off("requestfailed", onRequestFailed);
    page.off("response", onResponse);
  }
};
const createMeasuredContext = async () => {
  const context = await browser.newContext({ serviceWorkers: "block" });
  await context.addInitScript(installRoutePerformanceCollectors);
  return context;
};
try {
  if (!traceOnce) {
    for (const viewport of [
      { width: 1280, height: 800 },
      { width: 768, height: 800 },
      { width: 320, height: 720 },
    ]) {
      for (const routeName of Object.keys(routes)) {
      const page = await browser.newPage({ viewport });
      await page.goto(baseUrl + "/" + routeName, { waitUntil: "networkidle" });
      const metrics = await page.evaluate((name) => {
        const root = document.documentElement;
        const target = name === "landing"
          ? document.querySelector(".landing-header")
          : name === "legal"
            ? document.querySelector(".legal-header")
            : name === "assistant"
              ? document.querySelector(".bf-assistant-panel")
              : document.querySelector(".dashboard-metric-grid");
        const style = getComputedStyle(target);
        return {
          horizontalOverflow: root.scrollWidth - root.clientWidth,
          position: style.position,
          width: target.getBoundingClientRect().width,
          display: style.display,
        };
      }, routeName);
      const screenshot = await page.screenshot();
      if (metrics.horizontalOverflow > 1) {
        throw new Error(routeName + " overflows horizontally at " + viewport.width + "px");
      }
      const expectedPosition = routeName === "landing"
        ? "sticky"
        : routeName === "dashboard" ? "static" : "fixed";
      const expectedDisplay = routeName === "dashboard" ? "grid" : null;
      if (
        metrics.position !== expectedPosition
        || metrics.display === "none"
        || (expectedDisplay && metrics.display !== expectedDisplay)
        || metrics.width <= 0
      ) {
        throw new Error(routeName + " route CSS did not apply at " + viewport.width + "px");
      }
      if (screenshot.byteLength < 2_000) {
        throw new Error(routeName + " visual smoke produced an empty screenshot");
      }
      results.push({ route: routeName, viewport: viewport.width, ...metrics });
        await page.close();
      }
    }
  }
  const coldRuns = layoutOnly || traceOnce ? 1 : 30;
  for (let run = 0; run < coldRuns; run += 1) {
    const context = await createMeasuredContext();
    const page = await context.newPage();
    startup.cold.push(await measureNavigation(page));
    await context.close();
  }
  if (!layoutOnly && !traceOnce) {
    const warmContext = await createMeasuredContext();
    const warmPage = await warmContext.newPage();
    await measureNavigation(warmPage);
    for (let run = 0; run < 30; run += 1) {
      startup.warm.push(await measureNavigation(warmPage));
    }
    await warmContext.close();
    if (startup.warm.some((sample) => sample.assetRequests !== 0)) {
      throw new Error("Warm route measurement did not reuse the native hashed-asset HTTP cache.");
    }
    if (startup.cold.some((sample) => sample.assetRequests < landingPreloads.moduleFiles.length + 3)) {
      throw new Error("Cold route measurement did not request its complete startup asset graph.");
    }
    const measuredLongestTask = Math.max(
      ...startup.cold.map((sample) => sample.longestTaskMs),
      ...startup.warm.map((sample) => sample.longestTaskMs),
    );
    if (measuredLongestTask > STARTUP_LONG_TASK_LIMIT_MS) {
      const worstSample = [...startup.cold, ...startup.warm]
        .sort((left, right) => right.longestTaskMs - left.longestTaskMs)[0];
      throw new Error(
        "Built route startup long task is " + measuredLongestTask
        + " ms; budget is " + STARTUP_LONG_TASK_LIMIT_MS + " ms; sample="
        + JSON.stringify(worstSample),
      );
    }
  }
} finally {
  await browser.close();
  await new Promise((resolve) => server.close(resolve));
}

console.log(JSON.stringify({
  measurement: {
    releaseId: JSON.parse(fs.readFileSync(path.join(DIST_ROOT, "secure-build.json"), "utf8")).releaseId,
    appScript,
    browser: browser.version(),
    node: process.version,
    platform: process.platform,
    cpu: os.cpus()[0]?.model,
    blockedURLs: ["http://local.adguard.org/*"],
    serviceWorkers: "block",
    longTaskLimitMs: STARTUP_LONG_TASK_LIMIT_MS,
  },
  visualChecks: results,
  startup: {
    cold: {
      count: startup.cold.length,
      medianMs: percentile(startup.cold.map((sample) => sample.readyMs), 0.5),
      p95Ms: percentile(startup.cold.map((sample) => sample.readyMs), 0.95),
      longestTaskMs: Math.max(0, ...startup.cold.map((sample) => sample.longestTaskMs)),
      assetRequests: startup.cold.reduce((sum, sample) => sum + sample.assetRequests, 0),
    },
    warm: {
      count: startup.warm.length,
      medianMs: percentile(startup.warm.map((sample) => sample.readyMs), 0.5),
      p95Ms: percentile(startup.warm.map((sample) => sample.readyMs), 0.95),
      longestTaskMs: Math.max(0, ...startup.warm.map((sample) => sample.longestTaskMs)),
      assetRequests: startup.warm.reduce((sum, sample) => sum + sample.assetRequests, 0),
    },
  },
  traceSamples: traceOnce ? startup.cold : undefined,
}));
