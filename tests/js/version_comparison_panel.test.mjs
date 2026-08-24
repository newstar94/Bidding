import assert from "node:assert/strict";
import { createServer } from "node:http";
import { readFile } from "node:fs/promises";
import { extname, join } from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

import AxeBuilder from "@axe-core/playwright";
import { chromium } from "playwright";

import {
  buildVersionComparisonRequest,
  renderVersionComparisonResult,
} from "../../frontend/version-comparison/VersionComparisonPanel.js";

const projectRoot = fileURLToPath(new URL("../..", import.meta.url));

function contentType(pathname) {
  if ([".js", ".mjs"].includes(extname(pathname))) return "text/javascript; charset=utf-8";
  if (extname(pathname) === ".css") return "text/css; charset=utf-8";
  return "text/html; charset=utf-8";
}


test("comparison request uses only server version ids and bounded options", () => {
  assert.deepEqual(buildVersionComparisonRequest({
    entityType: "goithau",
    leftVersionId: "package-v1",
    rightVersionId: "package-v2",
    includeUnchanged: true,
  }), {
    entityType: "goithau",
    leftVersionId: "package-v1",
    rightVersionId: "package-v2",
    includeUnchanged: true,
  });
  assert.deepEqual(buildVersionComparisonRequest({
    entityType: "goithau",
    leftVersionId: "package-v1",
    rightVersionId: "package-v2",
    relationPage: { path: "assignments", cursor: "opaque", limit: 9999 },
  }).relationPage, {
    path: "assignments",
    cursor: "opaque",
    limit: 500,
  });
});


test("result distinguishes potential and not-evaluated impacts accessibly", () => {
  const markup = renderVersionComparisonResult({
    summary: { added: 1, removed: 0, modified: 1, unchanged: 2 },
    fields: [{
      path: "tenGoiThau",
      labelKey: "package.name",
      kind: "SCALAR",
      change: "MODIFIED",
      oldValue: "Gói A <script>",
      newValue: "Gói B",
    }],
    relations: [],
    impacts: [
      { category: "TIMELINE", assessment: "POTENTIAL", reasonCode: "SOURCE_FIELD_CHANGED" },
      { category: "LEGAL_RULES", assessment: "NOT_EVALUATED", reasonCode: "AUTHORITATIVE_PROVIDER_NOT_AVAILABLE" },
    ],
  });

  assert.match(markup, /role="status"/);
  assert.match(markup, /Có thể bị ảnh hưởng/);
  assert.match(markup, /Chưa đủ dữ liệu để đánh giá/);
  assert.doesNotMatch(markup, /<script>/);
  assert.match(markup, /Gói A &lt;script&gt;/);
});


test("result filters changes and exposes full ambiguous values plus pagination", () => {
  const result = {
    summary: { added: 1, removed: 0, modified: 1, unchanged: 0 },
    fields: [
      { path: "added", change: "ADDED", oldValue: null, newValue: "A" },
      { path: "modified", change: "MODIFIED", oldValue: "A", newValue: "B" },
    ],
    relations: [{
      path: "unknownRows",
      summary: { added: 0, removed: 0, modified: 0, unchanged: 0 },
      changes: [],
      ambiguousMatches: [{
        reasonCode: "UNREGISTERED_RELATION_POLICY",
        oldValues: [{ soTaiKhoan: "001122" }],
        newValues: [{ soTaiKhoan: "998877" }],
      }],
      nextCursor: "opaque-cursor",
    }],
    impacts: [],
  };

  const markup = renderVersionComparisonResult(result, "ADDED");

  assert.match(markup, />added<\/span>/);
  assert.doesNotMatch(markup, />modified<\/span>/);
  assert.match(markup, /001122/);
  assert.match(markup, /998877/);
  assert.match(markup, /data-load-relation-cursor="opaque-cursor"/);
});


