import assert from "node:assert/strict";
import { createServer } from "node:http";
import { readFile } from "node:fs/promises";
import { extname, join } from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

import AxeBuilder from "@axe-core/playwright";
import { chromium } from "playwright";

const projectRoot = fileURLToPath(new URL("../..", import.meta.url));
const templates = [
  {
    filename: "Mẫu chính.docx",
    name: "Mẫu chính.docx",
    is_available: true,
    is_enabled: true,
  },
  {
    filename: "Mẫu tư vấn.docx",
    name: "Mẫu tư vấn.docx",
    is_available: true,
    is_enabled: true,
  },
  {
    filename: "Mẫu tạm ngừng.docx",
    name: "Mẫu tạm ngừng.docx",
    is_available: true,
    is_enabled: false,
  },
  ...Array.from({ length: 98 }, (_, index) => {
    const number = String(index + 3).padStart(3, "0");
    return {
      filename: `Mẫu ${number}.docx`,
      name: `Mẫu ${number}.docx`,
      is_available: true,
      is_enabled: true,
    };
  }),
];

function contentType(pathname) {
  if ([".js", ".mjs"].includes(extname(pathname))) return "text/javascript; charset=utf-8";
  if (extname(pathname) === ".css") return "text/css; charset=utf-8";
  if (extname(pathname) === ".woff2") return "font/woff2";
  return "application/octet-stream";
}

async function requestBody(request) {
  const chunks = [];
  for await (const chunk of request) chunks.push(chunk);
  return Buffer.concat(chunks).toString("utf8");
}

