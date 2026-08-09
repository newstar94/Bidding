import assert from "node:assert/strict";
import { createServer } from "node:http";
import { readFile } from "node:fs/promises";
import { extname, join } from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

import AxeBuilder from "@axe-core/playwright";
import { chromium } from "playwright";

const projectRoot = fileURLToPath(new URL("../..", import.meta.url));

function parseRgb(value) {
  return String(value).match(/[\d.]+/gu)?.slice(0, 3).map(Number) || [0, 0, 0];
}

function blendRgb(foreground, background, opacity) {
  return foreground.map((channel, index) => (
    channel * opacity + background[index] * (1 - opacity)
  ));
}

function relativeLuminance(rgb) {
  const channels = rgb.map((channel) => {
    const normalized = channel / 255;
    return normalized <= 0.04045
      ? normalized / 12.92
      : ((normalized + 0.055) / 1.055) ** 2.4;
  });
  return 0.2126 * channels[0] + 0.7152 * channels[1] + 0.0722 * channels[2];
}

function contrastRatio(foreground, background) {
  const lighter = Math.max(relativeLuminance(foreground), relativeLuminance(background));
  const darker = Math.min(relativeLuminance(foreground), relativeLuminance(background));
  return (lighter + 0.05) / (darker + 0.05);
}

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
          <link rel="stylesheet" href="/views/css/tokens.css">
          <link rel="stylesheet" href="/views/css/variables.css">
          <link rel="stylesheet" href="/views/css/base.css">
          <link rel="stylesheet" href="/views/css/components.css">
          <link rel="stylesheet" href="/views/css/generated-static-styles.css">
          <link rel="stylesheet" href="/views/css/ui-redesign.css">
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
          <section id="filter-fixture">
            <select id="filter-goithau-trangthai"><option value="">Tất cả trạng thái</option></select>
            <select id="filter-goithau-hinhthuc"><option value="">Tất cả hình thức</option></select>
            <select id="filter-goithau-nam"><option value="">Năm</option></select>
            <select id="filter-goithau-thang"><option value="">Tháng</option></select>
            <select id="filter-kehoach-nam"><option value="">Năm</option></select>
            <select id="filter-kehoach-thang"><option value="">Tháng</option></select>
            <select id="filter-hopdong-nam"><option value="">Năm</option></select>
            <select id="filter-hopdong-thang"><option value="">Tháng</option></select>
          </section>
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
    assert.equal(await combobox.inputValue(), "Tất cả");
    assert.equal(
      await combobox.evaluate((input) => getComputedStyle(input).textOverflow),
      "ellipsis",
    );
    assert.equal(
      await combobox.evaluate((input) => getComputedStyle(input).paddingRight),
      "36px",
    );

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


test("global select enhancement preserves an active filter combobox", async () => {
  await withSelectPage(async (page) => {
    const state = await page.evaluate(async () => {
      const [{ initCustomSelect }, { BiddingView }] = await Promise.all([
        import("/frontend/shared/view_helpers.js"),
        import("/frontend/app/BiddingView.js"),
      ]);
      const select = document.getElementById("status-select");
      initCustomSelect(select.id);
      const before = document.querySelectorAll(
        '.custom-select-container[data-target="status-select"]',
      ).length;

      BiddingView.prototype.upgradeAllSelects.call({
        isEnhancementTargetActive: () => true,
      }, document);

      const wrapper = document.querySelector(
        '.custom-select-container[data-target="status-select"]',
      );
      const rect = wrapper?.getBoundingClientRect();
      return {
        before,
        after: wrapper ? 1 : 0,
        nativeHidden: select.hidden,
        inputVisible: Boolean(
          wrapper
          && getComputedStyle(wrapper).display !== "none"
          && rect.width > 0
          && rect.height > 0
        ),
      };
    });

    assert.deepEqual(state, {
      before: 1,
      after: 1,
      nativeHidden: true,
      inputVisible: true,
    });
  });
});

test("package, plan, and contract filters keep their original empty-option titles", async () => {
  await withSelectPage(async (page) => {
    const labels = await page.evaluate(async () => {
      const { initCustomSelect } = await import("/frontend/shared/view_helpers.js");
      const ids = [
        "filter-goithau-trangthai",
        "filter-goithau-hinhthuc",
        "filter-goithau-nam",
        "filter-goithau-thang",
        "filter-kehoach-nam",
        "filter-kehoach-thang",
        "filter-hopdong-nam",
        "filter-hopdong-thang",
      ];
      for (const id of ids) initCustomSelect(id);
      return Object.fromEntries(ids.map((id) => [
        id,
        document.getElementById(`${id}-combobox`)?.value,
      ]));
    });

    assert.deepEqual(labels, {
      "filter-goithau-trangthai": "Tất cả trạng thái",
      "filter-goithau-hinhthuc": "Tất cả hình thức",
      "filter-goithau-nam": "Năm",
      "filter-goithau-thang": "Tháng",
      "filter-kehoach-nam": "Năm",
      "filter-kehoach-thang": "Tháng",
      "filter-hopdong-nam": "Năm",
      "filter-hopdong-thang": "Tháng",
    });
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

test("disabled custom select text meets WCAG AA at 320 pixels", async () => {
  await withSelectPage(async (page) => {
    await page.setViewportSize({ width: 320, height: 640 });
    await page.evaluate(async () => {
      const { initCustomSelect } = await import("/frontend/shared/view_helpers.js");
      const select = document.getElementById("status-select");
      select.value = "active";
      select.disabled = true;
      initCustomSelect(select.id);
    });
    await page.waitForFunction(() => document.getElementById("status-select-combobox")?.disabled);

    const result = await new AxeBuilder({ page })
      .include('.custom-select-container[data-target="status-select"]')
      .withRules(["color-contrast"])
      .analyze();

    assert.deepEqual(result.violations, []);
    const rendered = await page.locator("#status-select-combobox").evaluate((input) => {
      const wrapper = input.closest(".custom-select-container");
      return {
        background: getComputedStyle(input).backgroundColor,
        backdrop: getComputedStyle(document.body).backgroundColor,
        foreground: getComputedStyle(input).color,
        opacity: Number(getComputedStyle(wrapper).opacity || 1),
      };
    });
    const backdrop = parseRgb(rendered.backdrop);
    const effectiveForeground = blendRgb(parseRgb(rendered.foreground), backdrop, rendered.opacity);
    const effectiveBackground = blendRgb(parseRgb(rendered.background), backdrop, rendered.opacity);
    const ratio = contrastRatio(effectiveForeground, effectiveBackground);
    assert.ok(ratio >= 4.5, `disabled select contrast ${ratio.toFixed(2)}:1 is below 4.5:1`);
  });
});
