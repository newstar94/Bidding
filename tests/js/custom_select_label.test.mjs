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

test("package status and procurement-method filters opt into content-fit lists", async () => {
  const template = await readFile(
    new URL("../../views/tabs/tab_goithau.html", import.meta.url),
    "utf8",
  );

  assert.match(
    template,
    /id="filter-goithau-trangthai"[^>]*data-dropdown-fit-content="true"/u,
  );
  assert.match(
    template,
    /id="filter-goithau-hinhthuc"[^>]*data-dropdown-fit-content="true"/u,
  );
});

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
        </div>
        <div id="regular-filter-cell" style="width: 180px; margin-top: 24px">
          <select id="regular-filter-select" class="form-control">
            <option value="">Tất cả trạng thái</option>
            <option value="evaluating">Đang chấm thầu và đánh giá hồ sơ dự thầu</option>
          </select>
        </div>
        <div id="plan-detail-cell" style="width: 120px; margin-top: 24px">
          <select id="plan-detail-select" class="form-control" data-dropdown-fit-content="true">
            <option value="00">Phiên bản kế hoạch lựa chọn nhà thầu số 00</option>
            <option value="01">Phiên bản kế hoạch lựa chọn nhà thầu số 01</option>
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
      initCustomSelect("regular-filter-select");
      initCustomSelect("plan-detail-select");
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

    await page.locator('.custom-select-container[data-target="regular-filter-select"] .custom-select-trigger').click();
    const regularGeometry = await page.locator('.custom-select-options[data-parent="regular-filter-select"]').evaluate((list) => {
      const trigger = document.getElementById("regular-filter-select-combobox");
      const option = list.querySelector('[data-value="evaluating"]');
      return {
        listWidth: Math.round(list.getBoundingClientRect().width),
        triggerWidth: Math.round(trigger.getBoundingClientRect().width),
        optionClientWidth: option.clientWidth,
        optionScrollWidth: option.scrollWidth,
        optionHeight: Math.round(option.getBoundingClientRect().height),
        lineHeight: parseFloat(getComputedStyle(option).lineHeight)
          || parseFloat(getComputedStyle(option).fontSize) * 1.2,
        whiteSpace: getComputedStyle(option).whiteSpace,
        textOverflow: getComputedStyle(option).textOverflow,
      };
    });
    assert.equal(regularGeometry.listWidth, regularGeometry.triggerWidth);
    assert.ok(regularGeometry.optionHeight > regularGeometry.lineHeight * 1.5, JSON.stringify(regularGeometry));
    assert.ok(regularGeometry.optionScrollWidth <= regularGeometry.optionClientWidth);
    assert.equal(regularGeometry.whiteSpace, "normal");
    assert.equal(regularGeometry.textOverflow, "clip");

    await page.locator('#regular-filter-select-combobox').press("Escape");
    await page.locator('.custom-select-container[data-target="plan-detail-select"] .custom-select-trigger').click();
    const planDetailGeometry = await page.locator('.custom-select-options[data-parent="plan-detail-select"]').evaluate((list) => {
      const trigger = document.getElementById("plan-detail-select-combobox");
      const option = list.querySelector('[data-value="00"]');
      const pixels = (value) => Number.parseFloat(value) || 0;
      const contentWidth = Math.max(...Array.from(list.children).map((item) => {
        const range = document.createRange();
        range.selectNodeContents(item);
        const style = getComputedStyle(item);
        return range.getBoundingClientRect().width
          + pixels(style.paddingLeft)
          + pixels(style.paddingRight)
          + pixels(style.borderLeftWidth)
          + pixels(style.borderRightWidth);
      }));
      const listStyle = getComputedStyle(list);
      const listChrome = pixels(listStyle.paddingLeft)
        + pixels(listStyle.paddingRight)
        + pixels(listStyle.borderLeftWidth)
        + pixels(listStyle.borderRightWidth);
      return {
        listWidth: Math.round(list.getBoundingClientRect().width),
        triggerWidth: Math.round(trigger.getBoundingClientRect().width),
        expectedWidth: Math.ceil(Math.max(trigger.getBoundingClientRect().width, contentWidth + listChrome)),
        listRight: Math.round(list.getBoundingClientRect().right),
        viewportWidth: window.innerWidth,
        whiteSpace: getComputedStyle(option).whiteSpace,
      };
    });
    assert.ok(planDetailGeometry.listWidth > planDetailGeometry.triggerWidth, JSON.stringify(planDetailGeometry));
    assert.ok(
      Math.abs(planDetailGeometry.listWidth - planDetailGeometry.expectedWidth) <= 1,
      JSON.stringify(planDetailGeometry),
    );
    assert.ok(planDetailGeometry.listRight <= planDetailGeometry.viewportWidth - 8, JSON.stringify(planDetailGeometry));
    assert.equal(planDetailGeometry.whiteSpace, "nowrap");
  } finally {
    await browser?.close();
    await new Promise((resolve) => server.close(resolve));
  }
});

