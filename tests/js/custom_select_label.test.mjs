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

test("custom select inside a label stays open and allows choosing an option", async () => {
  const server = createServer(async (request, response) => {
    try {
      const pathname = new URL(request.url, "http://127.0.0.1").pathname;
      if (pathname === "/") {
        response.writeHead(200, { "content-type": contentType(".html") });
        response.end(`<!doctype html><html><head>
          <link rel="stylesheet" href="/views/css/tokens.css">
          <link rel="stylesheet" href="/views/css/variables.css">
          <link rel="stylesheet" href="/views/css/base.css">
          <link rel="stylesheet" href="/views/css/components.css">
          <link rel="stylesheet" href="/views/css/views.css">
          <link rel="stylesheet" href="/views/css/generated-static-styles.css">
          <link rel="stylesheet" href="/views/css/ui-redesign.css">
          <link rel="stylesheet" data-runtime-styles href="/css/runtime-styles.css">
        </head><body><header class="package-section-header package-goods-toolbar">
          <div class="package-goods-heading"><h4>Danh mục hàng hóa</h4><p>5 mặt hàng</p></div>
          <div class="compact-action-group package-goods-actions">
            <label class="package-goods-search"><input class="form-control" placeholder="Tìm mã hoặc tên hàng hóa"></label>
            <label class="package-goods-filter">Phần lô
              <select id="lot-select" class="form-control" name="phanLoId" data-dropdown-inline="true">
                <option value="">Tất cả phần lô</option>
                <option value="lot-1" selected>PL1 — Lô 1</option>
                <option value="lot-2">PL2 — Lô 2</option>
              </select>
            </label>
            <button class="btn btn-outline">Tải file mẫu</button><button class="btn btn-outline">Xuất Excel</button><button class="btn btn-outline">Nhập Excel</button><button class="btn btn-primary">Thêm hàng hóa</button>
          </div>
        </header>
        <div><select id="version-select" class="page-version-select" aria-label="Chọn phiên bản gói thầu">
          <option value="v00">00</option><option value="v01">01</option><option value="v02">02</option><option value="v03" selected>03</option>
        </select></div>
        <div id="table-version-cell" class="bf-s-8c8dc52ed7" style="width: 520px">
          <a href="#">E2E-1786271582853-GT</a><span>–</span>
          <select id="table-version-select" class="form-control version-droplist bf-s-b41ce2ea44" aria-label="Chọn phiên bản gói thầu E2E-1786271582853-GT">
            <option value="v00" selected>00</option><option value="v01">01</option>
          </select>
        </div></body></html>`);
        return;
      }
      const filePath = pathname === "/css/runtime-styles.css"
        ? join(projectRoot, "views", "css", "runtime-styles.css")
        : join(projectRoot, pathname.replace(/^\//, ""));
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
    const page = await browser.newPage();
    await page.setViewportSize({ width: 2048, height: 600 });
    await page.goto(`http://127.0.0.1:${address.port}/`);
    await page.evaluate(async () => {
      const { initCustomSelect } = await import("/frontend/shared/view_helpers.js");
      initCustomSelect("lot-select");
      initCustomSelect("version-select");
      initCustomSelect("table-version-select");
    });

    const tableVersionGeometry = await page.locator('#table-version-cell').evaluate((cell) => {
      const wrapper = cell.querySelector('.custom-select-container[data-target="table-version-select"]');
      const trigger = wrapper?.querySelector(".custom-select-trigger");
      return {
        cellWidth: cell.getBoundingClientRect().width,
        wrapperWidth: wrapper?.getBoundingClientRect().width,
        triggerWidth: trigger?.getBoundingClientRect().width,
      };
    });
    assert.equal(tableVersionGeometry.cellWidth, 520);
    assert.equal(tableVersionGeometry.wrapperWidth, 52);
    assert.equal(tableVersionGeometry.triggerWidth, 52);

    const lotTrigger = page.locator('.custom-select-container[data-target="lot-select"] .custom-select-trigger');
    const pointerTarget = await lotTrigger.evaluate((element) => {
      const rect = element.getBoundingClientRect();
      const hit = document.elementFromPoint(rect.left + rect.width / 2, rect.top + rect.height / 2);
      return {
        hitClass: hit?.className || "",
        hitTag: hit?.tagName || "",
        pointerEvents: getComputedStyle(element).pointerEvents,
        rect: [rect.left, rect.top, rect.width, rect.height],
      };
    });
    assert.equal(pointerTarget.hitTag, "INPUT", JSON.stringify(pointerTarget));
    await lotTrigger.click();
    const openState = await page.locator('.custom-select-options[data-parent="lot-select"]').evaluate((element) => ({
      display: getComputedStyle(element).display,
      wrapperOpen: document.querySelector('.custom-select-container[data-target="lot-select"]')?.classList.contains("open"),
    }));

    assert.deepEqual(openState, { display: "block", wrapperOpen: true });
    assert.equal(await page.locator('.custom-select-options[data-parent="lot-select"]').evaluate((element) => (
      element.parentElement?.classList.contains("custom-select-container")
    )), true);
    await page.locator('.custom-select-container[data-target="lot-select"]').evaluate((element) => {
      element.parentElement.style.transform = "translateX(10px)";
    });
    await page.evaluate(() => new Promise((resolve) => requestAnimationFrame(() => resolve())));
    const alignment = await page.evaluate(() => {
      const trigger = document.querySelector('.custom-select-container[data-target="lot-select"] .custom-select-trigger').getBoundingClientRect();
      const options = document.querySelector('.custom-select-options[data-parent="lot-select"]').getBoundingClientRect();
      return {
        leftDelta: Math.round((options.left - trigger.left) * 100) / 100,
        widthDelta: Math.round((options.width - trigger.width) * 100) / 100,
      };
    });
    assert.deepEqual(alignment, { leftDelta: 0, widthDelta: 0 });
    await page.locator('.custom-select-options[data-parent="lot-select"] [data-value="lot-1"]').click();
    assert.equal(await page.locator("#lot-select").inputValue(), "lot-1");

    await page.locator('.custom-select-container[data-target="version-select"] .custom-select-trigger').click();
    const versionDropdown = page.locator('body > .custom-select-options.version-select-options[data-parent="version-select"]');
    const versionStyles = await versionDropdown.evaluate((element) => {
      const style = getComputedStyle(element);
      const optionStyle = getComputedStyle(element.querySelector("li"));
      return {
        display: style.display,
        minWidth: parseFloat(style.minWidth),
        borderRadius: style.borderRadius,
        backgroundColor: style.backgroundColor,
        boxShadow: style.boxShadow,
        optionFontSize: optionStyle.fontSize,
        optionTextAlign: optionStyle.textAlign,
      };
    });
    assert.equal(versionStyles.display, "block");
    assert.ok(versionStyles.minWidth >= 52);
    assert.equal(versionStyles.borderRadius, "4px");
    assert.notEqual(versionStyles.backgroundColor, "rgba(0, 0, 0, 0)");
    assert.notEqual(versionStyles.boxShadow, "none");
    assert.equal(versionStyles.optionFontSize, "12px");
    assert.equal(versionStyles.optionTextAlign, "center");
  } finally {
    await browser?.close();
    await new Promise((resolve) => server.close(resolve));
  }
});
