import assert from "node:assert/strict";
import { createServer } from "node:http";
import { readFile } from "node:fs/promises";
import { extname, join } from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

import AxeBuilder from "@axe-core/playwright";
import { chromium } from "playwright";

const projectRoot = fileURLToPath(new URL("../..", import.meta.url));
const plans = [
  { id: "plan-a", maKeHoach: "KH-01", tenKeHoach: "Kế hoạch mua sắm năm 2026" },
  { id: "plan-b", maKeHoach: "KH-02", tenKeHoach: "Kế hoạch xây lắp năm 2026" },
];
const packages = [
  {
    id: "package-a1",
    keHoachId: "plan-a",
    maGoiThau: "Gói 01",
    tenGoiThau: "Mua sắm máy chủ",
    phuongThucLuaChon: "Một giai đoạn một túi hồ sơ",
    hinhThucLuaChon: "Đấu thầu rộng rãi",
  },
  {
    id: "package-a2",
    keHoachId: "plan-a",
    maGoiThau: "Gói 02",
    tenGoiThau: "Mua sắm trực tiếp",
    phuongThucLuaChon: "Một giai đoạn một túi hồ sơ",
    hinhThucLuaChon: "Chỉ định thầu rút gọn",
  },
  {
    id: "package-b1",
    keHoachId: "plan-b",
    maGoiThau: "Gói 03",
    tenGoiThau: "Xây lắp trụ sở",
    phuongThucLuaChon: "Một giai đoạn hai túi hồ sơ",
    hinhThucLuaChon: "Đấu thầu rộng rãi",
  },
];

function contentType(pathname) {
  if ([".js", ".mjs"].includes(extname(pathname))) return "text/javascript; charset=utf-8";
  if (extname(pathname) === ".css") return "text/css; charset=utf-8";
  if (extname(pathname) === ".woff2") return "font/woff2";
  return "application/octet-stream";
}

