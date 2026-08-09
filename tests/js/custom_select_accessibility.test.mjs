import assert from "node:assert/strict";
import { createServer } from "node:http";
import { readFile } from "node:fs/promises";
import { extname, join } from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

import AxeBuilder from "@axe-core/playwright";
import { chromium } from "playwright";

const projectRoot = fileURLToPath(new URL("../..", import.meta.url));

function contentType(pathname) {
  if ([".js", ".mjs"].includes(extname(pathname))) return "text/javascript; charset=utf-8";
  if (extname(pathname) === ".css") return "text/css; charset=utf-8";
  return "text/html; charset=utf-8";
}

async function withSelectPage(run) {
  const server = createServer(async (request, response) => {
    try {
      const pathname = new URL(request.url, "http://127.0.0.1").pathname;
      if (pathname === "/") {
        response.writeHead(200, { "content-type": contentType(".html") });
        response.end(`<!doctype html><html lang="vi"><head><title>Custom select</title>
          <link rel="stylesheet" data-runtime-styles href="/views/css/runtime-styles.css">
        </head><body>
          <main><form id="select-form">
            <label for="status-select">Trạng thái</label>
            <select id="status-select">
              <option value="">Tất cả</option>
              <option value="active">Đang hoạt động</option>
              <option value="archived">Đã lưu trữ</option>
            </select>
            <label for="province-select">Tỉnh thành</label>
            <select id="province-select">
              <option value="">Chọn tỉnh thành</option>
              <option value="hn">Hà Nội</option>
              <option value="dn">Đà Nẵng</option>
              <option value="hcm">Thành phố Hồ Chí Minh</option>
            </select>
          </form></main>
        </body></html>`);
        return;
      }
      const payload = await readFile(join(projectRoot, pathname.replace(/^\//u, "")));
      response.writeHead(200, { "content-type": contentType(pathname) });
      response.end(payload);
    } catch {
      if (!response.headersSent) response.writeHead(404);
      if (!response.writableEnded) response.end("Not Found");
    }
  });
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  let browser;
  let context;
  try {
    browser = await chromium.launch({ headless: true });
    context = await browser.newContext();
    const page = await context.newPage();
    await page.goto(`http://127.0.0.1:${server.address().port}/`);
    await run(page);
  } finally {
    await context?.close();
    await browser?.close();
    await new Promise((resolve) => server.close(resolve));
  }
}

test("generic custom select exposes keyboard and screen-reader combobox behavior", async () => {
  await withSelectPage(async (page) => {
    await page.evaluate(async () => {
      const { initCustomSelect } = await import("/frontend/shared/view_helpers.js");
      const select = document.getElementById("status-select");
      select.addEventListener("change", () => {
        document.body.dataset.changeCount = String(Number(document.body.dataset.changeCount || 0) + 1);
      });
      initCustomSelect(select.id);
    });

    const combobox = page.getByRole("combobox", { name: "Trạng thái" });
    assert.equal(await combobox.getAttribute("aria-haspopup"), "listbox");
    assert.equal(await combobox.getAttribute("aria-expanded"), "false");

    await combobox.focus();
    assert.equal(await combobox.getAttribute("aria-expanded"), "true");
    const listboxId = await combobox.getAttribute("aria-controls");
    assert.equal(await page.locator(`#${listboxId}`).getAttribute("role"), "listbox");
    assert.equal(await page.locator(`#${listboxId} [role="option"]`).count(), 3);

    await combobox.press("End");
    const activeOptionId = await combobox.getAttribute("aria-activedescendant");
    assert.equal(await page.locator(`#${activeOptionId}`).textContent(), "Đã lưu trữ");
    await combobox.press("Enter");
    assert.equal(await page.locator("#status-select").inputValue(), "archived");
    assert.equal(await page.locator("body").getAttribute("data-change-count"), "1");
    assert.equal(await combobox.getAttribute("aria-expanded"), "false");

    await combobox.press("ArrowDown");
    await combobox.press("Escape");
    assert.equal(await combobox.getAttribute("aria-expanded"), "false");
    assert.equal(await combobox.inputValue(), "Đã lưu trữ");

    const axe = await new AxeBuilder({ page }).include("#select-form").analyze();
    assert.deepEqual(axe.violations, []);
  });
});

test("searchable select filters, selects, and follows native option state accessibly", async () => {
  await withSelectPage(async (page) => {
    await page.evaluate(async () => {
      const { makeSearchableSelect } = await import("/frontend/shared/PartnerHelpers.js");
      const select = document.getElementById("province-select");
      select.addEventListener("change", () => {
        document.body.dataset.provinceChangeCount = String(
          Number(document.body.dataset.provinceChangeCount || 0) + 1,
        );
      });
      makeSearchableSelect(select, "Tìm kiếm tỉnh thành");
    });

    const combobox = page.getByRole("combobox", { name: "Tỉnh thành" });
    await combobox.fill("da nang");
    const listboxId = await combobox.getAttribute("aria-controls");
    const options = page.locator(`#${listboxId} [role="option"]:not([aria-disabled="true"])`);
    assert.equal(await options.count(), 1);
    assert.equal(await options.first().textContent(), "Đà Nẵng");

    await combobox.press("ArrowDown");
    await combobox.press("Enter");
    assert.equal(await page.locator("#province-select").inputValue(), "dn");
    assert.equal(await page.locator("body").getAttribute("data-province-change-count"), "1");

    await page.locator("#province-select").evaluate((select) => {
      select.disabled = true;
    });
    await page.waitForFunction(() => document.getElementById("province-select-combobox")?.disabled);
    assert.equal(await combobox.isDisabled(), true);

    await page.locator("#province-select").evaluate((select) => {
      select.disabled = false;
      select.appendChild(new Option("Thừa Thiên Huế", "hue"));
    });
    await page.waitForFunction(() => !document.getElementById("province-select-combobox")?.disabled);
    await combobox.fill("thua thien hue");
    assert.equal(await options.count(), 1);
    assert.equal(await options.first().textContent(), "Thừa Thiên Huế");
  });
});