test("result presents business labels and structured relation values", () => {
  const markup = renderVersionComparisonResult({
    summary: { modified: 1 },
    fields: [{
      path: "thoiGianDangMa", change: "MODIFIED",
      oldValue: "2026-08-01T08:00", newValue: "2026-08-02T08:00",
    }],
    relations: [{
      path: "assignments", summary: { modified: 1 },
      changes: [{
        identity: { empId: "employee-a", type: "goithau" },
        change: "MODIFIED",
        oldValue: { empId: "employee-a", type: "goithau" },
        newValue: { empId: "employee-b", type: "goithau" },
      }],
    }],
    impacts: [{
      category: "LEGAL_RULES", assessment: "NOT_EVALUATED",
      reasonCode: "AUTHORITATIVE_PROVIDER_NOT_AVAILABLE",
    }],
  });

  assert.match(markup, /Thời gian đăng mã/);
  assert.match(markup, /Phân công nhân sự/);
  assert.match(markup, /Quy định pháp lý/);
  assert.match(markup, /Chưa có nguồn dữ liệu thẩm quyền/);
  assert.match(markup, /Nhân sự/);
  assert.match(markup, /employee-a/);
  assert.match(markup, /employee-b/);
  assert.doesNotMatch(markup, />thoiGianDangMa</);
  assert.doesNotMatch(markup, />assignments</);
  assert.doesNotMatch(markup, />LEGAL_RULES</);
  assert.doesNotMatch(markup, />AUTHORITATIVE_PROVIDER_NOT_AVAILABLE</);
  assert.doesNotMatch(markup, /\{\s*&quot;empId&quot;/);
});


test("overview explains totals across fields and related data", () => {
  const markup = renderVersionComparisonResult({
    summary: { added: 0, removed: 0, modified: 2, unchanged: 29 },
    fields: [{
      path: "thoiGianDangMa", change: "MODIFIED",
      oldValue: "2026-07-23T14:25:00", newValue: "2026-08-11T10:42:11",
    }],
    relations: [{
      path: "assignments",
      summary: { added: 0, removed: 0, modified: 1, unchanged: 3 },
      changes: [{
        identity: { empId: "employee-a" }, change: "MODIFIED",
        oldValue: { empId: "employee-a" }, newValue: { empId: "employee-b" },
      }],
    }],
    impacts: [],
  });

  assert.match(markup, /Tổng hợp trường dữ liệu và dữ liệu liên quan/);
  assert.match(markup, /<strong>1<\/strong> thay đổi trường dữ liệu/);
  assert.match(markup, /<strong>1<\/strong> thay đổi dữ liệu liên quan/);
  assert.match(markup, /trường dữ liệu \(1\)/);
  assert.match(markup, /Dữ liệu liên quan \(1\)/);
});


test("comparison dialog supports keyboard tabs, focus restore, and axe", async () => {
  const server = createServer(async (request, response) => {
    try {
      const pathname = new URL(request.url, "http://127.0.0.1").pathname;
      if (pathname === "/") {
        response.writeHead(200, { "content-type": contentType(".html") });
        response.end(`<!doctype html><html><head>
          <meta name="bf-version-comparison-enabled" content="true">
          <link rel="stylesheet" href="/views/css/variables.css">
          <link rel="stylesheet" href="/views/css/components.css">
        </head><body><button id="trigger">So sánh</button></body></html>`);
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
    const context = await browser.newContext({ viewport: { width: 1024, height: 760 } });
    const page = await context.newPage();
    await page.goto(`http://127.0.0.1:${address.port}/`);
    await page.evaluate(async () => {
      const { openVersionComparisonPanel } = await import(
        "/frontend/version-comparison/VersionComparisonPanel.js"
      );
      const trigger = document.getElementById("trigger");
      trigger.focus();
      window.comparisonCalls = [];
      openVersionComparisonPanel({
        versions: [
          { id: "package-v1", label: "00" },
          { id: "package-v2", label: "01" },
        ],
        selectedId: "package-v2",
        trigger,
        request: async (_url, payload) => {
          window.comparisonCalls.push(payload);
          if (payload.relationPage) {
            return {
              summary: { added: 2, removed: 0, modified: 1, unchanged: 4 },
              fields: [],
              relations: [{
                path: "assignments",
                summary: { added: 2, removed: 0, modified: 0, unchanged: 0 },
                changes: [{
                  identity: { empId: "employee-b", type: "goithau" },
                  change: "ADDED", oldValue: null, newValue: { empId: "employee-b" },
                }],
                ambiguousMatches: [],
                nextCursor: null,
              }],
              impacts: [],
            };
          }
          return {
            summary: { added: 2, removed: 0, modified: 1, unchanged: 4 },
            fields: [{
              path: "tenGoiThau", change: "MODIFIED", oldValue: "Gói A", newValue: "Gói B",
            }],
            relations: [{
              path: "assignments",
              summary: { added: 2, removed: 0, modified: 0, unchanged: 0 },
              changes: [{
                identity: { empId: "employee-a", type: "goithau" },
                change: "ADDED", oldValue: null, newValue: { empId: "employee-a" },
              }],
              ambiguousMatches: [],
              nextCursor: "next-page",
            }],
            impacts: [{
              category: "LEGAL_RULES",
              assessment: "NOT_EVALUATED",
              reasonCode: "AUTHORITATIVE_PROVIDER_NOT_AVAILABLE",
            }],
          };
        },
        root: document,
      });
      const { BiddingView } = await import("/frontend/app/BiddingView.js");
      new BiddingView({}).upgradeAllSelects(document.getElementById("version-comparison-modal"));
    });
    await page.getByText("Đã cập nhật kết quả so sánh.").waitFor();
    await page.locator(
      'link[href="/frontend/version-comparison/VersionComparisonPanel.css"][data-asset-state="loaded"]',
    ).waitFor({ state: "attached" });
    assert.equal(await page.locator(".version-comparison-controls .bf-combobox").count(), 0);
    await page.getByText("Đối chiếu dữ liệu nghiệp vụ và phạm vi tác động giữa hai snapshot.").waitFor();
    await page.locator(".version-comparison-controls").getByText(
      "Phiên bản trước",
      { exact: true },
    ).waitFor();
    await page.locator(".version-comparison-controls").getByText(
      "Phiên bản sau",
      { exact: true },
    ).waitFor();
    assert.deepEqual(
      await page.locator(".version-comparison-controls select").evaluateAll(
        (selects) => selects.map((select) => select.getAttribute("data-no-custom")),
      ),
      ["true", "true", "true"],
    );
    assert.equal(
      await page.locator(".version-comparison-controls").evaluate(
        (controls) => getComputedStyle(controls).display,
      ),
      "grid",
    );
    const controlBounds = await page.locator(".version-comparison-controls").boundingBox();
    const leftBounds = await page.locator('select[name="leftVersionId"]').boundingBox();
    const rightBounds = await page.locator('select[name="rightVersionId"]').boundingBox();
    assert.ok(controlBounds.width > 700);
    assert.ok(leftBounds.width > 160);
    assert.ok(rightBounds.width > 160);
    assert.deepEqual(
      await page.locator(".version-comparison-controls select").evaluateAll((selects) => (
        selects.map((select) => ({
          appearance: getComputedStyle(select).appearance,
          height: Math.round(select.getBoundingClientRect().height),
          radius: getComputedStyle(select).borderRadius,
        }))
      )),
      [
        { appearance: "none", height: 48, radius: "9px" },
        { appearance: "none", height: 48, radius: "9px" },
        { appearance: "none", height: 48, radius: "9px" },
      ],
    );
    assert.equal(await page.locator(".version-comparison-select-chevron").count(), 3);
    assert.deepEqual(
      await page.locator('select[name="leftVersionId"], select[name="rightVersionId"]').evaluateAll(
        (selects) => selects.map((select) => select.value),
      ),
      ["package-v1", "package-v2"],
    );
    assert.deepEqual(
      await page.locator('select[name="leftVersionId"], select[name="rightVersionId"]').evaluateAll(
        (selects) => selects.map((select) => select.selectedOptions[0]?.textContent.trim()),
      ),
      ["00", "01"],
    );
    await page.setViewportSize({ width: 390, height: 844 });
    assert.equal(
      (await page.locator(".version-comparison-pair-grid").evaluate(
        (grid) => getComputedStyle(grid).gridTemplateColumns,
      )).split(" ").length,
      1,
    );
    assert.ok((await page.locator(".version-comparison-submit").boundingBox()).width > 300);
    await page.setViewportSize({ width: 1024, height: 760 });
    await page.getByRole("tab", { name: "Trường dữ liệu" }).focus();
    await page.keyboard.press("ArrowRight");
    assert.equal(
      await page.getByRole("tab", { name: "Dữ liệu liên quan" }).getAttribute("aria-selected"),
      "true",
    );
    await page.getByRole("button", { name: "Tải trang tiếp theo" }).click();
    await page.getByText(/employee-b/).first().waitFor();
    assert.deepEqual(
      await page.evaluate(() => window.comparisonCalls[1].relationPage),
      { path: "assignments", cursor: "next-page", limit: 100 },
    );
    await page.getByRole("tab", { name: "Trường dữ liệu" }).click();
    await page.locator('select[name="changeFilter"]').selectOption("ADDED");
    await page.getByText("Không có thay đổi trường dữ liệu trong bộ lọc hiện tại.").waitFor();
    await page.locator('select[name="changeFilter"]').selectOption("MODIFIED");
    await page.getByText("Tên gói thầu").waitFor();
    const axe = await new AxeBuilder({ page }).include("#version-comparison-modal").analyze();
    assert.deepEqual(axe.violations, []);
    await page.getByRole("button", { name: "Đóng so sánh phiên bản" }).focus();
    await page.keyboard.press("Escape");
    await page.waitForFunction(() => !document.getElementById("version-comparison-modal"));
    assert.equal(await page.evaluate(() => document.activeElement?.id), "trigger");

    await page.evaluate(async () => {
      const { openVersionComparisonPanel } = await import(
        "/frontend/version-comparison/VersionComparisonPanel.js"
      );
      window.staleResolvers = [];
      openVersionComparisonPanel({
        versions: [
          { id: "package-v1", label: "00" },
          { id: "package-v2", label: "01" },
        ],
        selectedId: "package-v2",
        trigger: document.getElementById("trigger"),
        request: () => new Promise((resolve) => window.staleResolvers.push(resolve)),
        root: document,
      });
    });
    await page.waitForFunction(() => window.staleResolvers.length === 1);
    await page.locator('select[name="rightVersionId"]').selectOption("package-v1");
    assert.deepEqual(
      await page.locator('select[name="leftVersionId"], select[name="rightVersionId"]').evaluateAll(
        (selects) => selects.map((select) => select.value),
      ),
      ["package-v2", "package-v1"],
    );
    assert.deepEqual(
      await page.locator('select[name="leftVersionId"], select[name="rightVersionId"]').evaluateAll(
        (selects) => selects.map((select) => select.selectedOptions[0]?.textContent.trim()),
      ),
      ["01", "00"],
    );
    await page.locator("#version-comparison-modal").getByRole(
      "button",
      { name: "So sánh", exact: true },
    ).click();
    await page.waitForFunction(() => window.staleResolvers.length === 2);
    await page.evaluate(() => {
      const result = (value) => ({
        summary: { added: 0, removed: 0, modified: 1, unchanged: 0 },
        fields: [{ path: "tenGoiThau", change: "MODIFIED", oldValue: "A", newValue: value }],
        relations: [],
        impacts: [],
      });
      window.staleResolvers[1](result("newer-result"));
      window.staleResolvers[0](result("stale-result"));
    });
    await page.getByText("newer-result").waitFor({ state: "attached" });
    await page.waitForTimeout(20);
    assert.equal(await page.getByText("stale-result").count(), 0);
    await page.getByRole("button", { name: "Đóng so sánh phiên bản" }).focus();
    await page.keyboard.press("Escape");
  } finally {
    await browser?.close();
    await new Promise((resolve) => server.close(resolve));
  }
});
