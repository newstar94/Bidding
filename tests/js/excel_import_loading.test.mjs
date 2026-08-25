import assert from "node:assert/strict";
import { createServer } from "node:http";
import { readFile } from "node:fs/promises";
import { extname, join } from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

import { chromium } from "playwright";

const projectRoot = fileURLToPath(new URL("../..", import.meta.url));

function contentType(pathname) {
  if (extname(pathname) === ".js") return "text/javascript; charset=utf-8";
  if (extname(pathname) === ".css") return "text/css; charset=utf-8";
  return "text/html; charset=utf-8";
}

test("shared application loading surface announces Excel and Word progress", async () => {
  const server = createServer(async (request, response) => {
    try {
      const url = new URL(request.url, "http://127.0.0.1");
      if (url.pathname === "/") {
        response.writeHead(200, { "content-type": contentType(".html") });
        response.end(`<!doctype html><html lang="vi"><head>
          <link rel="stylesheet" href="/views/css/tokens.css">
          <link rel="stylesheet" href="/views/css/variables.css">
          <link rel="stylesheet" href="/views/css/components.css">
        </head><body><main><button type="button">Nhập Excel</button></main></body></html>`);
        return;
      }
      const filePath = join(projectRoot, url.pathname.replace(/^\//, ""));
      const payload = await readFile(filePath);
      response.writeHead(200, { "content-type": contentType(url.pathname) });
      response.end(payload);
    } catch {
      if (!response.headersSent) response.writeHead(404);
      if (!response.writableEnded) response.end("Not Found");
    }
  });
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  const port = server.address().port;
  let browser;
  try {
    browser = await chromium.launch({ headless: true });
    const page = await browser.newPage({ viewport: { width: 375, height: 812 } });
    await page.goto(`http://127.0.0.1:${port}/`);
    await page.evaluate(async () => {
      const { beginExcelImportLoading } = await import(
        "/frontend/shared/ExcelImportLoading.js"
      );
      globalThis.excelLoading = await beginExcelImportLoading({
        fileName: "du-lieu-goi-thau.xlsx",
      });
    });

    const loading = page.locator("#app-long-task-loading");
    await loading.waitFor({ state: "visible" });
    assert.equal(await loading.getAttribute("data-task"), "excel-import");
    assert.equal(await loading.getAttribute("role"), "status");
    assert.equal(await loading.getAttribute("aria-live"), "polite");
    assert.equal(await loading.getAttribute("aria-busy"), "true");
    assert.equal(await page.locator("body").getAttribute("aria-busy"), "true");
    assert.equal(await page.locator("main").getAttribute("inert"), "");
    assert.equal(
      await page.evaluate(() => document.activeElement?.classList.contains("app-long-task-loading-card")),
      true,
    );
    assert.equal(
      await loading.locator(".app-long-task-loading-icon").getAttribute("class"),
      "app-brand-image app-long-task-loading-icon",
    );
    assert.match(await loading.innerText(), /du-lieu-goi-thau\.xlsx/u);
    assert.equal(await loading.locator("[data-stage]").count(), 3);
    const layout = await loading.evaluate((element) => ({
      cardWidth: element.querySelector(".app-long-task-loading-card")?.getBoundingClientRect().width,
      documentWidth: document.documentElement.scrollWidth,
      viewportWidth: innerWidth,
    }));
    assert.ok(layout.cardWidth <= layout.viewportWidth - 32);
    assert.ok(layout.documentWidth <= layout.viewportWidth);
    assert.equal(
      await loading.locator(".app-long-task-loading-progress-value").evaluate(
        (element) => getComputedStyle(element).animationName,
      ),
      "app-long-task-progress",
    );
    await page.emulateMedia({ reducedMotion: "reduce" });
    if (process.env.EXCEL_LOADING_SCREENSHOT) {
      await page.screenshot({ path: process.env.EXCEL_LOADING_SCREENSHOT, fullPage: true });
    }
    assert.equal(
      await loading.locator(".app-long-task-loading-progress-value").evaluate(
        (element) => getComputedStyle(element).animationName,
      ),
      "none",
    );

    await page.evaluate(() => globalThis.excelLoading.update(
      "preview",
      "Dữ liệu đang được chuẩn bị để xem trước.",
    ));
    assert.equal(await loading.locator('[data-stage="read"]').getAttribute("data-state"), "complete");
    assert.equal(await loading.locator('[data-stage="validate"]').getAttribute("data-state"), "complete");
    assert.equal(await loading.locator('[data-stage="preview"]').getAttribute("data-state"), "active");
    assert.match(await loading.innerText(), /chuẩn bị để xem trước/u);

    await page.evaluate(async () => {
      const { beginWordExportLoading } = await import(
        "/frontend/documents/WordExportLoading.js"
      );
      globalThis.wordLoading = await beginWordExportLoading({
        detail: "Văn bản: Báo cáo đánh giá",
      });
    });
    assert.equal(await page.locator("#app-long-task-loading").count(), 1);
    assert.equal(await loading.getAttribute("data-task"), "word-publication");
    assert.match(await loading.innerText(), /Đang xuất bản Word/u);

    await page.evaluate(() => globalThis.wordLoading.close());
    assert.equal(await loading.isVisible(), true);
    assert.equal(await loading.getAttribute("aria-busy"), "true");
    assert.equal(await page.locator("body").getAttribute("aria-busy"), "true");
    assert.equal(await loading.getAttribute("data-task"), "excel-import");

    await page.evaluate(() => globalThis.excelLoading.close());
    await loading.waitFor({ state: "hidden" });
    assert.equal(await page.locator("body").getAttribute("aria-busy"), null);
    assert.equal(await page.locator("main").getAttribute("inert"), null);
  } finally {
    await browser?.close();
    await new Promise((resolve) => server.close(resolve));
  }
});

test("all long-running Excel import entry points use the shared loading surface", async () => {
  const files = [
    "frontend/documents/ExcelIntegration.js",
    "frontend/packages/PackageGoodsWorkflow.js",
    "frontend/packages/DetailedEvaluationPanelController.js",
    "frontend/packages/BidderGoodsWorkflow.js",
  ];
  for (const file of files) {
    const source = await readFile(join(projectRoot, file), "utf8");
    assert.match(source, /beginExcelImportLoading/u, `${file} must expose Excel processing feedback`);
  }
});
