import fs from "node:fs";
import http from "node:http";
import path from "node:path";
import { chromium } from "playwright";

const DIST_ROOT = path.resolve("dist");
const manifest = JSON.parse(
  fs.readFileSync(path.join(DIST_ROOT, ".vite", "manifest.json"), "utf8"),
);
const appCss = manifest["frontend/app/app.js"]?.css?.[0];
if (!appCss) throw new Error("Route CSS visual smoke requires a built app stylesheet.");

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
      : asset.endsWith(".woff2") ? "font/woff2" : "application/octet-stream";
    response.writeHead(200, { "content-type": type });
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
const percentile = (values, ratio) => {
  const sorted = [...values].sort((left, right) => left - right);
  return sorted[Math.max(0, Math.ceil(sorted.length * ratio) - 1)];
};
const measureNavigation = async (page) => {
  await page.goto("http://127.0.0.1:" + port + "/landing", { waitUntil: "load" });
  return page.evaluate(() => {
    const navigation = performance.getEntriesByType("navigation")[0];
    return Math.round((navigation?.loadEventEnd || performance.now()) * 100) / 100;
  });
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
  for (let run = 0; run < 30; run += 1) {
    const context = await browser.newContext();
    const page = await context.newPage();
    startup.cold.push(await measureNavigation(page));
    await context.close();
  }
  const warmContext = await browser.newContext();
  const warmPage = await warmContext.newPage();
  await measureNavigation(warmPage);
  for (let run = 0; run < 30; run += 1) {
    startup.warm.push(await measureNavigation(warmPage));
  }
  await warmContext.close();
} finally {
  await browser.close();
  await new Promise((resolve) => server.close(resolve));
}

console.log(JSON.stringify({
  visualChecks: results,
  startup: {
    cold: { count: startup.cold.length, medianMs: percentile(startup.cold, 0.5), p95Ms: percentile(startup.cold, 0.95) },
    warm: { count: startup.warm.length, medianMs: percentile(startup.warm, 0.5), p95Ms: percentile(startup.warm, 0.95) },
  },
}));