async function withPublicationPage(run) {
  const pageMarkup = await readFile(join(projectRoot, "views/tabs/tab_xuatban_word.html"), "utf8");
  const exportRequests = [];
  const server = createServer(async (request, response) => {
    try {
      const pathname = new URL(request.url, "http://127.0.0.1").pathname;
      if (pathname === "/") {
        response.writeHead(200, { "content-type": "text/html; charset=utf-8" });
        response.end(`<!doctype html><html lang="vi"><head><title>Xuất bản Word</title>
          <link rel="stylesheet" href="/views/css/tokens.css">
          <link rel="stylesheet" href="/views/css/variables.css">
          <link rel="stylesheet" href="/views/css/base.css">
          <link rel="stylesheet" href="/views/css/components.css">
          <link rel="stylesheet" href="/views/css/views.css">
          <link rel="stylesheet" href="/views/css/ui-redesign.css">
          <link rel="stylesheet" href="/frontend/documents/WordPublication.css">
          <link rel="stylesheet" data-runtime-styles href="/views/css/runtime-styles.css">
        </head><body><main>${pageMarkup}</main></body></html>`);
        return;
      }
      if (pathname === "/api/word-publication-template-assignments") {
        response.writeHead(200, { "content-type": "application/json; charset=utf-8" });
        response.end(JSON.stringify({
          documentTypes: [],
          assignments: {},
          resolvedTemplates: {
            procurement_plan: { filename: "mau-chinh.docx", source: "legacy-active" },
            bid_evaluation_report: { filename: "mau-chinh.docx", source: "legacy-active" },
            contractor_selection_result: { filename: "mau-chinh.docx", source: "legacy-active" },
          },
          resolvedTemplateSets: {
            procurement_plan: [{ filename: "mau-chinh.docx", source: "legacy-active" }],
            bid_evaluation_report: [
              { filename: "bao-cao.docx", source: "assignment" },
              { filename: "quyet-dinh.docx", source: "assignment" },
            ],
            contractor_selection_result: [{
              filename: "mau-chinh.docx",
              source: "legacy-active",
            }],
          },
          activeTemplate: "mau-chinh.docx",
        }));
        return;
      }
      if (pathname.startsWith("/api/export-")) {
        exportRequests.push(request.url);
        await new Promise((resolve) => setTimeout(resolve, 120));
        if (pathname.includes("package-a2")) {
          response.writeHead(500, { "content-type": "application/json; charset=utf-8" });
          response.end(JSON.stringify({ error: "Mẫu kết quả tạm thời không khả dụng" }));
          return;
        }
        response.writeHead(200, {
          "content-type": "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
        });
        response.end(Buffer.from("PK\u0003\u0004word-publication-test"));
        return;
      }
      if (pathname === "/frontend/documents/WordPublication.js") {
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
    context = await browser.newContext({ acceptDownloads: true });
    const page = await context.newPage();
    await page.goto(`http://127.0.0.1:${server.address().port}/`);
    await page.evaluate(async ({ planFixtures, packageFixtures }) => {
      const { setupWordPublicationPage } = await import("/frontend/documents/WordPublication.js");
      const controller = {
        model: {
          state: { activeuser: { wordExportEnabled: true } },
          getFilteredKeHoach: () => planFixtures,
          getFilteredGoiThau: () => packageFixtures,
        },
        view: {
          createIconsScoped() {},
          showToast(title, message, type) {
            window.__publicationToasts.push({ title, message, type });
          },
          async customAlert(title, message, icon) {
            window.__publicationAlerts.push({ title, message, icon });
          },
        },
        async prepareExportSnapshot() {
          return 41;
        },
      };
      window.__publicationToasts = [];
      window.__publicationAlerts = [];
      window.__publicationController = controller;
      document.getElementById("tab-xuatban-word").classList.add("active");
      await setupWordPublicationPage.call(controller);
    }, { planFixtures: plans, packageFixtures: packages });
    await run(page, exportRequests);
  } finally {
    await context?.close();
    await browser?.close();
    await new Promise((resolve) => server.close(resolve));
  }
}

async function choose(page, accessibleName, query) {
  const combobox = page.getByRole("combobox", { name: accessibleName });
  await combobox.fill(query);
  await combobox.press("ArrowDown");
  await combobox.press("Enter");
}

test("dependent searchable selectors reset stale package and recalculate documents", async () => {
  await withPublicationPage(async (page) => {
    const planCombobox = page.getByRole("combobox", { name: "Kế hoạch lựa chọn nhà thầu" });
    const packageCombobox = page.getByRole("combobox", { name: "Gói thầu" });
    assert.equal(await planCombobox.isEnabled(), true);
    assert.equal(await packageCombobox.isDisabled(), true);
    assert.equal(await page.locator("#word-publication-documents").isHidden(), true);

    await planCombobox.fill("kh-01");
    const planListbox = page.locator(`#${await planCombobox.getAttribute("aria-controls")}`);
    assert.equal(await planListbox.locator('[role="option"]:not([aria-disabled="true"])').count(), 1);
    await planCombobox.press("ArrowDown");
    await planCombobox.press("Enter");
    assert.equal(await packageCombobox.isEnabled(), true);
    assert.deepEqual(
      await page.locator("#word-publication-package-select option").evaluateAll((options) => (
        options.map((option) => option.value).filter(Boolean)
      )),
      ["package-a1", "package-a2"],
    );

    await choose(page, "Gói thầu", "may chu");
    assert.equal(await page.locator('[data-document-id="bid_evaluation_report"]').count(), 1);
    assert.equal(await page.locator('[data-document-id^="technical_bid_evaluation_report_"]').count(), 0);
    assert.equal(await page.locator("#word-publication-package-code").textContent(), "Gói 01");

    await choose(page, "Kế hoạch lựa chọn nhà thầu", "kh-02");
    assert.equal(await page.locator("#word-publication-package-select").inputValue(), "");
    assert.equal(await page.locator("#word-publication-documents").isHidden(), true);
    assert.deepEqual(
      await page.locator("#word-publication-package-select option").evaluateAll((options) => (
        options.map((option) => option.value).filter(Boolean)
      )),
      ["package-b1"],
    );

    await choose(page, "Gói thầu", "xay lap");
    const technicalCards = page.locator('[data-document-id^="technical_bid_evaluation_report_"]');
    assert.equal(await technicalCards.count(), 3);
    assert.deepEqual(
      await technicalCards.evaluateAll((cards) => cards.map((card) => card.dataset.documentId)),
      [
        "technical_bid_evaluation_report_01",
        "technical_bid_evaluation_report_02",
        "technical_bid_evaluation_report_03",
      ],
    );
    assert.equal(await page.locator('[data-document-id="bid_evaluation_report"]').count(), 0);

    const axe = await new AxeBuilder({ page }).include("#tab-xuatban-word").analyze();
    assert.deepEqual(axe.violations, []);

    await page.setViewportSize({ width: 320, height: 800 });
    const mobileLayout = await page.locator("#tab-xuatban-word").evaluate((root) => ({
      viewportOverflow: document.documentElement.scrollWidth > document.documentElement.clientWidth,
      gridColumns: getComputedStyle(root.querySelector(".word-publication-document-grid")).gridTemplateColumns,
      exportButtonHeight: root.querySelector(".word-publication-document-actions .btn").getBoundingClientRect().height,
    }));
    assert.equal(mobileLayout.viewportOverflow, false);
    assert.equal(mobileLayout.gridColumns.split(" ").length, 1);
    assert.ok(mobileLayout.exportButtonHeight >= 44);

    await planCombobox.click();
    const mobileListbox = page.locator(`#${await planCombobox.getAttribute("aria-controls")}`);
    const popupBounds = await mobileListbox.evaluate((listbox) => {
      const bounds = listbox.getBoundingClientRect();
      return { left: bounds.left, right: bounds.right, viewportWidth: window.innerWidth };
    });
    assert.ok(popupBounds.left >= 0);
    assert.ok(popupBounds.right <= popupBounds.viewportWidth);
  });
});

test("Word export opens a multi-file selection table before sending the request", async () => {
  await withPublicationPage(async (page, exportRequests) => {
    await choose(page, "Kế hoạch lựa chọn nhà thầu", "kh-01");
    await choose(page, "Gói thầu", "may chu");

    const evaluationButton = page.locator('[data-word-publication-export="bid_evaluation_report"]');
    assert.match(await evaluationButton.textContent(), /Xuất Word/u);
    assert.match(
      await page.locator('[data-document-id="bid_evaluation_report"]').textContent(),
      /2 biểu mẫu sẵn sàng/u,
    );
    await evaluationButton.click();
    const dialog = page.getByRole("dialog", { name: "Chọn file cần xuất" });
    assert.equal(await dialog.isVisible(), true);
    assert.equal(exportRequests.length, 0);
    assert.deepEqual(
      await dialog.locator('[data-word-publication-template-row]').evaluateAll((rows) => (
        rows.map((row) => row.dataset.filename)
      )),
      ["bao-cao.docx", "quyet-dinh.docx"],
    );
    const templateCheckboxes = dialog.locator('[name="word-publication-template"]');
    assert.equal(await templateCheckboxes.count(), 2);
    assert.deepEqual(await templateCheckboxes.evaluateAll((items) => (
      items.map((item) => item.checked)
    )), [true, true]);

    const confirmButton = dialog.locator('[data-word-publication-confirm]');
    assert.match(await confirmButton.textContent(), /Xuất 2 file/u);
    await templateCheckboxes.nth(0).uncheck();
    await templateCheckboxes.nth(1).uncheck();
    assert.equal(await confirmButton.isDisabled(), true);
    await dialog.getByRole("checkbox", { name: "Chọn tất cả" }).check();
    assert.equal(await confirmButton.isEnabled(), true);

    const axe = await new AxeBuilder({ page }).include("#word-publication-export-dialog").analyze();
    assert.deepEqual(axe.violations, []);
    await page.setViewportSize({ width: 320, height: 800 });
    const dialogLayout = await dialog.evaluate((element) => ({
      viewportOverflow: document.documentElement.scrollWidth > document.documentElement.clientWidth,
      dialogWidth: element.getBoundingClientRect().width,
      viewportWidth: window.innerWidth,
    }));
    assert.equal(dialogLayout.viewportOverflow, false);
    assert.ok(dialogLayout.dialogWidth <= dialogLayout.viewportWidth);

    await dialog.press("Escape");
    assert.equal(await dialog.isHidden(), true);
    assert.equal(await evaluationButton.evaluate((button) => document.activeElement === button), true);
    assert.equal(exportRequests.length, 0);

    await evaluationButton.click();
    const evaluationRequest = page.waitForRequest((request) => {
      const url = new URL(request.url());
      return url.pathname === "/api/export-report/package-a1"
        && url.searchParams.get("type") === "evaluation"
        && url.searchParams.get("publicationType") === "bid_evaluation_report"
        && url.searchParams.get("snapshotVersion") === "41"
        && JSON.stringify(url.searchParams.getAll("templateFilename"))
          === JSON.stringify(["bao-cao.docx", "quyet-dinh.docx"]);
    });
    const evaluationDownload = page.waitForEvent("download");
    await dialog.locator('[data-word-publication-confirm]').click();
    await evaluationRequest;
    assert.equal(await evaluationButton.isDisabled(), true);
    await evaluationButton.evaluate((button) => button.click());
    assert.match((await evaluationDownload).suggestedFilename(), /\.zip$/u);
    await page.waitForFunction(() => window.__publicationToasts.length === 1);
    assert.equal(exportRequests.filter((url) => url.includes("package-a1")).length, 1);
    assert.equal(await evaluationButton.isEnabled(), true);
    assert.deepEqual(
      await page.evaluate(() => window.__publicationToasts[0]),
      {
        title: "Đã xuất Word",
        message: "2 tài liệu “Báo cáo đánh giá E-HSDT” đã được tạo từ dữ liệu mới nhất.",
        type: "success",
      },
    );

    const unavailable = page.locator('[data-word-publication-export="consultant_evaluation_step_1"]');
    assert.equal(await unavailable.isDisabled(), true);
    assert.match(await unavailable.getAttribute("title"), /chọn biểu mẫu phù hợp/u);

    await choose(page, "Gói thầu", "truc tiep");
    assert.deepEqual(
      await page.locator("[data-document-id]").evaluateAll((cards) => (
        cards.map((card) => card.dataset.documentId)
      )),
      ["procurement_plan", "contractor_selection_result"],
    );
    const resultButton = page.locator('[data-word-publication-export="contractor_selection_result"]');
    await resultButton.click();
    await page.locator('[data-word-publication-confirm]').click();
    await page.waitForFunction(() => window.__publicationAlerts.length === 1);
    assert.equal(exportRequests.filter((url) => url.includes("package-a2")).length, 1);
    assert.deepEqual(
      await page.evaluate(() => window.__publicationAlerts[0]),
      {
        title: "Không thể xuất Word",
        message: "Mẫu kết quả tạm thời không khả dụng",
        icon: "x-circle",
      },
    );
  });
});

test("Word export can render one selected assigned file as DOCX", async () => {
  await withPublicationPage(async (page, exportRequests) => {
    await choose(page, "Kế hoạch lựa chọn nhà thầu", "kh-01");
    await choose(page, "Gói thầu", "may chu");

    const evaluationButton = page.locator('[data-word-publication-export="bid_evaluation_report"]');
    await evaluationButton.click();
    const dialog = page.getByRole("dialog", { name: "Chọn file cần xuất" });
    const templateCheckboxes = dialog.locator('[name="word-publication-template"]');
    await templateCheckboxes.nth(1).uncheck();
    assert.match(
      await dialog.locator('[data-word-publication-confirm]').textContent(),
      /Xuất 1 file/u,
    );

    const requestPromise = page.waitForRequest((request) => {
      const url = new URL(request.url());
      return JSON.stringify(url.searchParams.getAll("templateFilename"))
        === JSON.stringify(["bao-cao.docx"]);
    });
    const downloadPromise = page.waitForEvent("download");
    await dialog.locator('[data-word-publication-confirm]').click();
    await requestPromise;
    assert.match((await downloadPromise).suggestedFilename(), /\.docx$/u);
    assert.equal(exportRequests.length, 1);
    await page.waitForFunction(() => window.__publicationToasts.length === 1);
    assert.deepEqual(
      await page.evaluate(() => window.__publicationToasts[0]),
      {
        title: "Đã xuất Word",
        message: "Tài liệu “Báo cáo đánh giá E-HSDT” đã được tạo từ dữ liệu mới nhất.",
        type: "success",
      },
    );
  });
});

test("publication navigation applies the active state and canonical route", async () => {
  await withPublicationPage(async (page) => {
    const state = await page.evaluate(async () => {
      const { switchTab } = await import("/frontend/app/BiddingControllerUI.js");
      const oldButton = document.createElement("button");
      oldButton.className = "nav-btn active";
      oldButton.dataset.tab = "bieumau";
      const publicationButton = document.createElement("button");
      publicationButton.className = "nav-btn";
      publicationButton.dataset.tab = "xuatban-word";
      document.body.prepend(oldButton, publicationButton);
      const oldPane = document.createElement("section");
      oldPane.id = "tab-bieumau";
      oldPane.className = "tab-pane active";
      document.querySelector("main").prepend(oldPane);
      const pageTitle = document.createElement("h1");
      document.body.prepend(pageTitle);

      const controller = window.__publicationController;
      controller.model.state.activetab = "bieumau";
      controller.model.state.activeaction = null;
      controller.model.hasActiveEffectiveRole = () => false;
      controller.routeMap = {
        bieumau: "bieu-mau",
        "xuatban-word": "xuat-ban-word",
      };
      controller.actionMap = {};
      controller._workflowModulesReady = true;
      controller.lazyTabPartials = {};
      controller.renderTabData = () => null;
      controller.view.areViewModulesReady = () => true;
      controller.view.elements = {
        navButtons: document.querySelectorAll(".nav-btn"),
        tabPanes: document.querySelectorAll(".tab-pane"),
        pageTitle,
      };
      switchTab.call(controller, "xuatban-word", null, true);
      return {
        path: location.pathname,
        title: pageTitle.textContent,
        oldButtonActive: oldButton.classList.contains("active"),
        publicationButtonActive: publicationButton.classList.contains("active"),
        oldPaneActive: oldPane.classList.contains("active"),
        publicationPaneActive: document.getElementById("tab-xuatban-word").classList.contains("active"),
      };
    });

    assert.deepEqual(state, {
      path: "/xuat-ban-word",
      title: "Xuất bản Word",
      oldButtonActive: false,
      publicationButtonActive: true,
      oldPaneActive: false,
      publicationPaneActive: true,
    });
  });
});

test("Word entitlement gates only export actions and does not hide readable record data", async () => {
  await withPublicationPage(async (page) => {
    await choose(page, "Kế hoạch lựa chọn nhà thầu", "kh-01");
    await choose(page, "Gói thầu", "may chu");
    await page.evaluate(async () => {
      const { setupWordPublicationPage } = await import("/frontend/documents/WordPublication.js");
      window.__publicationController.model.state.activeuser.wordExportEnabled = false;
      await setupWordPublicationPage.call(window.__publicationController);
    });

    assert.equal(await page.locator("#word-publication-summary").isVisible(), true);
    assert.equal(await page.locator("#word-publication-package-name").textContent(), "Mua sắm máy chủ");
    assert.equal(await page.locator('[data-document-id="bid_evaluation_report"]').isVisible(), true);
    const evaluationButton = page.locator('[data-word-publication-export="bid_evaluation_report"]');
    assert.equal(await evaluationButton.isDisabled(), true);
    assert.equal(await evaluationButton.getAttribute("title"), "Phạm vi đang làm việc chưa có quyền xuất Word.");
  });
});
