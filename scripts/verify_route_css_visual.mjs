import fs from "node:fs";
import http from "node:http";
import path from "node:path";
import { chromium } from "playwright";
import { STARTUP_LONG_TASK_LIMIT_MS } from "./profile_startup_long_tasks.mjs";

const DIST_ROOT = path.resolve("dist");
const manifest = JSON.parse(
  fs.readFileSync(path.join(DIST_ROOT, ".vite", "manifest.json"), "utf8"),
);
const appCss = manifest["frontend/app/app.js"]?.css?.[0];
const appScript = manifest["frontend/app/app.js"]?.file;
if (!appCss) throw new Error("Route CSS visual smoke requires a built app stylesheet.");
if (!appScript) throw new Error("Route CSS visual smoke requires a built app script.");
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
    body: '<div class="landing-page"><header class="landing-header"><div class="landing-container landing-header-inner"><strong>BiddingFlow</strong><a class="landing-button landing-button-primary">Bắt đầu</a></div></header><main><section class="landing-hero"><div class="landing-container landing-hero-grid"><div class="landing-hero-copy"><div class="landing-eyebrow"><span class="landing-eyebrow-dot"></span>Quy trình thống nhất</div><h1>Quản lý đấu thầu liền mạch.</h1><p>Dữ liệu xuyên suốt từ kế hoạch đến hợp đồng.</p></div></div></section></main></div>',
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
};

const server = http.createServer((request, response) => {
  const pathname = new URL(request.url, "http://127.0.0.1").pathname;
  if (pathname === "/") {
    response.writeHead(200, { "content-type": "text/html; charset=utf-8" });
    response.end(
      '<!doctype html><html data-bf-shell="landing"><head>'
      + '<meta name="viewport" content="width=device-width,initial-scale=1">'
      + '<meta name="bf-app-debug" content="false">'
      + '<link rel="stylesheet" href="/dist/' + appCss + '">'
      + '<script id="bf-session-bootstrap" type="application/json">{"valid":false}</script>'
      + '<script type="module" src="/dist/' + appScript + '"></script>'
      + '</head><body class="bf-init-loading">' + landingMarkup + "</body></html>",
    );
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
    response.writeHead(200, { "content-type": "text/html; charset=utf-8" });
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
    response.writeHead(200, { "content-type": type });
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
  response.writeHead(404).end();
});

await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
const port = server.address().port;
const browser = await chromium.launch({ headless: true });
const results = [];
const startup = { cold: [], warm: [] };
const layoutOnly = process.argv.includes("--layout-only");
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
  await page.goto("http://127.0.0.1:" + port + "/", { waitUntil: "domcontentloaded" });
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
    const longestTaskMs = Math.round(
      Math.max(0, ...(globalThis.__bfRouteLongTasks || [])) * 100,
    ) / 100;
    const frameRect = document.querySelector(".landing-preview-logo")?.getBoundingClientRect();
    const imageRect = document.querySelector(".landing-preview-logo .app-brand-image")?.getBoundingClientRect();
    return {
      readyMs,
      longestTaskMs,
      previewBrand: frameRect && imageRect ? {
        frameWidth: frameRect.width,
        frameHeight: frameRect.height,
        imageWidth: imageRect.width,
        imageHeight: imageRect.height,
      } : null,
    };
  });
  if (
    !metrics.previewBrand
    || metrics.previewBrand.imageWidth > metrics.previewBrand.frameWidth + 1
    || metrics.previewBrand.imageHeight > metrics.previewBrand.frameHeight + 1
  ) {
    throw new Error(
      "landing preview brand image escapes its frame: "
      + JSON.stringify(metrics.previewBrand),
    );
  }
  return metrics;
};
const createMeasuredContext = async () => {
  const context = await browser.newContext();
  await context.addInitScript(() => {
    globalThis.__bfRouteLongTasks = [];
    try {
      const observer = new PerformanceObserver((list) => {
        for (const entry of list.getEntries()) {
          globalThis.__bfRouteLongTasks.push(entry.duration);
        }
      });
      observer.observe({ type: "longtask", buffered: true });
    } catch {
      // Unsupported browsers retain an empty long-task series.
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
  for (const viewport of [{ width: 1280, height: 800 }, { width: 320, height: 720 }]) {
    for (const routeName of Object.keys(routes)) {
      const page = await browser.newPage({ viewport });
      await page.goto("http://127.0.0.1:" + port + "/" + routeName, { waitUntil: "networkidle" });
      const metrics = await page.evaluate((name) => {
        const root = document.documentElement;
        const target = name === "landing"
          ? document.querySelector(".landing-header")
          : name === "legal"
            ? document.querySelector(".legal-header")
            : document.querySelector(".bf-assistant-panel");
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
      const expectedPosition = routeName === "landing" ? "sticky" : "fixed";
      if (metrics.position !== expectedPosition || metrics.display === "none" || metrics.width <= 0) {
        throw new Error(routeName + " route CSS did not apply at " + viewport.width + "px");
      }
      if (screenshot.byteLength < 2_000) {
        throw new Error(routeName + " visual smoke produced an empty screenshot");
      }
      results.push({ route: routeName, viewport: viewport.width, ...metrics });
      await page.close();
    }
  }
  const coldRuns = layoutOnly ? 1 : 30;
  for (let run = 0; run < coldRuns; run += 1) {
    const context = await createMeasuredContext();
    const page = await context.newPage();
    startup.cold.push(await measureNavigation(page));
    await context.close();
  }
  if (!layoutOnly) {
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
      throw new Error(
        "Built route startup long task is " + measuredLongestTask
        + " ms; budget is " + STARTUP_LONG_TASK_LIMIT_MS + " ms",
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
}));
