import assert from "node:assert/strict";
import { createServer } from "node:http";
import { readFile } from "node:fs/promises";
import { extname, join } from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

import AxeBuilder from "@axe-core/playwright";
import { chromium } from "playwright";

const root = fileURLToPath(new URL("../..", import.meta.url));

function contentType(pathname) {
  if (extname(pathname) === ".js") return "text/javascript; charset=utf-8";
  if (extname(pathname) === ".css") return "text/css; charset=utf-8";
  return "application/octet-stream";
}

async function withPage(run) {
  const server = createServer(async (request, response) => {
    try {
      const pathname = new URL(request.url, "http://127.0.0.1").pathname;
      if (pathname === "/") {
        response.writeHead(200, { "content-type": "text/html; charset=utf-8" });
        response.end(`<!doctype html><html lang="vi"><head><title>Legal catalog</title>
          <meta name="bf-legal-versioning-enabled" content="true">
          <link rel="stylesheet" href="/views/css/tokens.css">
          <link rel="stylesheet" href="/views/css/variables.css">
          <link rel="stylesheet" href="/views/css/base.css">
          <link rel="stylesheet" href="/views/css/components.css">
        </head><body><main><section id="legal-catalog-admin-card" hidden>
          <h2>Danh mục phiên bản pháp lý</h2><div id="catalog"></div>
        </section></main></body></html>`);
        return;
      }
      const payload = await readFile(join(root, pathname.replace(/^\//u, "")));
      response.writeHead(200, { "content-type": contentType(pathname) });
      response.end(payload);
    } catch {
      response.writeHead(404);
      response.end("Not Found");
    }
  });
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  let browser;
  let context;
  try {
    browser = await chromium.launch({ headless: true });
    context = await browser.newContext({ viewport: { width: 1100, height: 900 } });
    const page = await context.newPage();
    await page.goto(`http://127.0.0.1:${server.address().port}/`);
    await run(page);
  } finally {
    await context?.close();
    await browser?.close();
    await new Promise((resolve) => server.close(resolve));
  }
}

const profile = {
  id: "lpv-existing", displayName: "Chế độ pháp lý 2026", versionNo: 1,
  effectiveFrom: "2026-01-01", effectiveTo: null, priority: 10,
  manualReviewRequired: false, manifestHash: "b".repeat(64),
};

const source = {
  id: "liv-existing", documentType: "LAW", documentNumber: "01/2026/QH",
  title: "Luật đấu thầu thử nghiệm", effectiveFrom: "2026-01-01", effectiveTo: null,
  contentSha256: "a".repeat(64), sourceUri: "https://example.test/legal/01",
};

test("SYSTEM legal catalog creates and publishes exact ordered versions accessibly", async () => {
  await withPage(async (page) => {
    await page.evaluate(async ({ profileValue, sourceValue }) => {
      const module = await import("/frontend/legal-versioning/LegalCatalogAdmin.js");
      window.__legalWrites = [];
      const read = async (url) => {
        if (url.endsWith("/sources")) return { profile: profileValue, sources: [sourceValue] };
        return [profileValue];
      };
      const write = async (url, body) => {
        window.__legalWrites.push({ url, body });
        if (url === "/api/legal-versioning/instruments") return { id: "lid-new", draftRevision: 1 };
        if (url.includes("instrument-drafts")) return { ...sourceValue, id: "liv-new", contentSha256: "c".repeat(64) };
        if (url === "/api/legal-versioning/profiles") return { id: "lpd-new", draftRevision: 1 };
        return { ...profileValue, id: "lpv-new" };
      };
      await module.mountLegalCatalogAdmin(document.getElementById("catalog"), { read, write });
    }, { profileValue: profile, sourceValue: source });

    await page.getByRole("button", { name: "Xem nguồn chính xác" }).click();
    await page.getByText(`SHA-256: ${"a".repeat(64)}`).waitFor();

    await page.getByLabel("Mã ổn định").fill("law-2026");
    await page.getByLabel("Tên văn bản").fill("Luật 2026");
    await page.getByLabel("Loại văn bản").fill("LAW");
    await page.getByLabel("Số văn bản").fill("02/2026/QH");
    await page.getByLabel("URL nguồn chính thức").fill("https://example.test/legal/02");
    await page.getByLabel("Ngày ban hành").fill("2026-01-01");
    await page.getByLabel("Hiệu lực từ", { exact: true }).first().fill("2026-02-01");
    await page.getByLabel("Nội dung nguồn").fill("Nội dung bất biến.");
    await page.getByRole("button", { name: "Tạo bản nháp văn bản" }).click();
    await page.getByText(/Đã tạo draft lid-new/u).waitFor();
    await page.getByRole("button", { name: "Xuất bản văn bản" }).click();
    await page.getByText(/Đã xuất bản liv-new/u).waitFor();
    await page.getByText("liv-new", { exact: true }).locator("..").getByRole("button", { name: "Thêm vào hồ sơ" }).click();

    await page.getByLabel("Mã hồ sơ ổn định").fill("regime-2026");
    await page.getByLabel("Tên hồ sơ").fill("Chế độ 2026 bổ sung");
    await page.getByLabel("Hiệu lực từ", { exact: true }).nth(1).fill("2026-02-01");
    await page.getByLabel("Độ ưu tiên").fill("20");
    await page.getByRole("button", { name: "Tạo bản nháp hồ sơ" }).click();
    await page.getByText(/Đã tạo draft hồ sơ lpd-new/u).waitFor();
    await page.getByRole("button", { name: "Xuất bản hồ sơ" }).click();

    const writes = await page.evaluate(() => window.__legalWrites);
    assert.equal(writes.length, 4);
    assert.deepEqual(writes[3], {
      url: "/api/legal-versioning/profile-drafts/lpd-new/publish",
      body: { expectedDraftRevision: 1 },
    });
    assert.deepEqual(writes[2].body.instrumentVersionIds, ["liv-new"]);

    const axe = await new AxeBuilder({ page }).include("#legal-catalog-admin-card").analyze();
    assert.deepEqual(axe.violations, []);
    await page.setViewportSize({ width: 320, height: 760 });
    const mobile = await page.locator("#legal-catalog-admin-card").evaluate((card) => ({
      overflow: document.documentElement.scrollWidth > document.documentElement.clientWidth,
      buttons: [...card.querySelectorAll("button")].filter((item) => !item.disabled)
        .map((item) => item.getBoundingClientRect().height),
    }));
    assert.equal(mobile.overflow, false);
    assert.ok(mobile.buttons.every((height) => height >= 44));
  });
});

test("legal catalog hides on 404 and recovers from stale profile publish", async () => {
  await withPage(async (page) => {
    const hidden = await page.evaluate(async () => {
      const module = await import("/frontend/legal-versioning/LegalCatalogAdmin.js");
      await module.mountLegalCatalogAdmin(document.getElementById("catalog"), {
        read: async () => { throw Object.assign(new Error("disabled"), { status: 404 }); },
      });
      return document.getElementById("legal-catalog-admin-card").hidden;
    });
    assert.equal(hidden, true);
  });

  await withPage(async (page) => {
    await page.evaluate(async ({ profileValue }) => {
      const module = await import("/frontend/legal-versioning/LegalCatalogAdmin.js");
      let reads = 0;
      window.__catalogReads = () => reads;
      await module.mountLegalCatalogAdmin(document.getElementById("catalog"), {
        read: async () => { reads += 1; return [profileValue]; },
        write: async (url) => {
          if (url === "/api/legal-versioning/profiles") return { id: "lpd-stale", draftRevision: 1 };
          throw Object.assign(new Error("stale"), { status: 409 });
        },
      });
    }, { profileValue: profile });
    await page.getByLabel("Mã hồ sơ ổn định").fill("regime-stale");
    await page.getByLabel("Tên hồ sơ").fill("Hồ sơ stale");
    await page.getByLabel("Hiệu lực từ", { exact: true }).nth(1).fill("2026-03-01");
    await page.getByLabel("ID phiên bản văn bản theo đúng thứ tự").fill("liv-existing");
    await page.getByRole("button", { name: "Tạo bản nháp hồ sơ" }).click();
    await page.getByRole("button", { name: "Xuất bản hồ sơ" }).click();
    await page.getByText(/Danh mục đã được tải lại/u).waitFor();
    assert.equal(await page.evaluate(() => window.__catalogReads()), 2);
    assert.equal(await page.getByRole("button", { name: "Xuất bản hồ sơ" }).isDisabled(), true);
  });
});