async function withAssignmentPage(run) {
  const saves = [];
  const server = createServer(async (request, response) => {
    try {
      const pathname = new URL(request.url, "http://127.0.0.1").pathname;
      if (pathname === "/") {
        response.writeHead(200, {
          "content-type": "text/html; charset=utf-8",
          "set-cookie": "csrf_token=test-token; Path=/; SameSite=Lax",
        });
        response.end(`<!doctype html><html lang="vi"><head><title>Cài đặt biểu mẫu</title>
          <link rel="stylesheet" href="/views/css/tokens.css">
          <link rel="stylesheet" href="/views/css/variables.css">
          <link rel="stylesheet" href="/views/css/base.css">
          <link rel="stylesheet" href="/views/css/components.css">
          <link rel="stylesheet" href="/frontend/documents/WordTemplateAssignments.css">
          <link rel="stylesheet" data-runtime-styles href="/views/css/runtime-styles.css">
        </head><body><main>
          <section class="dashboard-card word-template-assignment-card" aria-labelledby="assignment-heading">
            <div class="card-header"><h1 class="card-title" id="assignment-heading">Cài đặt biểu mẫu theo chức năng</h1></div>
            <div class="card-body">
              <div id="word-template-assignment-list" class="word-template-assignment-list"></div>
              <div class="word-template-assignment-footer">
                <p id="word-template-assignment-status" class="word-template-assignment-live-status" role="status" aria-live="polite"></p>
                <button type="button" class="btn btn-primary" id="word-template-assignment-save" disabled>Lưu cài đặt</button>
              </div>
            </div>
          </section>
        </main></body></html>`);
        return;
      }
      if (pathname === "/api/word-publication-template-assignments" && request.method === "PUT") {
        const payload = JSON.parse(await requestBody(request));
        saves.push(payload);
        const assignmentSets = payload.assignmentSets || {};
        response.writeHead(200, { "content-type": "application/json; charset=utf-8" });
        response.end(JSON.stringify({
          revision: payload.expectedRevision + 1,
          documentTypes: [],
          assignments: Object.fromEntries(
            Object.entries(assignmentSets).map(([id, filenames]) => [id, filenames[0]]),
          ),
          assignmentSets,
          resolvedTemplates: Object.fromEntries(
            Object.entries(assignmentSets).map(([id, filenames]) => (
              [id, { filename: filenames[0], source: "assignment" }]
            )),
          ),
          resolvedTemplateSets: Object.fromEntries(
            Object.entries(assignmentSets).map(([id, filenames]) => (
              [id, filenames.map((filename) => ({ filename, source: "assignment" }))]
            )),
          ),
          activeTemplate: "Mẫu chính.docx",
        }));
        return;
      }
      if (pathname === "/frontend/documents/WordTemplateAssignments.js") {
        const source = await readFile(join(projectRoot, pathname.replace(/^\//u, "")), "utf8");
        response.writeHead(200, { "content-type": contentType(pathname) });
        response.end(source);
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
    await run(page, saves);
  } finally {
    await context?.close();
    await browser?.close();
    await new Promise((resolve) => server.close(resolve));
  }
}

function configuration(assignmentSets = {}) {
  return {
    revision: 7,
    documentTypes: [],
    assignments: assignmentSets,
    assignmentSets,
    resolvedTemplates: {
      procurement_plan: { filename: "Mẫu chính.docx", source: "legacy-active" },
      ...Object.fromEntries(Object.entries(assignmentSets).map(([id, filenames]) => (
        [id, { filename: filenames[0], source: "assignment" }]
      ))),
    },
    resolvedTemplateSets: {
      procurement_plan: [{ filename: "Mẫu chính.docx", source: "legacy-active" }],
      ...Object.fromEntries(Object.entries(assignmentSets).map(([id, filenames]) => (
        [id, filenames.map((filename) => ({ filename, source: "assignment" }))]
      ))),
    },
    activeTemplate: "Mẫu chính.docx",
  };
}

test("manager assigns searchable Word templates by function and saves once", async () => {
  await withAssignmentPage(async (page, saves) => {
    await page.evaluate(async ({ templateFixtures, config }) => {
      const module = await import("/frontend/documents/WordTemplateAssignments.js");
      const controller = {
        model: {
          state: {
            activerole: "manager",
            activeuser: {
              activeOrganizationId: "org-a",
              organizations: [{
                id: "org-a",
                name: "Đơn vị A",
                scope_type: "organization",
                role: "manager",
                status: "active",
              }],
            },
          },
        },
        view: {
          showToast(title, message, type) {
            window.__assignmentToast = { title, message, type };
          },
          async customAlert() {},
          createIconsScoped() {},
        },
        _wordPublicationTemplates: templateFixtures,
      };
      window.__assignmentController = controller;
      module.renderWordTemplateAssignments(controller, templateFixtures, config);
      module.setupWordTemplateAssignmentEvents(controller);
    }, { templateFixtures: templates, config: configuration() });

    assert.equal(await page.locator('input[type="search"]').count(), 0);
    assert.equal(await page.locator(".word-template-assignment-picker-trigger").count(), 11);
    assert.equal(await page.locator('[data-document-type="package_full_profile"]').count(), 0);
    assert.equal(await page.locator('input[type="checkbox"]').count(), 0);
    assert.equal(await page.getByText("Mẫu tạm ngừng.docx", { exact: true }).count(), 0);
    const planRow = page.locator('[data-document-type="procurement_plan"]');
    assert.match(await planRow.textContent(), /Chưa cấu hình/u);
    assert.doesNotMatch(await planRow.textContent(), /Theo mẫu tương thích|Mẫu tương thích/u);
    assert.doesNotMatch(await planRow.textContent(), /Mẫu chính\.docx/u);
    const consultantRow = page.locator(
      '[data-document-type="consultant_evaluation_step_1"]',
    );
    await consultantRow.getByRole("button", { name: /Chọn biểu mẫu/u }).click();
    const picker = page.getByRole("dialog", {
      name: "Chọn biểu mẫu cho Tư vấn lập, đánh giá Bước 1",
    });
    assert.equal(await picker.isVisible(), true);
    assert.equal(await picker.locator('input[type="checkbox"]').count(), 20);
    assert.match(await picker.textContent(), /100 biểu mẫu/u);
    assert.match(await picker.textContent(), /Trang 1\/5/u);
    await picker.getByRole("button", { name: "Trang sau" }).click();
    assert.match(await picker.textContent(), /Trang 2\/5/u);

    const pickerSearch = picker.getByRole("searchbox", { name: "Tìm biểu mẫu Word" });
    await pickerSearch.fill("Mẫu 0");
    await picker.getByRole("button", { name: "Chọn tất cả kết quả" }).click();
    assert.match(await picker.textContent(), /Đã chọn \([1-9][0-9]\)/u);
    await picker.getByRole("button", { name: "Bỏ chọn kết quả" }).click();
    assert.match(await picker.textContent(), /Đã chọn \(0\)/u);
    await pickerSearch.fill("Mẫu chính");
    const mainTemplateCheckbox = picker.getByRole("checkbox", { name: "Mẫu chính.docx" });
    await mainTemplateCheckbox.check();
    assert.equal(await mainTemplateCheckbox.evaluate((element) => (
      document.activeElement === element
    )), true);
    await pickerSearch.fill("Mẫu tư vấn");
    await picker.getByRole("checkbox", { name: "Mẫu tư vấn.docx" }).check();
    await picker.getByRole("button", { name: "Áp dụng" }).click();
    assert.equal(await picker.isHidden(), true);
    assert.match(await consultantRow.textContent(), /Mẫu chính\.docx/u);
    assert.match(await consultantRow.textContent(), /Mẫu tư vấn\.docx/u);
    const saveButton = page.getByRole("button", { name: "Lưu cài đặt" });
    assert.equal(await saveButton.isEnabled(), true);
    await saveButton.click();
    await page.waitForFunction(() => Boolean(window.__assignmentToast));

    assert.equal(saves.length, 1);
    assert.deepEqual(saves[0], {
      expectedRevision: 7,
      assignmentSets: {
        consultant_evaluation_step_1: ["Mẫu chính.docx", "Mẫu tư vấn.docx"],
      },
    });
    assert.deepEqual(
      await page.evaluate(() => window.__assignmentToast),
      {
        title: "Đã lưu cài đặt",
        message: "Biểu mẫu Word đã được gán cho các chức năng đã chọn.",
        type: "success",
      },
    );

    const axe = await new AxeBuilder({ page }).include(".word-template-assignment-card").analyze();
    assert.deepEqual(axe.violations, []);

    await page.setViewportSize({ width: 320, height: 800 });
    await page.waitForFunction(() => {
      const save = document.querySelector("#word-template-assignment-save");
      return window.matchMedia("(max-width: 560px)").matches
        && save
        && Number.parseFloat(getComputedStyle(save).minHeight) >= 44
        && save.getBoundingClientRect().height >= 44;
    });
    const mobile = await page.locator(".word-template-assignment-card").evaluate((root) => ({
      overflow: document.documentElement.scrollWidth > document.documentElement.clientWidth,
      columns: getComputedStyle(root.querySelector(".word-template-assignment-row")).gridTemplateColumns,
      saveHeight: root.querySelector("#word-template-assignment-save").getBoundingClientRect().height,
      rowHeight: root.querySelector(".word-template-assignment-row").getBoundingClientRect().height,
    }));
    assert.equal(mobile.overflow, false);
    assert.equal(mobile.columns.split(" ").length, 1);
    assert.ok(mobile.saveHeight >= 44);
    assert.ok(mobile.rowHeight < 240);

    await consultantRow.getByRole("button", { name: /Chọn biểu mẫu/u }).click();
    const mobileDialog = await picker.evaluate((element) => ({
      width: element.getBoundingClientRect().width,
      viewportWidth: window.innerWidth,
      overflow: document.documentElement.scrollWidth > document.documentElement.clientWidth,
    }));
    assert.ok(mobileDialog.width <= mobileDialog.viewportWidth);
    assert.equal(mobileDialog.overflow, false);
    const dialogAxe = await new AxeBuilder({ page }).include(
      ".word-template-assignment-dialog",
    ).analyze();
    assert.deepEqual(dialogAxe.violations, []);
  });
});

test("employee sees the same assignments without mutation controls", async () => {
  await withAssignmentPage(async (page) => {
    await page.evaluate(async ({ templateFixtures, config }) => {
      const { renderWordTemplateAssignments } = await import(
        "/frontend/documents/WordTemplateAssignments.js"
      );
      renderWordTemplateAssignments({
        model: {
          state: {
            activerole: "employee",
            activeuser: {
              activeOrganizationId: "org-a",
              organizations: [{
                id: "org-a",
                name: "Đơn vị A",
                scope_type: "organization",
                role: "employee",
                status: "active",
              }],
            },
          },
        },
        view: { createIconsScoped() {} },
      }, templateFixtures, config);
    }, {
      templateFixtures: templates,
      config: configuration({
        consultant_evaluation_step_1: ["Mẫu chính.docx", "Mẫu tư vấn.docx"],
      }),
    });

    assert.equal(await page.locator('input[type="search"]').count(), 0);
    const assignedRow = page.locator(
      '[data-document-type="consultant_evaluation_step_1"]',
    );
    assert.match(await assignedRow.textContent(), /Mẫu chính\.docx/u);
    assert.match(await assignedRow.textContent(), /Mẫu tư vấn\.docx/u);
    await assignedRow.getByRole("button", { name: /Xem biểu mẫu/u }).click();
    const picker = page.getByRole("dialog", {
      name: "Xem biểu mẫu của Tư vấn lập, đánh giá Bước 1",
    });
    assert.equal(await picker.getByRole("checkbox", { checked: true }).count(), 2);
    assert.equal(await picker.locator('input[type="checkbox"]:not(:disabled)').count(), 0);
    assert.equal(await page.getByRole("button", { name: "Lưu cài đặt" }).isHidden(), true);
    assert.match(
      await page.locator("#word-template-assignment-status").textContent(),
      /chỉ đọc/u,
    );
  });
});
