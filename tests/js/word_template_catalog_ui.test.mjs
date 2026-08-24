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
  if (extname(pathname) === ".woff2") return "font/woff2";
  return "application/octet-stream";
}

async function requestBody(request) {
  const chunks = [];
  for await (const chunk of request) chunks.push(chunk);
  return chunks.length ? JSON.parse(Buffer.concat(chunks).toString("utf8")) : null;
}

function cardMarkup() {
  return `<section class="dashboard-card word-template-catalog-card" id="word-template-catalog-card"
      aria-labelledby="word-template-catalog-title" hidden>
    <div class="card-header"><div>
      <h3 class="card-title" id="word-template-catalog-title">Vòng đời biểu mẫu Word</h3>
      <p class="word-template-catalog-intro">Theo dõi các phiên bản bất biến.</p>
      <label for="word-template-preview-document-type">Ngữ cảnh xem trước
        <select id="word-template-preview-document-type" class="form-control">
          <option value="plan">Kế hoạch lựa chọn nhà thầu</option>
          <option value="evaluation">Báo cáo đánh giá</option>
        </select>
      </label>
      <label for="word-template-standardization-profile">Chuẩn thể thức
        <select id="word-template-standardization-profile" class="form-control"
          aria-describedby="word-template-standardization-help">
          <option value="sector_template">Mẫu chuyên ngành đấu thầu</option>
          <option value="n30_strict">Nghị định 30 nghiêm ngặt</option>
          <option value="reference_only">Chỉ kiểm tra</option>
        </select>
      </label>
      <p id="word-template-standardization-help">Chỉ sửa định dạng an toàn trên bản nháp mới.</p>
    </div><button type="button" class="btn btn-outline word-template-catalog-refresh"
      id="word-template-catalog-refresh">Tải lại</button></div>
    <div class="card-body"><div class="word-template-catalog-layout">
      <section class="word-template-catalog-pane" aria-labelledby="word-template-catalog-list-title">
        <h4 id="word-template-catalog-list-title">Biểu mẫu logic</h4>
        <div id="word-template-catalog-list" class="word-template-catalog-list"></div>
      </section>
      <section class="word-template-catalog-pane" aria-labelledby="word-template-catalog-detail-title">
        <h4 id="word-template-catalog-detail-title">Lịch sử phiên bản</h4>
        <div id="word-template-version-timeline" class="word-template-version-timeline"></div>
      </section>
    </div><p id="word-template-catalog-status" class="word-template-catalog-status"
      role="status" aria-live="polite"></p></div>
  </section>`;
}

function template(rowVersion = 4) {
  return {
    id: "template-a",
    stableCode: "procurement-plan",
    displayName: "Kế hoạch lựa chọn nhà thầu",
    draftVersionId: "version-2",
    publishedVersionId: "version-1",
    rowVersion,
  };
}

function versions(rowVersion = 4) {
  return {
    template: template(rowVersion),
    versions: [
      {
        id: "version-2",
        templateId: "template-a",
        versionNo: 2,
        lifecycle: "DRAFT",
        sha256: "b".repeat(64),
        byteSize: 4096,
        originalFilename: "ke-hoach-v2.docx",
        createdById: "manager-a",
        createdAt: "2026-08-24T08:30:00+07:00",
      },
      {
        id: "version-1",
        templateId: "template-a",
        versionNo: 1,
        lifecycle: "PUBLISHED",
        sha256: "a".repeat(64),
        byteSize: 2048,
        originalFilename: "ke-hoach.docx",
        createdById: "manager-a",
        createdAt: "2026-08-23T08:30:00+07:00",
      },
    ],
  };
}