test("searchable portal dropdown stays within the viewport for long options", async () => {
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
          <link rel="stylesheet" data-runtime-styles href="/css/runtime-styles.css">
        </head><body>
          <div id="scroll-viewport" style="position: absolute; inset: 20px 12px auto auto; width: 360px; height: 360px; overflow: auto">
            <div style="position: relative; min-height: 1200px">
              <div style="position: absolute; top: 80px; inset-inline: 0">
                <label for="plan-select">Linked procurement plan</label>
                <select id="plan-select" class="form-control">
                  <option value="">-- Select plan --</option>
                  <option value="plan-1">Procurement plan for specialized medical supplies, equipment, maintenance services, and operating materials for the full fiscal year 2026</option>
                </select>
              </div>
            </div>
          </div>
        </body></html>`);
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
    const page = await browser.newPage({ viewport: { width: 800, height: 600 } });
    await page.goto(`http://127.0.0.1:${address.port}/`);
    await page.evaluate(async () => {
      const { initAccessibleCombobox } = await import("/frontend/shared/accessibleCombobox.js");
      initAccessibleCombobox(document.getElementById("plan-select"), {
        compatibilityMode: "searchable-select",
        includeEmptyOption: true,
        noResultsText: "No results",
        placeholder: "Search plans...",
        portal: true,
        searchable: true,
        showToggle: true,
      });
    });

    await page.locator("#plan-select-combobox").click();
    const geometry = await page.evaluate(() => {
      const trigger = document.getElementById("plan-select-combobox").getBoundingClientRect();
      const list = document.getElementById("plan-select-listbox").getBoundingClientRect();
      const optionStyle = getComputedStyle(
        document.querySelector('#plan-select-listbox [data-value="plan-1"]'),
      );
      return {
        leftDelta: Math.round((list.left - trigger.left) * 100) / 100,
        widthDelta: Math.round((list.width - trigger.width) * 100) / 100,
        right: Math.round(list.right * 100) / 100,
        viewportWidth: window.innerWidth,
        overflow: optionStyle.overflow,
        textOverflow: optionStyle.textOverflow,
        whiteSpace: optionStyle.whiteSpace,
      };
    });
    assert.equal(geometry.leftDelta, 0);
    assert.equal(geometry.widthDelta, 0);
    assert.ok(geometry.right <= geometry.viewportWidth - 8, JSON.stringify(geometry));
    assert.equal(geometry.overflow, "visible");
    assert.equal(geometry.textOverflow, "clip");
    assert.equal(geometry.whiteSpace, "normal");

    await page.locator("#scroll-viewport").evaluate((viewport) => {
      viewport.scrollTop = 48;
    });
    await page.evaluate(() => new Promise((resolve) => requestAnimationFrame(() => resolve())));
    const scrolledAlignment = await page.evaluate(() => {
      const trigger = document.getElementById("plan-select-combobox").getBoundingClientRect();
      const list = document.getElementById("plan-select-listbox").getBoundingClientRect();
      return {
        leftDelta: Math.round((list.left - trigger.left) * 100) / 100,
        topDelta: Math.round((list.top - trigger.bottom) * 100) / 100,
      };
    });
    assert.equal(scrolledAlignment.leftDelta, 0);
    assert.ok(Math.abs(scrolledAlignment.topDelta) <= 1, JSON.stringify(scrolledAlignment));
  } finally {
    await browser?.close();
    await new Promise((resolve) => server.close(resolve));
  }
});
