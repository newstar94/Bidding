import assert from "node:assert/strict";
import { createServer } from "node:http";
import test from "node:test";
import { readFile } from "node:fs/promises";
import { extname, join } from "node:path";
import { fileURLToPath } from "node:url";

import { chromium } from "playwright";

const projectRoot = fileURLToPath(new URL("../..", import.meta.url));

function contentType(pathname) {
  if ([".js", ".mjs"].includes(extname(pathname))) return "text/javascript; charset=utf-8";
  if (extname(pathname) === ".css") return "text/css; charset=utf-8";
  return "text/html; charset=utf-8";
}

const stylesheetPaths = [
  "../../views/css/tokens.css",
  "../../views/css/variables.css",
  "../../views/css/base.css",
  "../../views/css/components.css",
  "../../views/css/views.css",
  "../../views/css/generated-static-styles.css",
  "../../views/css/ui-redesign.css",
  "../../views/css/runtime-styles.css",
].map((path) => fileURLToPath(new URL(path, import.meta.url)));

test("datepicker cancel and confirm actions share the footer evenly", async () => {
  const browser = await chromium.launch({ headless: true });
  try {
    const page = await browser.newPage();
    await page.setContent(`
      <div class="flatpickr-calendar open">
        <div class="flatpickr-footer">
          <button type="button" class="btn btn-outline">Hủy</button>
          <button type="button" class="btn btn-primary"><svg aria-hidden="true"></svg>Xác nhận</button>
        </div>
      </div>
    `);
    for (const path of stylesheetPaths) await page.addStyleTag({ path });

    for (const width of [534, 320]) {
      await page.locator(".flatpickr-calendar").evaluate((calendar, nextWidth) => {
        calendar.style.width = `${nextWidth}px`;
      }, width);
      const metrics = await page.locator(".flatpickr-footer").evaluate((footer) => {
        const [cancel, confirm] = [...footer.querySelectorAll("button")].map((button) => button.getBoundingClientRect());
        return {
          cancelWidth: cancel.width,
          confirmWidth: confirm.width,
          cancelHeight: cancel.height,
          confirmHeight: confirm.height,
          gap: confirm.left - cancel.right,
        };
      });
      assert.ok(Math.abs(metrics.cancelWidth - metrics.confirmWidth) <= 0.5, `button widths differ at ${width}px`);
      assert.equal(metrics.cancelHeight, metrics.confirmHeight);
      assert.ok(metrics.cancelHeight >= 44);
      assert.ok(metrics.gap >= 8);
    }
  } finally {
    await browser.close();
  }
});

test("month selection replaces the date grid and restores it after choosing a month", async () => {
  const server = createServer(async (request, response) => {
    try {
      const pathname = new URL(request.url, "http://127.0.0.1").pathname;
      if (pathname === "/") {
        response.writeHead(200, { "content-type": contentType(".html") });
        response.end(`<!doctype html><html><head><meta charset="utf-8">
          <link rel="stylesheet" href="/views/vendor/flatpickr/flatpickr.min.css">
          <link rel="stylesheet" href="/views/css/tokens.css">
          <link rel="stylesheet" href="/views/css/variables.css">
          <link rel="stylesheet" href="/views/css/base.css">
          <link rel="stylesheet" href="/views/css/components.css">
          <link rel="stylesheet" href="/views/css/runtime-styles.css" data-runtime-styles>
        </head><body><input id="meeting-date" class="flatpickr-datetime"></body></html>`);
        return;
      }
      const filePath = join(projectRoot, pathname.replace(/^\//, ""));
      const payload = await readFile(filePath);
      response.writeHead(200, { "content-type": contentType(pathname) });
      response.end(payload);
    } catch {
      if (!response.headersSent) response.writeHead(404);
      if (!response.writableEnded) response.end("Not Found");
    }
  });
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  const address = server.address();
  let browser;
  try {
    browser = await chromium.launch({ headless: true });
    const page = await browser.newPage({ viewport: { width: 900, height: 800 } });
    await page.goto(`http://127.0.0.1:${address.port}/`);
    await page.evaluate(() => import("/frontend/shared/trustedTypes.js"));
    await page.addScriptTag({ url: `http://127.0.0.1:${address.port}/views/vendor/flatpickr/flatpickr.min.js` });
    await page.addScriptTag({ url: `http://127.0.0.1:${address.port}/views/vendor/flatpickr/l10n/vn.js` });
    await page.evaluate(async () => {
      const { BiddingView } = await import("/frontend/app/BiddingView.js");
      const view = new BiddingView({});
      view.initFlatpickr(document);
      await new Promise((resolve) => setTimeout(resolve, 100));
    });

    await page.locator("#meeting-date").click();
    await page.waitForTimeout(150);
    const calendar = page.locator(".flatpickr-calendar.open");
    const dateGrid = calendar.locator(".flatpickr-innerContainer");
    const timeGrid = calendar.locator(".flatpickr-time");
    const dateGridTop = await dateGrid.evaluate((element) => element.getBoundingClientRect().top);
    await calendar.locator(".cur-month").click();
    await page.waitForTimeout(50);

    const monthGrid = calendar.locator(".flatpickr-grid-overlay.flatpickr-month-grid-mode");
    const openState = await calendar.evaluate((element) => {
      const inner = element.querySelector(".flatpickr-innerContainer");
      const time = element.querySelector(".flatpickr-time");
      const grid = element.querySelector(".flatpickr-grid-overlay");
      return {
        gridOpen: element.classList.contains("flatpickr-grid-open"),
        innerDisplay: getComputedStyle(inner).display,
        timeDisplay: getComputedStyle(time).display,
        gridDisplay: getComputedStyle(grid).display,
        gridTop: grid.getBoundingClientRect().top,
      };
    });
    assert.equal(openState.gridOpen, true);
    assert.equal(openState.innerDisplay, "none");
    assert.equal(openState.timeDisplay, "none");
    assert.equal(openState.gridDisplay, "block");
    assert.ok(
      Math.abs(openState.gridTop - dateGridTop) <= 2,
      `month grid must replace the date grid position: ${JSON.stringify({ dateGridTop, ...openState })}`,
    );

    await monthGrid.locator(".flatpickr-grid-item").nth(1).click();
    await page.waitForFunction(() => (
      document.querySelector(".flatpickr-calendar.open .cur-month")?.textContent.trim() === "Tháng 2"
    ));
    const restoredState = await calendar.evaluate((element) => ({
      gridOpen: element.classList.contains("flatpickr-grid-open"),
      innerDisplay: getComputedStyle(element.querySelector(".flatpickr-innerContainer")).display,
      timeDisplay: getComputedStyle(element.querySelector(".flatpickr-time")).display,
      gridDisplay: getComputedStyle(element.querySelector(".flatpickr-grid-overlay")).display,
    }));
    assert.equal(restoredState.gridOpen, false);
    assert.notEqual(restoredState.innerDisplay, "none");
    assert.notEqual(restoredState.timeDisplay, "none");
    assert.equal(restoredState.gridDisplay, "none");
  } finally {
    await browser?.close();
    await new Promise((resolve) => server.close(resolve));
  }
});
