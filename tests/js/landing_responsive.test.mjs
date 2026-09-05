import assert from "node:assert/strict";
import { createServer } from "node:http";
import { mkdir, readFile } from "node:fs/promises";
import { extname, join } from "node:path";
import { after, before, test } from "node:test";
import { fileURLToPath } from "node:url";

import { chromium, firefox, webkit } from "playwright";
import AxeBuilder from "@axe-core/playwright";

const root = fileURLToPath(new URL("../..", import.meta.url));
const template = await readFile(join(root, "views/components/landing_page.html"), "utf8");
const bundled = process.env.UI_QA_BUNDLE === '1';
const manifest = bundled ? JSON.parse(await readFile(join(root, 'dist/.vite/manifest.json'), 'utf8')) : null;
const landingModuleURL = bundled ? `/dist/${manifest['frontend/landing/LandingPage.js'].file}` : '/frontend/landing/LandingPage.js';
const widths = [320, 360, 375, 390, 412, 768, 1024, 1280, 1366, 1440, 1920, 2560];
let browser;
let server;

function contentType(pathname) {
  if (extname(pathname) === ".js" || extname(pathname) === ".mjs") return "text/javascript; charset=utf-8";
  if (extname(pathname) === ".css") return "text/css; charset=utf-8";
  if (extname(pathname) === ".webp") return "image/webp";
  if (extname(pathname) === ".svg") return "image/svg+xml";
  if (extname(pathname) === ".png") return "image/png";
  if (extname(pathname) === ".woff2") return "font/woff2";
  return "application/octet-stream";
}

function offer(index) {
  return {
    code: `offer-${index}`,
    tier: "opaque-tier",
    variant: "opaque-variant",
    ownerKind: index % 2 ? "organization" : "account",
    salesState: "sellable",
    memberQuota: index * 3,
    includedProcurementQuota: index * 20,
    violationCheckEnabled: index === 3,
    price: { period: "yearly", currency: "VND", subtotal: index * 900000, tax: 0, total: index * 900000 },
    display: {
      name: index === 5 ? "Tên gói tùy chỉnh rất dài để kiểm tra bố cục tiếng Việt" : `Tên gói ${index}`,
      description: "Mô tả cấu hình được công bố từ bản phát hành thương mại hiện hành.",
      order: index,
      badge: index === 2 ? "Đề xuất" : "",
      recommended: index === 2,
      visibility: "public",
      variantLabel: "Phương án cấu hình",
      periodLabel: "/ chu kỳ",
      benefits: ["Lợi ích đến từ release", "Lượt lấy hồ sơ Mua Sắm Công"],
    },
  };
}

