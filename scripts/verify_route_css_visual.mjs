import fs from "node:fs";
import http from "node:http";
import path from "node:path";
import { chromium } from "playwright";
import { STARTUP_LONG_TASK_LIMIT_MS } from "./profile_startup_long_tasks.mjs";

const DIST_ROOT = path.resolve("dist");
const TEST_HOST = "biddingflow.test";
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
const landingMarkup = fs.readFileSync("views/components/landing_page.html", "utf8");

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
  '<!doctype html><html data-bf-shell="landing"><head>'
  + (assetOrigin ? '<base href="' + assetOrigin + '/">' : '')
  + '<meta name="viewport" content="width=device-width,initial-scale=1">'
  + '<meta name="bf-app-debug" content="false">'
  + '<link rel="stylesheet" href="' + assetOrigin + '/dist/' + landingShellCss
  + '" data-runtime-styles data-bf-shell-styles="landing">'
  + '<script id="bf-session-bootstrap" type="application/json">{"valid":false}</script>'
  + '<script type="module" src="' + assetOrigin + '/dist/' + appScript + '"></script>'
  + '</head><body class="bf-init-loading">' + landingMarkup + '</body></html>'
);

const server = http.createServer((request, response) => {
  const pathname = new URL(request.url, "http://127.0.0.1").pathname;
  if (pathname === "/") {
    response.writeHead(200, htmlHeaders);
    response.end(landingDocument());
    return;
  }
  if (pathname === "/api/public/packages") {
    response.writeHead(200, { "content-type": "application/json" });
    response.end('{"packages":[]}');
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
    // The measured document is an about:blank shell so host-level HTTP
    // injectors cannot contaminate long-task attribution. Allow only this
    // harness to fetch its loopback assets across the opaque origin; CSP and
    // Trusted Types remain covered by their dedicated production checks.
    "--disable-web-security",
    "--disable-features=BlockInsecurePrivateNetworkRequests,PrivateNetworkAccessChecks",
    "--no-proxy-server",
    `--host-resolver-rules=MAP ${TEST_HOST} 127.0.0.1`,
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
  const diagnostics = [];
  page.on("console", (message) => diagnostics.push(`console:${message.type()}:${message.text()}`));
  page.on("pageerror", (error) => diagnostics.push(`pageerror:${error.message}`));
  page.on("requestfailed", (request) => diagnostics.push(
    `requestfailed:${request.url()}:${request.failure()?.errorText || "unknown"}`,
  ));
  await page.goto("about:blank");
  await page.setContent(landingDocument(baseUrl), { waitUntil: "domcontentloaded" });
  try {
    await page.waitForFunction(
      () => document.body.classList.contains("landing-ready"),
    );
  } catch (error) {
    const state = await page.evaluate(() => ({
      bodyClass: document.body.className,
      shell: document.documentElement.dataset.bfShell || "",
      fatal: document.getElementById("bf-bootstrap-fatal")?.textContent || "",
    }));
    throw new Error(
      `Built landing route did not become ready: ${JSON.stringify({
        state,
        diagnostics: diagnostics.slice(-12),
      })}`,
      { cause: error },
    );
  }
  const metrics = await page.evaluate(() => {
    const readyMs = Math.round(performance.now() * 100) / 100;
    const longTasks = [...(globalThis.__bfRouteLongTasks || [])]
      .sort((left, right) => right.duration - left.duration);
    const longAnimationFrames = [...(globalThis.__bfRouteLongAnimationFrames || [])];
    const longestTask = longTasks[0] || null;
    const longestAnimationFrame = [...longAnimationFrames]
      .sort((left, right) => right.duration - left.duration)[0] || null;
    const longestTaskMs = Math.round(Number(longestTask?.duration || 0) * 100) / 100;
    const frameRect = document.querySelector(".landing-product-window")?.getBoundingClientRect();
    const previewRect = document.querySelector(".landing-app-preview")?.getBoundingClientRect();
    return {
      readyMs,
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
      })).filter((entry) => entry.startTime <= Number(longestTask?.startTime || 0) + 250),
      productVisual: frameRect && previewRect ? {
        frameWidth: frameRect.width,
        frameHeight: frameRect.height,
        previewWidth: previewRect.width,
        previewHeight: previewRect.height,
      } : null,
    };
  });
  if (
    !metrics.productVisual
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
    longTasks: undefined,
    longAnimationFrames: undefined,
  };
};
const createMeasuredContext = async () => {
  const context = await browser.newContext();
  await context.addInitScript(() => {
    globalThis.__bfRouteLongTasks = [];
    globalThis.__bfRouteLongAnimationFrames = [];
    try {
      const observer = new PerformanceObserver((list) => {
        for (const entry of list.getEntries()) {
          globalThis.__bfRouteLongTasks.push({
            duration: entry.duration,
            startTime: entry.startTime,
            attribution: [...(entry.attribution || [])].map((item) => ({
              name: item.name,
              containerType: item.containerType,
              containerName: item.containerName,
              containerSrc: item.containerSrc,
              containerId: item.containerId,
            })),
          });
        }
      });
      observer.observe({ type: "longtask", buffered: true });
    } catch {
      // Unsupported browsers retain an empty long-task series.
    }
    try {
      const observer = new PerformanceObserver((list) => {
        for (const entry of list.getEntries()) {
          globalThis.__bfRouteLongAnimationFrames.push({
            duration: entry.duration,
            startTime: entry.startTime,
            blockingDuration: entry.blockingDuration,
            renderStart: entry.renderStart,
            styleAndLayoutStart: entry.styleAndLayoutStart,
            scripts: [...(entry.scripts || [])].map((script) => ({
              invoker: script.invoker,
              invokerType: script.invokerType,
              sourceURL: script.sourceURL,
              sourceFunctionName: script.sourceFunctionName,
              duration: script.duration,
              executionStart: script.executionStart,
              forcedStyleAndLayoutDuration: script.forcedStyleAndLayoutDuration,
            })),
          });
        }
      });
      observer.observe({ type: "long-animation-frame", buffered: true });
    } catch {
      // Unsupported browsers retain an empty long-animation-frame series.
    }
    try {
      Object.defineProperty(navigator, "serviceWorker", { configurable: true, value: undefined });
    } catch {
      // Service-worker availability is not required by this isolated startup harness.
    }
  });
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
  visualChecks: results,
  startup: {
    cold: {
      count: startup.cold.length,
      medianMs: percentile(startup.cold.map((sample) => sample.readyMs), 0.5),
      p95Ms: percentile(startup.cold.map((sample) => sample.readyMs), 0.95),
      longestTaskMs: Math.max(0, ...startup.cold.map((sample) => sample.longestTaskMs)),
    },
    warm: {
      count: startup.warm.length,
      medianMs: percentile(startup.warm.map((sample) => sample.readyMs), 0.5),
      p95Ms: percentile(startup.warm.map((sample) => sample.readyMs), 0.95),
      longestTaskMs: Math.max(0, ...startup.warm.map((sample) => sample.longestTaskMs)),
    },
  },
  traceSamples: traceOnce ? startup.cold : undefined,
}));