async function withCatalogPage(handler, run) {
  const calls = [];
  const server = createServer(async (request, response) => {
    try {
      const pathname = new URL(request.url, "http://127.0.0.1").pathname;
      if (pathname === "/") {
        response.writeHead(200, {
          "content-type": "text/html; charset=utf-8",
          "set-cookie": "csrf_token=test-token; Path=/; SameSite=Lax",
        });
        response.end(`<!doctype html><html lang="vi"><head><title>Vòng đời biểu mẫu</title>
          <link rel="stylesheet" href="/views/css/tokens.css">
          <link rel="stylesheet" href="/views/css/variables.css">
          <link rel="stylesheet" href="/views/css/base.css">
          <link rel="stylesheet" href="/views/css/components.css">
        </head><body><main>${cardMarkup()}</main></body></html>`);
        return;
      }
      if (pathname.startsWith("/api/word-template-catalog")) {
        const body = await requestBody(request);
        const headers = { ...request.headers };
        calls.push({ pathname, method: request.method, body, headers });
        const result = await handler({
          pathname,
          method: request.method,
          body,
          headers,
          calls,
        });
        response.writeHead(result.status || 200, result.headers || {
          "content-type": "application/json; charset=utf-8",
        });
        response.end(result.raw ?? JSON.stringify(result.body));
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
    context = await browser.newContext({ viewport: { width: 1100, height: 900 } });
    const page = await context.newPage();
    await page.goto(`http://127.0.0.1:${server.address().port}/`);
    await run(page, calls);
  } finally {
    await context?.close();
    await browser?.close();
    await new Promise((resolve) => server.close(resolve));
  }
}

async function loadCatalog(page, role = "manager") {
  await page.evaluate(async (activeRole) => {
    const module = await import("/frontend/documents/WordTemplateCatalog.js");
    const controller = {
      model: {
        workspaceEpoch: 1,
        state: {
          activerole: activeRole,
          activeuser: {
            activeOrganizationId: "org-a",
            organizations: [{
              id: "org-a",
              name: "Đơn vị A",
              scope_type: "organization",
              role: activeRole,
              status: "active",
            }],
          },
        },
      },
      view: {
        async customPrompt() { return "Đã kiểm tra và phê duyệt"; },
        showToast(title, message, type) { window.__catalogToast = { title, message, type }; },
        createIconsScoped() {},
      },
    };
    window.__catalogController = controller;
    await module.loadAndRenderWordTemplateCatalog(controller);
  }, role);
}

test("catalog renders immutable timeline and publishes only after a passing preflight", async () => {
  let published = false;
  await withCatalogPage(async ({ pathname, method, body }) => {
    if (pathname === "/api/word-template-catalog" && method === "GET") {
      return { body: [template(published ? 5 : 4)] };
    }
    if (pathname.endsWith("/template-a/versions") && method === "GET") {
      const payload = versions(published ? 5 : 4);
      if (published) {
        payload.template.draftVersionId = null;
        payload.template.publishedVersionId = "version-2";
        payload.versions[0].lifecycle = "PUBLISHED";
        payload.versions[1].lifecycle = "RETIRED";
      }
      return { body: payload };
    }
    if (pathname.endsWith("/version-2/preflight") && method === "POST") {
      assert.deepEqual(body, {
        documentTypes: [],
        standardizationProfile: "sector_template",
      });
      return { status: 201, body: {
        id: "preflight-a",
        result: "PASS",
        report: { summary: { blockers: 0, warnings: 1 }, issues: [{
          severity: "WARNING",
          code: "CROSS_CONTEXT_VARIABLE",
          message: "Biến được dùng ở nhiều ngữ cảnh.",
        }], standardization: {
          profile: "sector_template",
          mode: "preview_fix",
          documentType: { value: "thong_bao", confidence: 0.97 },
          summary: {
            compliant: 12,
            safeFixes: 2,
            previewOnly: 1,
            manualReview: 0,
          },
          issues: [{
            ruleId: "N30-SHELL-FONT",
            fixPolicy: "SAFE_AUTO_FIX",
            message: "Phông chữ chưa theo Times New Roman.",
          }],
        } },
      } };
    }
    if (pathname.endsWith("/version-2/standardized-preview") && method === "POST") {
      assert.deepEqual(body, {
        acceptedPreflightRunId: "preflight-a",
        standardizationProfile: "sector_template",
      });
      return {
        headers: {
          "content-type": "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
          "content-disposition": 'attachment; filename="preview-chuan-hoa-v2.docx"',
        },
        raw: Buffer.from("standardized-preview"),
      };
    }
    if (pathname.endsWith("/version-2/preview") && method === "POST") {
      assert.deepEqual(body, { mode: "SAMPLE", documentType: "plan" });
      return {
        headers: {
          "content-type": "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
          "content-disposition": 'attachment; filename="preview-2-plan.docx"',
        },
        raw: Buffer.from("rendered-preview"),
      };
    }
    if (pathname.endsWith("/template-a/publish") && method === "POST") {
      assert.deepEqual(body, {
        versionId: "version-2",
        acceptedPreflightRunId: "preflight-a",
        expectedRowVersion: 4,
        reason: "Đã kiểm tra và phê duyệt",
      });
      published = true;
      return { body: template(5) };
    }
    throw new Error(`Unexpected API ${method} ${pathname}`);
  }, async (page, calls) => {
    await loadCatalog(page);
    const card = page.locator("#word-template-catalog-card");
    assert.equal(await card.isVisible(), true);
    assert.match(await card.textContent(), /Bản nháp/u);
    assert.match(await card.textContent(), /Đã phát hành/u);
    assert.match(await card.textContent(), /manager-a/u);
    assert.match(await card.textContent(), new RegExp("b{64}", "u"));

    const draft = page.locator('[data-version-id="version-2"]');
    const downloadPromise = page.waitForEvent("download");
    await draft.getByRole("button", { name: "Xem trước dữ liệu mẫu" }).click();
    const download = await downloadPromise;
    assert.equal(download.suggestedFilename(), "preview-2-plan.docx");
    const publish = draft.getByRole("button", { name: "Phát hành" });
    assert.equal(await publish.isDisabled(), true);
    await draft.getByRole("button", { name: "Chạy kiểm tra" }).click();
    await page.getByText(/Đạt · 1 cảnh báo/u).waitFor();
    await page.getByText(/Kiểm tra thể thức · Thông báo \(97%\)/u).waitFor();
    const standardizedDownloadPromise = page.waitForEvent("download");
    await draft.getByRole("button", { name: "Xem bản chuẩn hóa" }).click();
    const standardizedDownload = await standardizedDownloadPromise;
    assert.equal(standardizedDownload.suggestedFilename(), "preview-chuan-hoa-v2.docx");
    assert.equal(await publish.isEnabled(), true);
    await publish.click();
    await page.waitForFunction(() => window.__catalogToast?.title === "Đã phát hành biểu mẫu");
    assert.deepEqual(await page.evaluate(() => window.__catalogToast), {
      title: "Đã phát hành biểu mẫu",
      message: "Phiên bản 2 đã trở thành phiên bản phát hành.",
      type: "success",
    });
    assert.match(await page.locator('[data-version-id="version-2"]').textContent(), /Đã phát hành/u);
    assert.equal(calls.filter((call) => call.pathname.endsWith("/publish")).length, 1);

    const axe = await new AxeBuilder({ page }).include("#word-template-catalog-card").analyze();
    assert.deepEqual(axe.violations, []);

    await page.setViewportSize({ width: 320, height: 800 });
    const mobile = await card.evaluate((element) => ({
      overflow: document.documentElement.scrollWidth > document.documentElement.clientWidth,
      columns: getComputedStyle(element.querySelector(".word-template-catalog-layout")).gridTemplateColumns,
      actionHeights: [...element.querySelectorAll(".word-template-version-actions .btn")]
        .map((button) => button.getBoundingClientRect().height),
    }));
    assert.equal(mobile.overflow, false);
    assert.equal(mobile.columns.split(" ").length, 1);
    assert.ok(mobile.actionHeights.every((height) => height >= 44));
  });
});

test("safe formatting creates a new immutable draft and keeps the source version", async () => {
  let standardized = false;
  await withCatalogPage(async ({ pathname, method, body, headers }) => {
    if (pathname === "/api/word-template-catalog" && method === "GET") {
      const current = template(standardized ? 5 : 4);
      if (standardized) current.draftVersionId = "version-3";
      return { body: [current] };
    }
    if (pathname.endsWith("/template-a/versions") && method === "GET") {
      if (!standardized) return { body: versions(4) };
      const payload = versions(5);
      payload.template.draftVersionId = "version-3";
      payload.versions[0].lifecycle = "RETIRED";
      payload.versions.unshift({
        id: "version-3",
        templateId: "template-a",
        versionNo: 3,
        lifecycle: "DRAFT",
        sha256: "c".repeat(64),
        byteSize: 4200,
        originalFilename: "ke-hoach-v2-chuan-hoa.docx",
        createdById: "manager-a",
        createdAt: "2026-08-24T09:30:00+07:00",
      });
      return { body: payload };
    }
    if (pathname.endsWith("/version-2/preflight") && method === "POST") {
      return { status: 201, body: {
        id: "preflight-standardize",
        result: "PASS",
        report: {
          summary: { blockers: 0, warnings: 0 },
          issues: [],
          standardization: {
            profile: body.standardizationProfile,
            mode: "preview_fix",
            documentType: { value: "ke_hoach", confidence: 0.96 },
            summary: {
              compliant: 10,
              safeFixes: 3,
              previewOnly: 1,
              manualReview: 0,
            },
            issues: [{
              ruleId: "N30-SHELL-FONT",
              fixPolicy: "SAFE_AUTO_FIX",
              message: "Phông chữ phần thể thức chưa theo cấu hình đã chọn.",
            }],
          },
        },
      } };
    }
    if (pathname.endsWith("/template-a/standardized-drafts") && method === "POST") {
      assert.match(headers["idempotency-key"], /^wordstd-[0-9a-f-]+$/u);
      assert.deepEqual(body, {
        sourceVersionId: "version-2",
        acceptedPreflightRunId: "preflight-standardize",
        expectedRowVersion: 4,
        standardizationProfile: "sector_template",
        reason: "Đã kiểm tra và phê duyệt",
      });
      standardized = true;
      return { status: 201, body: {
        created: true,
        sourceVersionId: "version-2",
        draftVersionId: "version-3",
      } };
    }
    throw new Error(`Unexpected API ${method} ${pathname}`);
  }, async (page, calls) => {
    await loadCatalog(page);
    const source = page.locator('[data-version-id="version-2"]');
    await source.getByRole("button", { name: "Chạy kiểm tra" }).click();
    await source.getByRole("button", { name: "Tạo bản nháp chuẩn hóa" }).click();
    await page.waitForFunction(
      () => window.__catalogToast?.title === "Đã tạo bản nháp chuẩn hóa",
    );
    assert.equal(await page.locator('[data-version-id="version-3"]').count(), 1);
    assert.equal(await page.locator('[data-version-id="version-2"]').count(), 1);
    assert.match(
      await page.locator('[data-version-id="version-2"]').textContent(),
      /Đã thay thế/u,
    );
    assert.equal(
      calls.filter((call) => call.pathname.endsWith("/standardized-drafts")).length,
      1,
    );
  });
});

test("a late preflight response cannot restore actions for a previous profile", async () => {
  await withCatalogPage(async ({ pathname, method, body }) => {
    if (pathname === "/api/word-template-catalog" && method === "GET") {
      return { body: [template()] };
    }
    if (pathname.endsWith("/template-a/versions") && method === "GET") {
      return { body: versions() };
    }
    if (pathname.endsWith("/version-2/preflight") && method === "POST") {
      await new Promise((resolve) => setTimeout(resolve, 180));
      return { status: 201, body: {
        id: "preflight-old-profile",
        result: "PASS",
        report: {
          summary: { blockers: 0, warnings: 0 },
          issues: [],
          standardization: {
            profile: body.standardizationProfile,
            mode: "preview_fix",
            documentType: { value: "thong_bao", confidence: 0.97 },
            summary: {
              compliant: 10,
              safeFixes: 1,
              previewOnly: 0,
              manualReview: 0,
            },
            issues: [],
          },
        },
      } };
    }
    throw new Error(`Unexpected API ${method} ${pathname}`);
  }, async (page) => {
    await loadCatalog(page);
    const source = page.locator('[data-version-id="version-2"]');
    await source.getByRole("button", { name: "Chạy kiểm tra" }).click({ noWaitAfter: true });
    await page.locator("#word-template-standardization-profile").selectOption("n30_strict");
    await page.waitForTimeout(250);
    assert.equal(
      await source.getByRole("button", { name: "Tạo bản nháp chuẩn hóa" }).count(),
      0,
    );
    assert.match(
      await page.locator("#word-template-catalog-status").textContent(),
      /Đã đổi chuẩn thể thức/u,
    );
  });
});

test("stale restore reloads current state instead of overwriting it", async () => {
  let rowVersion = 4;
  await withCatalogPage(async ({ pathname, method }) => {
    if (pathname === "/api/word-template-catalog" && method === "GET") {
      return { body: [template(rowVersion)] };
    }
    if (pathname.endsWith("/template-a/versions") && method === "GET") {
      return { body: versions(rowVersion) };
    }
    if (pathname.endsWith("/template-a/restore") && method === "POST") {
      rowVersion = 8;
      return {
        status: 409,
        body: {
          code: "WORD_TEMPLATE_CATALOG_CONFLICT",
          error: "Yêu cầu vòng đời biểu mẫu Word không hợp lệ.",
          fields: { current: template(8) },
        },
      };
    }
    throw new Error(`Unexpected API ${method} ${pathname}`);
  }, async (page, calls) => {
    await loadCatalog(page);
    await page.locator('[data-version-id="version-1"]')
      .getByRole("button", { name: "Khôi phục thành bản nháp" }).click();
    await page.getByText(/Đã tải lại trạng thái mới nhất/u).waitFor();
    assert.match(await page.locator('[data-template-id="template-a"]').textContent(), /Revision 8/u);
    assert.equal(calls.filter((call) => call.pathname.endsWith("/restore")).length, 1);
  });
});

test("disabled catalog stays hidden", async () => {
  await withCatalogPage(async () => ({
    status: 404,
    body: { code: "WORD_TEMPLATE_CATALOG_DISABLED", error: "Chưa bật" },
  }), async (page) => {
    await loadCatalog(page);
    assert.equal(await page.locator("#word-template-catalog-card").isHidden(), true);
  });
});