before(async () => {
  browser = await ({ chromium, firefox, webkit }[process.env.UI_QA_BROWSER || 'chromium']).launch({ headless: true });
  server = createServer(async (request, response) => {
    try {
      const pathname = new URL(request.url, "http://127.0.0.1").pathname;
      if (pathname === "/") {
        response.writeHead(200, { "content-type": "text/html; charset=utf-8" });
        const styles = bundled
          ? `<link rel="stylesheet" data-runtime-styles data-bf-shell-styles="landing" href="/dist/${manifest['views/css/landing-shell.css'].file}">`
          : '<link rel="stylesheet" href="/css/tokens.css"><link rel="stylesheet" href="/css/variables.css"><link rel="stylesheet" href="/css/base.css"><link rel="stylesheet" href="/css/landing.css"><link rel="stylesheet" href="/css/ui-redesign.css">';
        response.end(`<!doctype html><html lang="vi" data-bf-shell="landing"><head><meta name="viewport" content="width=device-width, initial-scale=1"><meta name="bf-app-debug" content="${!bundled}">${styles}<title>Landing QA</title></head><body>${template}</body></html>`);
        return;
      }
      if (pathname === "/api/public/commercial/offers") {
        response.writeHead(200, { "content-type": "application/json" });
        response.end(JSON.stringify({
          releaseId: "release-layout",
          releaseChecksum: "checksum-layout",
          offers: [1, 2, 3, 4, 5].map(offer),
          creditPacks: [],
          quotaWarnings: [],
        }));
        return;
      }
      let relativePath = pathname.replace(/^\//u, "");
      if (pathname.startsWith("/css/")) relativePath = join("views", relativePath);
      if (pathname.startsWith("/assets/")) relativePath = join("views", relativePath);
      if (pathname.startsWith("/vendor/")) relativePath = join("views", relativePath);
      const payload = await readFile(join(root, relativePath));
      response.writeHead(200, { "content-type": contentType(pathname) });
      response.end(payload);
    } catch {
      response.writeHead(404);
      response.end("Not Found");
    }
  });
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
});

after(async () => {
  await browser?.close();
  await new Promise((resolve) => server.close(resolve));
});

async function loadLanding(width, height = 900, session = { valid: false }) {
  const context = await browser.newContext({ viewport: { width, height } });
  const page = await context.newPage();
  const errors = [];
  page.on("pageerror", (error) => errors.push(error.message));
  await page.goto(`http://127.0.0.1:${server.address().port}/`);
  await page.evaluate(async ({ sessionState, moduleURL }) => {
    const bootstrap = document.createElement('script');
    bootstrap.id = 'bf-session-bootstrap';
    bootstrap.type = 'application/json';
    bootstrap.textContent = JSON.stringify(sessionState);
    document.head.append(bootstrap);
    const module = await import(moduleURL);
    await module.bootstrapLandingPage(sessionState);
  }, { sessionState: session, moduleURL: landingModuleURL });
  await page.waitForFunction(() => !document.getElementById("landing-pricing-grid")?.hasAttribute("aria-busy"));
  return { context, page, errors };
}

test("landing stays within every required viewport and renders all primary regions", async () => {
  for (const width of widths) {
    const { context, page, errors } = await loadLanding(width, width === 1280 ? 800 : 900);
    try {
      const metrics = await page.evaluate(() => ({
        clientWidth: document.documentElement.clientWidth,
        scrollWidth: document.documentElement.scrollWidth,
        cardCount: document.querySelectorAll("[data-commercial-offer-code]").length,
        regions: ["giai-phap", "quy-trinh", "vai-tro", "bang-gia"].map((id) => {
          const node = document.getElementById(id);
          const style = node ? getComputedStyle(node) : null;
          return {
            exists: Boolean(node),
            height: node?.getBoundingClientRect().height || 0,
            display: style?.display || "",
            visibility: style?.visibility || "",
            opacity: style?.opacity || "",
          };
        }),
        productLabel: document.querySelector(".landing-product-stage")?.getAttribute("aria-label") || "",
      }));
      assert.ok(metrics.scrollWidth <= metrics.clientWidth + 1, `horizontal overflow at ${width}px: ${metrics.scrollWidth}/${metrics.clientWidth}`);
      assert.equal(metrics.cardCount, 5, `commercial card count at ${width}px`);
      for (const region of metrics.regions) {
        assert.equal(region.exists, true, `missing region at ${width}px`);
        assert.ok(region.height > 100, `collapsed region at ${width}px: ${JSON.stringify(region)}`);
        assert.notEqual(region.display, "none");
        assert.notEqual(region.visibility, "hidden");
        assert.notEqual(region.opacity, "0");
      }
      assert.match(metrics.productLabel, /Minh họa dashboard BiddingFlow/u);
      assert.deepEqual(errors, [], `page errors at ${width}px`);
      if (process.env.LANDING_QA_CAPTURE_DIR && [390, 1440].includes(width)) {
        const outputDirectory = join(root, process.env.LANDING_QA_CAPTURE_DIR);
        await mkdir(outputDirectory, { recursive: true });
        await page.screenshot({
          path: join(outputDirectory, `landing-${width}.png`),
          fullPage: true,
        });
        for (const section of ["giai-phap", "quy-trinh", "bang-gia", "vai-tro"]) {
          await page.locator(`#${section}`).scrollIntoViewIfNeeded();
          await page.evaluate(() => new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve))));
          await page.screenshot({
            path: join(outputDirectory, `landing-${width}-${section}-viewport.png`),
          });
        }
      }
    } finally {
      await context.close();
    }
  }
});

test("old mobile header keeps a usable primary action", async () => {
  const { context, page } = await loadLanding(375, 812);
  try {
    const cta = page.locator('[data-cta-location="header"]');
    const box = await cta.boundingBox();
    assert.ok(box && box.width >= 44 && box.height >= 44, `small mobile CTA: ${JSON.stringify(box)}`);
    assert.equal(await cta.getAttribute("href"), "/dang-nhap");
  } finally {
    await context.close();
  }
});

test('landing icons render strokes and mobile navigation closes without a scroll lock', async () => {
  const { context, page } = await loadLanding(390, 844);
  try {
    const icons = await page.locator('.landing-icon').evaluateAll(nodes => nodes.map(node => ({
      stroke: getComputedStyle(node).stroke, fill: getComputedStyle(node).fill,
      width: node.getBBox().width, height: node.getBBox().height,
    })));
    assert.ok(icons.length > 10);
    for (const icon of icons) {
      assert.equal(icon.fill, 'none');
      assert.notEqual(icon.stroke, 'none');
    }
    const visibleIcons = await page.locator('.landing-work-preview .landing-icon').evaluateAll(nodes => nodes.map(node => node.getBBox().width));
    assert.ok(visibleIcons.every(width => width > 0));
    await page.locator('[data-landing-menu-toggle]').click();
    assert.equal(await page.locator('[data-landing-menu-toggle]').getAttribute('aria-expanded'), 'true');
    await page.keyboard.press('Escape');
    assert.equal(await page.locator('[data-landing-menu-toggle]').getAttribute('aria-expanded'), 'false');
    await page.locator('[data-landing-menu-toggle]').click();
    await page.locator('.landing-nav a[href="#faq"]').click();
    assert.equal(await page.locator('[data-landing-menu-toggle]').getAttribute('aria-expanded'), 'false');
    assert.notEqual(await page.evaluate(() => getComputedStyle(document.body).overflowY), 'hidden');
    await page.evaluate(() => { document.documentElement.style.scrollBehavior = 'auto'; window.scrollTo(0, 0); });
    await page.mouse.move(150, 600);
    await page.mouse.wheel(0, 600);
    await page.waitForFunction(() => window.scrollY > 0);
    await page.evaluate(() => { window.scrollTo(0, 0); document.activeElement?.blur(); });
    await page.keyboard.press('PageDown');
    await page.waitForFunction(() => window.scrollY > 0);
  } finally { await context.close(); }
});

test("authenticated landing CTA goes directly to the workspace", async () => {
  const { context, page } = await loadLanding(1280, 800, { valid: true });
  try {
    assert.equal(await page.locator('[data-cta-location="hero"]').getAttribute("href"), "/tong-quan");
    assert.match(await page.locator('[data-cta-location="hero"]').textContent(), /Mở không gian làm việc/u);
    assert.equal(await page.locator("[data-landing-auth-link]").first().getAttribute("href"), "/tong-quan");
  } finally {
    await context.close();
  }
});

test("landing has no serious or critical automated accessibility violations", async () => {
  for (const width of [375, 1280]) {
    const { context, page } = await loadLanding(width, width === 375 ? 812 : 800);
    try {
      const result = await new AxeBuilder({ page }).analyze();
      const blocking = result.violations.filter((violation) => ["serious", "critical"].includes(violation.impact));
      assert.deepEqual(
        blocking.map(({ id, impact, nodes }) => ({ id, impact, targets: nodes.map((node) => node.target) })),
        [],
        `accessibility violations at ${width}px`,
      );
    } finally {
      await context.close();
    }
  }
});
