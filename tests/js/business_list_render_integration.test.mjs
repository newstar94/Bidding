import assert from "node:assert/strict";
import { createServer } from "node:http";
import { readFile } from "node:fs/promises";
import { extname, resolve, sep } from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";
import { chromium } from "playwright";

const projectRoot = resolve(fileURLToPath(new URL("../..", import.meta.url)));
const types = ["kehoach", "goithau", "hopdong"];

test("three business list renderers apply filters and keep checkboxes aligned with displayed versions", async () => {
  const templates = await Promise.all(types.map((type) => readFile(resolve(projectRoot, `views/tabs/tab_${type}.html`), "utf8")));
  const server = createServer(async (request, response) => {
    try {
      const pathname = new URL(request.url, "http://127.0.0.1").pathname;
      if (pathname === "/") {
        response.writeHead(200, { "content-type": "text/html; charset=utf-8" });
        response.end(`<!doctype html><html lang="vi"><head><title>Business lists</title>
          <link rel="stylesheet" href="/views/css/tokens.css">
          <link rel="stylesheet" href="/views/css/variables.css">
          <link rel="stylesheet" href="/views/css/base.css">
          <link rel="stylesheet" href="/views/css/components.css">
          <link rel="stylesheet" href="/views/css/views.css">
          <link rel="stylesheet" href="/views/css/generated-static-styles.css">
          <link rel="stylesheet" href="/views/css/ui-redesign.css">
          <link rel="stylesheet" data-runtime-styles href="/views/css/runtime-styles.css">
        </head><body><div class="main-content"><main class="content-viewport">${templates.join("")}</main></div></body></html>`);
        return;
      }
      const path = resolve(projectRoot, `.${pathname}`);
      if (!path.startsWith(`${projectRoot}${sep}`)) throw new Error("Invalid fixture path");
      const contentType = [".js", ".mjs"].includes(extname(path))
        ? "text/javascript; charset=utf-8"
        : extname(path) === ".css" ? "text/css; charset=utf-8" : "text/plain; charset=utf-8";
      const content = await readFile(path);
      response.writeHead(200, { "content-type": contentType });
      response.end(content);
    } catch {
      response.writeHead(404);
      response.end();
    }
  });
  await new Promise((done) => server.listen(0, "127.0.0.1", done));
  const browser = await chromium.launch({ headless: true });
  try {
    const page = await browser.newPage();
    const errors = [];
    page.on("pageerror", (error) => errors.push(error.message));
    await page.goto(`http://127.0.0.1:${server.address().port}/`);
    await page.evaluate(async () => {
      const [{ BiddingView }, plans, packages, contracts, filters, selection] = await Promise.all([
        import("/frontend/app/BiddingView.js"),
        import("/frontend/plans/KeHoachView.js"),
        import("/frontend/packages/GoiThauTable.js"),
        import("/frontend/contracts/HopDongComponent.js"),
        import("/frontend/shared/BusinessListFilters.js"),
        import("/frontend/shared/BusinessListSelection.js"),
      ]);
      window.lucide = { createIcons() {} };
      const versions = (type, fields) => [
        { id: `${type}-new`, rootId: `${type}-root`, phienBan: "01", isLatest: 1, ...fields("A", "2000000") },
        { id: `${type}-other`, rootId: `${type}-other`, phienBan: "00", isLatest: 1, ...fields("B", "500000") },
        { id: `${type}-old`, rootId: `${type}-root`, phienBan: "00", isLatest: 0, ...fields("A cũ", "1000000") },
      ];
      const state = {
        kehoach: versions("kehoach", (name, price) => ({
          maKeHoach: `KH-${name}`, tenKeHoach: name, tongMucDauTu: price,
          chuDauTuId: name === "B" ? "investor-b" : "investor-a", ngayPheDuyet: name === "B" ? "2026-10-31" : "2026-10-01",
        })),
        goithau: versions("goithau", (name, price) => ({
          maGoiThau: `GT-${name}`, tenGoiThau: name, giaGoiThau: price, ngayQuyetDinh: "2026-10-01",
          trangThai: name === "B" ? "Đang mời thầu" : "Chuẩn bị", keHoachId: name === "B" ? "kehoach-other" : "kehoach-new",
          hinhThucLuaChon: name === "B" ? "Chào hàng cạnh tranh" : "Đấu thầu rộng rãi", linhVuc: name === "B" ? "Xây lắp" : "Hàng hóa",
          phuongThucLuaChon: name === "B" ? "Một giai đoạn hai túi hồ sơ" : "Một giai đoạn một túi hồ sơ",
          loaiHopDong: name === "B" ? "Theo đơn giá cố định" : "Trọn gói", phanLo: name === "B" ? "Không" : "Có",
          isThuoc: name === "B" ? 0 : 1, tuyChonMuaThem: name === "B" ? "Không" : "Có",
          thoiGianDangTai: name === "B" ? "2026-10-31T23:59:59+07:00" : "2026-10-01T00:00:00+07:00",
        })),
        hopdong: versions("hopdong", (name, price) => ({
          soHopDong: `HD-${name}`, tenHopDong: name, giaTri: price,
          chuDauTuId: name === "B" ? "investor-b" : "investor-a", nhaThauId: name === "B" ? "contractor-b" : "contractor-a",
          keHoachId: name === "B" ? "kehoach-other" : "kehoach-new", goiThauIds: [name === "B" ? "goithau-other" : "goithau-new"],
          trangThaiHopDong: name === "B" ? "Hoàn thành" : "Đang thực hiện", ngayKy: name === "B" ? "2026-10-31" : "2026-10-01",
        })),
        chudautu: [
          { id: "investor-a", maChuDauTu: "CDT-A", tenChuDauTu: "Chủ đầu tư A" },
          { id: "investor-b", maChuDauTu: "CDT-B", tenChuDauTu: "Chủ đầu tư B" },
          { id: "investor-c", maChuDauTu: "CDT-C", tenChuDauTu: "Chủ đầu tư C" },
        ], nhathau: [
          { id: "contractor-a", maNhaThau: "NT-A", tenNhaThau: "Nhà thầu A" },
          { id: "contractor-b", maNhaThau: "NT-B", tenNhaThau: "Nhà thầu B" },
          { id: "contractor-c", maNhaThau: "NT-C", tenNhaThau: "Nhà thầu C" },
        ], thongtinmothau: [], assignments: [
          { id: "assignment-a", type: "hopdong", targetId: "hopdong-new", empId: "employee-a" },
          { id: "assignment-b", type: "hopdong", targetId: "hopdong-other", empId: "employee-b" },
        ], employees: [{ id: "employee-a", name: "Nhân sự A" }, { id: "employee-b", name: "Nhân sự B" }, { id: "employee-c", name: "Nhân sự C" }],
        customcontractstatuses: [{ name: "Đang thực hiện", color: "#334155" }, { name: "Hoàn thành", color: "#15803d" }, { name: "Tạm dừng", color: "#a16207" }],
        activeuser: { id: "user", wordExportEnabled: true }, activerole: "admin",
        selectedPlanVersion: { "kehoach-root": "kehoach-old" },
        selectedPackageVersion: { "goithau-root": "goithau-old" },
        selectedPackageVersionIntent: { "goithau-root": "historical" },
        selectedHopDongVersion: { "hopdong-root": "hopdong-old" },
      };
      const model = {
        state, useServerSidePagination: false, pageSize: 10,
        currentPage: { kehoach: 1, goithau: 1, hopdong: 1 },
        sortState: { kehoach: {}, goithau: {}, hopdong: {} },
        getFilteredKeHoach: () => state.kehoach.filter((row) => row.isLatest === 1),
        getFilteredGoiThau: () => state.goithau.filter((row) => row.isLatest === 1),
        getLatestPackages: () => state.goithau.filter((row) => row.isLatest === 1),
        getLatestHopDong: () => state.hopdong.filter((row) => row.isLatest === 1),
        getLatestPlan: () => state.kehoach[0],
        getPlanBaseCode: (value) => value, getPackageBaseCode: (value) => value,
        formatCurrency: (value) => `${value} ₫`, savePage() {},
      };
      const view = new BiddingView(model);
      view.renderKeHoachTable = plans.renderKeHoachTable.bind(view);
      view.renderGoiThauTable = packages.renderGoiThauTable.bind(view);
      view.renderHopDongTable = contracts.renderHopDongTable.bind(view);
      view.showToast = () => {};
      window.listFixture = { model, view, filters, selection };
    });
    const fields = {
      kehoach: { name: "chuDauTuId", amount: "ngayPheDuyet", render: "renderKeHoachTable", columns: 11 },
      goithau: { name: "keHoachId", amount: "thoiGianDangTai", render: "renderGoiThauTable", columns: 9 },
      hopdong: { name: "chuDauTuId", amount: "ngayKy", render: "renderHopDongTable", columns: 12 },
    };
    for (const type of types) {
      const definition = fields[type];
      await page.evaluate(async ({ type, render }) => {
        document.querySelectorAll(".tab-pane").forEach((pane) => pane.classList.toggle("active", pane.id === `tab-${type}`));
        await window.listFixture.view[render]();
      }, { type, render: definition.render });
      assert.equal(await page.locator(`#${type}-table tbody input[type="checkbox"]`).count(), 2);
      assert.equal(await page.locator(`#${type}-table thead th`).count(), definition.columns);
      assert.equal(await page.locator(`#${type}-table tbody tr`).first().locator("td").count(), definition.columns);
      assert.equal(await page.locator(`#${type}-table thead [data-list-select-page="${type}"]`).count(), 1, "header sorting must preserve the checkbox");
      const modal = page.locator(`#${type}-filter-panel`);
      const trigger = page.locator(`[data-list-filter='${type}']`);
      await page.locator(`#tab-${type}`).evaluate(async (pane) => {
        await Promise.all(pane.getAnimations().map((animation) => animation.finished.catch(() => {})));
      });
      const tableBounds = await page.locator(`#${type}-table`).boundingBox();
      await trigger.click();
      assert.equal(await modal.evaluate((dialog) => dialog instanceof HTMLDialogElement && dialog.open && dialog.matches(":modal")), true);
      assert.equal(await modal.getAttribute("aria-modal"), "true");
      assert.equal(await modal.evaluate((dialog) => dialog.contains(document.activeElement)), true);
      if (type === "kehoach") {
        assert.deepEqual(await modal.locator("[data-filter-field]").evaluateAll((inputs) => inputs.map((input) => input.value)), ["chuDauTuId:value", "ngayPheDuyet:value"], "plan filters expose exactly investor and approval date range");
        assert.deepEqual(await modal.locator(".business-filter-field-list label span").allTextContents(), ["Chủ đầu tư", "Thời gian phê duyệt kế hoạch"]);
      }
      if (type === "hopdong") {
        assert.deepEqual(await modal.locator("[data-filter-field]").evaluateAll((inputs) => inputs.map((input) => input.value)), ["chuDauTuId:value", "nhaThauId:value", "keHoachId:value", "goiThauIds:value", "assigneeId:value", "trangThaiHopDong:value", "ngayKy:value"], "contract filters expose exactly the seven requested fields");
        assert.deepEqual(await modal.locator(".business-filter-field-list label span").allTextContents(), ["Chủ đầu tư", "Nhà thầu", "Kế hoạch", "Gói thầu", "Người phụ trách", "Trạng thái", "Ngày ký"]);
      }
      if (type === "goithau") {
        assert.deepEqual(await modal.locator("[data-filter-field]").evaluateAll((inputs) => inputs.map((input) => input.value)), ["keHoachId:value", "trangThai:value", "hinhThucLuaChon:value", "linhVuc:value", "phuongThucLuaChon:value", "loaiHopDong:value", "phanLo:value", "isThuoc:value", "tuyChonMuaThem:value", "thoiGianDangTai:value"], "package filters expose exactly the ten requested fields");
        assert.deepEqual(await modal.locator(".business-filter-field-list label span").allTextContents(), ["Kế hoạch", "Trạng thái", "Hình thức lựa chọn", "Lĩnh vực", "Phương thức lựa chọn", "Loại hợp đồng", "Chia phần / lô", "Gói thầu thuốc", "Tùy chọn mua thêm", "Ngày phát hành hồ sơ"]);
      }
      const openTableBounds = await page.locator(`#${type}-table`).boundingBox();
      for (const dimension of ["x", "y", "width", "height"]) {
        assert.ok(Math.abs(tableBounds[dimension] - openTableBounds[dimension]) < 1, "opening the filter popup must not move or resize the table");
      }
      await page.locator(`#search-${type}`).evaluate((input) => input.focus());
      assert.equal(await modal.evaluate((dialog) => dialog.contains(document.activeElement)), true, "background controls cannot receive focus while the modal is open");
      for (let tab = 0; tab < 8; tab += 1) {
        await page.keyboard.press("Tab");
        const focused = await modal.evaluate((dialog) => ({
          inside: dialog.contains(document.activeElement), tag: document.activeElement?.tagName,
          id: document.activeElement?.id, action: document.activeElement?.getAttribute("data-filter-action"),
        }));
        assert.equal(focused.inside, true, `keyboard navigation stays within the modal (${JSON.stringify({ tab, ...focused })})`);
      }
      for (let tab = 0; tab < 8; tab += 1) {
        await page.keyboard.press("Shift+Tab");
        assert.equal(await modal.evaluate((dialog) => dialog.contains(document.activeElement)), true, "reverse keyboard navigation stays within the modal");
      }
      await page.keyboard.press("Escape");
      await modal.waitFor({ state: "hidden" });
      assert.equal(await trigger.evaluate((button) => button === document.activeElement), true);
      assert.equal(await trigger.getAttribute("aria-expanded"), "false");
      await trigger.click();
      await modal.locator(".business-filter-field-picker > summary").click();
      await modal.locator(`[data-filter-field][value='${definition.name}:value']`).check();
      await modal.locator(".business-filter-field-picker > summary").click();
      await modal.locator("[data-filter-options='0'] > summary").click();
      await modal.locator(`[data-filter-value='0'][value='${type === "goithau" ? "kehoach-new" : "investor-a"}']`).check();
      await page.mouse.click(5, 5);
      await modal.waitFor({ state: "hidden" });
      assert.deepEqual(await page.evaluate((type) => {
        const { model, filters } = window.listFixture;
        return filters.getBusinessListFilters(model, type);
      }, type), [], "closing through the backdrop drops the draft");
      if (type === "goithau") {
        await page.evaluate(async () => {
          const { model, view } = window.listFixture;
          const { restorePackageListContext } = await import("/frontend/packages/PackageListContext.js");
          restorePackageListContext(model, {
            filters: { status: "Chuẩn bị", method: "Đấu thầu rộng rãi", year: "2020", month: "12" },
            advancedFilters: [
              { field: "tenGoiThau", operator: "contains", value: "Không tồn tại" },
              { field: "giaGoiThau", operator: "range", value: { min: "99999999", max: "" } },
              { field: "ngayQuyetDinh", operator: "year", value: ["2020"] },
              { field: "ngayQuyetDinh", operator: "month", value: ["12"] },
              { field: "keHoachId", operator: "in", value: ["kehoach-new", "kehoach-other"] },
            ], page: 1,
          });
          await view.renderGoiThauTable();
        });
        assert.deepEqual(await page.evaluate(() => {
          const { model, filters } = window.listFixture;
          return filters.getBusinessListFilters(model, "goithau");
        }), [
          { field: "keHoachId", operator: "in", value: ["kehoach-new", "kehoach-other"] },
          { field: "trangThai", operator: "in", value: ["Chuẩn bị"] },
          { field: "hinhThucLuaChon", operator: "in", value: ["Đấu thầu rộng rãi"] },
        ], "legacy package session retains plan/status/method while dropping old text, amount, year and month filters");
        assert.equal(await page.locator("#goithau-table tbody [data-list-select-row]").count(), 1);
        assert.deepEqual(await page.evaluate(() => ["filter-goithau-nam", "filter-goithau-thang", "filter-goithau-trangthai", "filter-goithau-hinhthuc"].map((id) => document.getElementById(id).value)), ["", "", "", ""]);
        await page.evaluate(async () => {
          const { model, view, filters } = window.listFixture;
          filters.setBusinessListFilters(model, "goithau", []);
          await view.renderGoiThauTable();
        });
      }
      assert.equal(await trigger.evaluate((button) => button === document.activeElement), true);
      assert.match(await page.locator(`#${type}-table tbody input[type="checkbox"]`).first().evaluate((input) => input.outerHTML), new RegExp(`${type}-old`, "u"));
      for (const control of await page.locator(`#tab-${type} select[id^="filter-"]`).all()) assert.equal(await control.isVisible(), false);
      await page.locator(`#${type}-table tbody input[type="checkbox"]`).first().check();
      await page.waitForFunction((type) => document.querySelector(`#${type}-table thead [data-list-select-page="${type}"]`).indeterminate, type);
      assert.equal(await page.locator(`#${type}-row-selection`).isVisible(), true);
      assert.equal(await page.locator(`#${type}-row-selection [data-list-selection-action='delete']`).isVisible(), true, "the selected-row action is available to the same roles that can delete individual records");
      assert.equal(await page.evaluate((type) => {
        const { model, selection } = window.listFixture;
        return selection.getBusinessListSelection(model, type).selectedVersions[0].id;
      }, type), `${type}-old`);
      await page.locator(`#${type}-table thead [data-list-select-page="${type}"]`).check();
      assert.equal(await page.evaluate((type) => {
        const { model, selection } = window.listFixture;
        return selection.getBusinessListSelection(model, type).count;
      }, type), 2, "page selection includes the displayed historical version");
      await page.locator(`#${type}-table thead [data-list-select-page="${type}"]`).uncheck();
      await page.locator(`#${type}-table tbody input[type="checkbox"]`).first().check();
      await page.evaluate(async ({ type, render }) => {
        const { model, view } = window.listFixture;
        const keys = { kehoach: "selectedPlanVersion", goithau: "selectedPackageVersion", hopdong: "selectedHopDongVersion" };
        model.state[keys[type]][`${type}-root`] = `${type}-new`;
        if (type === "goithau") model.state.selectedPackageVersionIntent[`${type}-root`] = "latest";
        await view[render]();
      }, { type, render: definition.render });
      assert.equal(await page.locator(`#${type}-table tbody input[type="checkbox"]`).first().isChecked(), false);
      assert.equal(await page.locator(`#${type}-row-selection`).isVisible(), false, "changing displayed version drops the previous version selection");
      await page.locator(`#${type}-table tbody input[type="checkbox"]`).first().check();
      await page.evaluate(async ({ type, definition }) => {
        const { model, view, filters } = window.listFixture;
        filters.setBusinessListFilters(model, type, type === "kehoach" ? [
          { field: "chuDauTuId", operator: "in", value: ["investor-a"] },
          { field: "ngayPheDuyet", operator: "range", value: { min: "2026-10-01", max: "2026-10-01" } },
        ] : type === "hopdong" ? [
          { field: "chuDauTuId", operator: "in", value: ["investor-a"] },
          { field: "ngayKy", operator: "range", value: { min: "2026-10-01", max: "2026-10-01" } },
        ] : [
          { field: "keHoachId", operator: "in", value: ["kehoach-new"] },
          { field: "trangThai", operator: "in", value: ["Chuẩn bị"] },
        ]);
        await view[definition.render]();
      }, { type, definition });
      assert.equal(await page.locator(`#${type}-table tbody input[type="checkbox"]`).count(), 1, `${type} must apply both conditions locally`);
      assert.equal(await page.locator(`#${type}-row-selection`).isVisible(), false, "changing filters clears row selection");
      await page.evaluate(async ({ type, render }) => {
        const { model, view, filters } = window.listFixture;
        filters.setBusinessListFilters(model, type, []);
        model.pageSize = 1;
        model.currentPage[type] = 1;
        await view[render]();
      }, { type, render: definition.render });
      await page.locator(`#${type}-table thead [data-list-select-page]`).check();
      await page.locator(`#${type}-row-selection [data-list-selection-action='all']`).click();
      assert.deepEqual(await page.evaluate((type) => {
        const { model, selection } = window.listFixture;
        const selected = selection.getBusinessListSelection(model, type);
        return { mode: selected.mode, count: selected.count };
      }, type), { mode: "query", count: 2 });
      await page.evaluate(async ({ type, render }) => {
        const { model, view } = window.listFixture;
        model.currentPage[type] = 2;
        await view[render]();
      }, { type, render: definition.render });
      assert.equal(await page.locator(`#${type}-table tbody [data-list-select-row]`).isChecked(), true);
      await page.locator(`#${type}-table tbody [data-list-select-row]`).uncheck();
      assert.equal(await page.evaluate((type) => {
        const { model, selection } = window.listFixture;
        return selection.getBusinessListSelection(model, type).count;
      }, type), 1);
      await page.locator(`#${type}-row-selection [data-list-selection-action='clear']`).click();
      assert.equal(await page.locator(`#${type}-table thead [data-list-select-page]`).evaluate((input) => input === document.activeElement), true);
      await page.evaluate((type) => {
        window.listFixture.model.currentPage[type] = 1;
        window.listFixture.model.pageSize = 10;
      }, type);
    }
    await page.evaluate(async () => {
      const { model, view, filters } = window.listFixture;
      document.querySelectorAll(".tab-pane").forEach((pane) => pane.classList.toggle("active", pane.id === "tab-kehoach"));
      const plan = model.state.kehoach[0];
      for (const [id, investor, date] of [
        ["plan-unselected-investor", "investor-c", "2026-10-15"],
        ["plan-before-range", "investor-a", "2026-09-30"],
        ["plan-after-range", "investor-b", "2026-11-01"],
      ]) model.state.kehoach.push({ ...plan, id, rootId: id, maKeHoach: id, tenKeHoach: id, chuDauTuId: investor, ngayPheDuyet: date });
      filters.setBusinessListFilters(model, "kehoach", [
        { field: "tenKeHoach", operator: "contains", value: "Không tồn tại" },
        { field: "tongMucDauTu", operator: "range", value: { min: "99999999", max: "" } },
        { field: "ngayPheDuyet", operator: "year", value: ["2020"] },
        { field: "ngayPheDuyet", operator: "month", value: ["12"] },
      ]);
      for (const [id, value] of [["filter-kehoach-nam", "2020"], ["filter-kehoach-thang", "12"]]) {
        const control = document.getElementById(id);
        if (![...control.options].some((option) => option.value === value)) control.add(new Option(value, value));
        control.value = value;
      }
      await view.renderKeHoachTable();
    });
    assert.equal(await page.locator("#kehoach-table tbody [data-list-select-row]").count(), 5, "retired text, money, year, month filters and legacy controls must not restrict plans");
    assert.deepEqual(await page.evaluate(() => {
      const { model, filters } = window.listFixture;
      return {
        filters: filters.getBusinessListFilters(model, "kehoach"),
        year: document.getElementById("filter-kehoach-nam").value,
        month: document.getElementById("filter-kehoach-thang").value,
      };
    }), { filters: [], year: "", month: "" });
    const planPanel = page.locator("#kehoach-filter-panel");
    await page.locator("[data-list-filter='kehoach']").click();
    await planPanel.locator(".business-filter-field-picker > summary").click();
    await planPanel.locator("[data-filter-field][value='chuDauTuId:value']").check();
    await planPanel.locator("[data-filter-field][value='ngayPheDuyet:value']").check();
    await planPanel.locator(".business-filter-field-picker > summary").click();
    await planPanel.locator("[data-filter-options='0'] > summary").click();
    await planPanel.locator("[data-filter-value='0'][value='investor-a']").check();
    await planPanel.locator("[data-filter-value='0'][value='investor-b']").check();
    assert.equal(await planPanel.locator("[data-filter-value='0'][value='investor-a']").isChecked(), true);
    assert.equal(await planPanel.locator("[data-filter-value='0'][value='investor-b']").isChecked(), true);
    await planPanel.locator("[data-filter-options='0'] > summary").click();
    await planPanel.getByLabel("Từ ngày", { exact: true }).fill("2026-10-01");
    await planPanel.getByLabel("Đến ngày", { exact: true }).fill("2026-10-31");
    if (process.env.BF_PLAN_FILTER_SCREENSHOT) await page.screenshot({ path: process.env.BF_PLAN_FILTER_SCREENSHOT, fullPage: true });
    await planPanel.locator("[data-filter-action='apply']").click();
    await planPanel.waitFor({ state: "hidden" });
    await page.waitForFunction(() => document.querySelectorAll("#kehoach-table tbody [data-list-select-row]").length === 2);
    assert.deepEqual(await page.locator("#kehoach-table tbody [data-list-select-row]").evaluateAll((rows) => rows.map((row) => row.dataset.recordId)), ["kehoach-new", "kehoach-other"], "both selected investors and both approval-date boundaries are included");
    const planApplied = await page.evaluate(async () => {
      const { model, view, filters } = window.listFixture;
      const applied = filters.getBusinessListFilters(model, "kehoach");
      model.pageSize = 1;
      model.currentPage.kehoach = 2;
      await view.renderKeHoachTable();
      return applied;
    });
    assert.deepEqual(planApplied, [
      { field: "chuDauTuId", operator: "in", value: ["investor-a", "investor-b"] },
      { field: "ngayPheDuyet", operator: "range", value: { min: "2026-10-01", max: "2026-10-31" } },
    ]);
    await page.evaluate(async (applied) => {
      const { model, view, filters } = window.listFixture;
      filters.setBusinessListFilters(model, "kehoach", [...applied,
        { field: "tenKeHoach", operator: "contains", value: "Không tồn tại" },
        { field: "ngayPheDuyet", operator: "year", value: ["2020"] },
      ]);
      document.getElementById("filter-kehoach-nam").value = "2026";
      document.getElementById("filter-kehoach-thang").value = "10";
      await view.renderKeHoachTable();
    }, planApplied);
    assert.deepEqual(await page.evaluate(() => {
      const { model, filters } = window.listFixture;
      return filters.getBusinessListFilters(model, "kehoach");
    }), planApplied, "removing retired plan filters preserves the allowed investor and approval-date conditions");
    await page.evaluate(async () => {
      const { model, view } = window.listFixture;
      model.currentPage.kehoach = 2;
      await view.renderKeHoachTable();
    });
    await page.locator("#kehoach-table tbody [data-list-select-row]").check();
    await page.locator("[data-list-filter='kehoach']").click();
    await planPanel.getByLabel("Từ ngày", { exact: true }).fill("2026-10-31");
    await planPanel.getByLabel("Đến ngày", { exact: true }).fill("2026-10-01");
    await planPanel.locator("[data-filter-action='apply']").click();
    await planPanel.locator("[data-filter-error]").waitFor({ state: "visible" });
    assert.equal(await planPanel.isVisible(), true);
    assert.deepEqual(await page.evaluate(() => {
      const { model, filters, selection } = window.listFixture;
      return { filters: filters.getBusinessListFilters(model, "kehoach"), page: model.currentPage.kehoach, count: selection.getBusinessListSelection(model, "kehoach").count };
    }), { filters: planApplied, page: 2, count: 1 }, "a reversed date range must preserve the applied filters, page and row selection");
    assert.equal(await page.locator("#kehoach-table tbody [data-list-select-row]").getAttribute("data-record-id"), "kehoach-other");
    await planPanel.locator("[data-filter-action='cancel']").last().click();
    await page.evaluate(async () => {
      const { model, view, filters } = window.listFixture;
      document.querySelectorAll(".tab-pane").forEach((pane) => pane.classList.toggle("active", pane.id === "tab-hopdong"));
      const contract = model.state.hopdong[0];
      for (const [id, changes, employee] of [
        ["contract-other-investor", { chuDauTuId: "investor-c" }, "employee-a"],
        ["contract-other-contractor", { nhaThauId: "contractor-c" }, "employee-a"],
        ["contract-other-plan", { keHoachId: "plan-unselected-investor" }, "employee-a"],
        ["contract-other-package", { goiThauIds: ["goithau-old"] }, "employee-a"],
        ["contract-other-assignee", {}, "employee-c"],
        ["contract-other-status", { trangThaiHopDong: "Tạm dừng" }, "employee-a"],
        ["contract-before-range", { ngayKy: "2026-09-30" }, "employee-a"],
        ["contract-after-range", { ngayKy: "2026-11-01" }, "employee-a"],
      ]) {
        model.state.hopdong.push({ ...contract, id, rootId: id, soHopDong: id, tenHopDong: id, ...changes });
        model.state.assignments.push({ id: `assignment-${id}`, type: "hopdong", targetId: id, empId: employee });
      }
      model.currentPage.hopdong = 1;
      model.pageSize = 10;
      filters.setBusinessListFilters(model, "hopdong", [
        { field: "tenHopDong", operator: "contains", value: "Không tồn tại" },
        { field: "giaTri", operator: "range", value: { min: "99999999", max: "" } },
        { field: "ngayKy", operator: "year", value: ["2020"] },
        { field: "ngayKy", operator: "month", value: ["12"] },
      ]);
      for (const [id, value] of [["filter-hopdong-nam", "2020"], ["filter-hopdong-thang", "12"]]) {
        const control = document.getElementById(id);
        if (![...control.options].some((option) => option.value === value)) control.add(new Option(value, value));
        control.value = value;
      }
      await view.renderHopDongTable();
    });
    assert.equal(await page.locator("#hopdong-table tbody [data-list-select-row]").count(), 10, "retired text, amount, year, month conditions and hidden legacy controls must not restrict contracts");
    assert.deepEqual(await page.evaluate(() => {
      const { model, filters } = window.listFixture;
      return {
        filters: filters.getBusinessListFilters(model, "hopdong"),
        year: document.getElementById("filter-hopdong-nam").value,
        month: document.getElementById("filter-hopdong-thang").value,
      };
    }), { filters: [], year: "", month: "" });
    const contractPanel = page.locator("#hopdong-filter-panel");
    await page.locator("[data-list-filter='hopdong']").click();
    await contractPanel.locator(".business-filter-field-picker > summary").click();
    const contractValues = [
      ["chuDauTuId", ["investor-a", "investor-b"]],
      ["nhaThauId", ["contractor-a", "contractor-b"]],
      ["keHoachId", ["kehoach-new", "kehoach-other"]],
      ["goiThauIds", ["goithau-new", "goithau-other"]],
      ["assigneeId", ["employee-a", "employee-b"]],
      ["trangThaiHopDong", ["Đang thực hiện", "Hoàn thành"]],
    ];
    for (const [field] of [...contractValues, ["ngayKy"]]) await contractPanel.locator(`[data-filter-field][value='${field}:value']`).check();
    await contractPanel.locator(".business-filter-field-picker > summary").click();
    for (const [index, [, values]] of contractValues.entries()) {
      await contractPanel.locator(`[data-filter-options='${index}'] > summary`).click();
      for (const value of values) await contractPanel.locator(`[data-filter-value='${index}'][value='${value}']`).check();
      assert.equal(await contractPanel.locator(`[data-filter-value='${index}']:checked`).count(), 2);
      await contractPanel.locator(`[data-filter-options='${index}'] > summary`).click();
    }
    await contractPanel.getByLabel("Từ ngày", { exact: true }).fill("2026-10-01");
    await contractPanel.getByLabel("Đến ngày", { exact: true }).fill("2026-10-31");
    if (process.env.BF_CONTRACT_FILTER_SCREENSHOT) await page.screenshot({ path: process.env.BF_CONTRACT_FILTER_SCREENSHOT, fullPage: true });
    await contractPanel.locator("[data-filter-action='apply']").click();
    await contractPanel.waitFor({ state: "hidden" });
    await page.waitForFunction(() => document.querySelectorAll("#hopdong-table tbody [data-list-select-row]").length === 2);
    assert.deepEqual(await page.locator("#hopdong-table tbody [data-list-select-row]").evaluateAll((rows) => rows.map((row) => row.dataset.recordId)), ["hopdong-new", "hopdong-other"], "all six multi-value fields and both date boundaries apply together");
    const contractApplied = contractValues.map(([field, value]) => ({ field, operator: "in", value }));
    contractApplied.push({ field: "ngayKy", operator: "range", value: { min: "2026-10-01", max: "2026-10-31" } });
    assert.deepEqual(await page.evaluate(() => {
      const { model, filters } = window.listFixture;
      return filters.getBusinessListFilters(model, "hopdong");
    }), contractApplied);
    await page.evaluate(async (applied) => {
      const { model, view, filters } = window.listFixture;
      filters.setBusinessListFilters(model, "hopdong", [...applied,
        { field: "tenHopDong", operator: "contains", value: "Không tồn tại" },
        { field: "ngayKy", operator: "year", value: ["2020"] },
      ]);
      document.getElementById("filter-hopdong-nam").value = "2026";
      document.getElementById("filter-hopdong-thang").value = "10";
      await view.renderHopDongTable();
    }, contractApplied);
    assert.deepEqual(await page.evaluate(() => {
      const { model, filters } = window.listFixture;
      return filters.getBusinessListFilters(model, "hopdong");
    }), contractApplied, "cleanup preserves all seven allowed contract filter conditions");
    assert.equal(await page.locator("#hopdong-table tbody [data-list-select-row]").count(), 2);
    await page.evaluate(async () => {
      const { model, view } = window.listFixture;
      model.pageSize = 1;
      model.currentPage.hopdong = 2;
      await view.renderHopDongTable();
    });
    await page.locator("#hopdong-table tbody [data-list-select-row]").check();
    await page.locator("[data-list-filter='hopdong']").click();
    await contractPanel.getByLabel("Từ ngày", { exact: true }).fill("2026-10-31");
    await contractPanel.getByLabel("Đến ngày", { exact: true }).fill("2026-10-01");
    await contractPanel.locator("[data-filter-action='apply']").click();
    await contractPanel.locator("[data-filter-error]").waitFor({ state: "visible" });
    assert.equal(await contractPanel.isVisible(), true);
    assert.deepEqual(await page.evaluate(() => {
      const { model, filters, selection } = window.listFixture;
      return { filters: filters.getBusinessListFilters(model, "hopdong"), page: model.currentPage.hopdong, count: selection.getBusinessListSelection(model, "hopdong").count };
    }), { filters: contractApplied, page: 2, count: 1 }, "invalid contract date range keeps applied filters, page and selection");
    assert.equal(await page.locator("#hopdong-table tbody [data-list-select-row]").getAttribute("data-record-id"), "hopdong-other");
    await contractPanel.locator("[data-filter-action='cancel']").last().click();
    await page.evaluate(async () => {
      const { model, view, filters } = window.listFixture;
      document.querySelectorAll(".tab-pane").forEach((pane) => pane.classList.toggle("active", pane.id === "tab-goithau"));
      filters.setBusinessListFilters(model, "goithau", []);
      model.currentPage.goithau = 1;
      model.pageSize = 100;
      window.listFixture.packageRecords = [...model.state.goithau];
      model.state.goithau = Array.from({ length: 100 }, (_, index) => ({
        id: `virtual-current-${index}`, rootId: `virtual-root-${index}`, phienBan: "01", isLatest: 1,
        maGoiThau: `GT-${index}`, tenGoiThau: `Gói ${index}`, giaGoiThau: "1000000", trangThai: "Chuẩn bị", ngayQuyetDinh: "2026-10-01",
      }));
      model.state.goithau.push({ ...model.state.goithau[99], id: "virtual-history-99", phienBan: "00", isLatest: 0 });
      model.state.selectedPackageVersion = { "virtual-root-99": "virtual-history-99" };
      model.state.selectedPackageVersionIntent = { "virtual-root-99": "historical" };
      await view.renderGoiThauTable();
    });
    assert.ok(await page.locator("#goithau-table tbody input[type='checkbox']").count() < 100, "fixture must use virtual rows");
    await page.locator("#goithau-table thead [data-list-select-page='goithau']").check();
    const virtualSelection = await page.evaluate(() => {
      const { model, selection } = window.listFixture;
      return selection.getBusinessListSelection(model, "goithau");
    });
    assert.equal(virtualSelection.count, 100);
    assert.ok(virtualSelection.selectedVersions.some((entry) => entry.id === "virtual-history-99"), "page selection must respect the displayed version of an unmounted row");
    await page.evaluate(async () => {
      const { model, view, packageRecords } = window.listFixture;
      model.state.goithau = [...packageRecords];
      const pkg = model.state.goithau[0];
      for (const [id, changes] of [
        ["package-other-plan", { keHoachId: "plan-unselected-investor" }],
        ["package-other-status", { trangThai: "Đã mở thầu" }],
        ["package-other-method", { hinhThucLuaChon: "Chỉ định thầu" }],
        ["package-other-sector", { linhVuc: "Tư vấn" }],
        ["package-other-procedure", { phuongThucLuaChon: "Hai giai đoạn một túi hồ sơ" }],
        ["package-other-contract-type", { loaiHopDong: "Theo thời gian" }],
        ["package-no-lot-choice", { phanLo: "" }],
        ["package-no-medicine-choice", { isThuoc: null }],
        ["package-no-extra-purchase-choice", { tuyChonMuaThem: "" }],
        ["package-before-range", { thoiGianDangTai: "2026-09-30T23:59:59+07:00" }],
        ["package-after-range", { thoiGianDangTai: "2026-11-01T00:00:00+07:00" }],
      ]) model.state.goithau.push({ ...pkg, id, rootId: id, maGoiThau: id, tenGoiThau: id, ...changes });
      model.state.selectedPackageVersion = {};
      model.state.selectedPackageVersionIntent = {};
      model.currentPage.goithau = 1;
      model.pageSize = 20;
      await view.renderGoiThauTable();
    });
    assert.equal(await page.locator("#goithau-table tbody [data-list-select-row]").count(), 13);
    const panel = page.locator("#goithau-filter-panel");
    await page.locator("[data-list-filter='goithau']").click();
    await panel.locator(".business-filter-field-picker > summary").click();
    const packageValues = [
      ["keHoachId", ["kehoach-new", "kehoach-other"]],
      ["trangThai", ["Chuẩn bị", "Đang mời thầu"]],
      ["hinhThucLuaChon", ["Đấu thầu rộng rãi", "Chào hàng cạnh tranh"]],
      ["linhVuc", ["Hàng hóa", "Xây lắp"]],
      ["phuongThucLuaChon", ["Một giai đoạn một túi hồ sơ", "Một giai đoạn hai túi hồ sơ"]],
      ["loaiHopDong", ["Trọn gói", "Theo đơn giá cố định"]],
      ["phanLo", ["Có", "Không"]],
      ["isThuoc", ["1", "0"]],
      ["tuyChonMuaThem", ["Có", "Không"]],
    ];
    for (const [field] of [...packageValues, ["thoiGianDangTai"]]) await panel.locator(`[data-filter-field][value='${field}:value']`).check();
    await panel.locator(".business-filter-field-picker > summary").click();
    for (const [index, [, values]] of packageValues.entries()) {
      await panel.locator(`[data-filter-options='${index}'] > summary`).click();
      for (const value of values) await panel.locator(`[data-filter-value='${index}'][value='${value}']`).check();
      assert.equal(await panel.locator(`[data-filter-value='${index}']:checked`).count(), 2);
      await panel.locator(`[data-filter-options='${index}'] > summary`).click();
    }
    await panel.getByLabel("Từ ngày", { exact: true }).fill("2026-10-01");
    await panel.getByLabel("Đến ngày", { exact: true }).fill("2026-10-31");
    if (process.env.BF_BUSINESS_LIST_DESKTOP_SCREENSHOT) await page.screenshot({ path: process.env.BF_BUSINESS_LIST_DESKTOP_SCREENSHOT, fullPage: true });
    await panel.locator("[data-filter-action='apply']").click();
    await panel.waitFor({ state: "hidden" });
    await page.waitForFunction(() => document.querySelectorAll("#goithau-table tbody [data-list-select-row]").length === 2);
    assert.deepEqual(await page.locator("#goithau-table tbody [data-list-select-row]").evaluateAll((rows) => rows.map((row) => row.dataset.recordId)), ["goithau-new", "goithau-other"], "all nine multi-value fields and inclusive release-date boundaries apply together");
    const packageApplied = packageValues.map(([field, value]) => ({ field, operator: "in", value }));
    packageApplied.push({ field: "thoiGianDangTai", operator: "range", value: { min: "2026-10-01", max: "2026-10-31" } });
    assert.deepEqual(await page.evaluate(() => {
      const { model, filters } = window.listFixture;
      return filters.getBusinessListFilters(model, "goithau");
    }), packageApplied);
    assert.equal(await page.locator("#goithau-row-selection").isVisible(), false);
    for (const [field, values] of packageValues.slice(6)) {
      await page.evaluate(async ({ applied, field, value }) => {
        const { model, view, filters } = window.listFixture;
        filters.setBusinessListFilters(model, "goithau", applied.map((condition) => condition.field === field ? { ...condition, value: [value] } : condition));
        await view.renderGoiThauTable();
      }, { applied: packageApplied, field, value: values[0] });
      assert.deepEqual(await page.locator("#goithau-table tbody [data-list-select-row]").evaluateAll((rows) => rows.map((row) => row.dataset.recordId)), ["goithau-new"], `${field} with one selected value must exclude the opposite choice`);
    }
    await page.evaluate(async (applied) => {
      const { model, view, filters } = window.listFixture;
      filters.setBusinessListFilters(model, "goithau", [...applied,
        { field: "tenGoiThau", operator: "contains", value: "Không tồn tại" },
        { field: "giaGoiThau", operator: "range", value: { min: "99999999", max: "" } },
        { field: "ngayQuyetDinh", operator: "year", value: ["2020"] },
        { field: "ngayQuyetDinh", operator: "month", value: ["12"] },
      ]);
      document.getElementById("filter-goithau-nam").value = "2026";
      document.getElementById("filter-goithau-thang").value = "10";
      await view.renderGoiThauTable();
    }, packageApplied);
    assert.deepEqual(await page.evaluate(() => {
      const { model, filters } = window.listFixture;
      return filters.getBusinessListFilters(model, "goithau");
    }), packageApplied, "cleanup preserves all ten allowed package filter conditions");
    assert.equal(await page.locator("#goithau-table tbody [data-list-select-row]").count(), 2);
    await page.evaluate(async () => {
      const { model, view } = window.listFixture;
      model.pageSize = 1;
      model.currentPage.goithau = 2;
      await view.renderGoiThauTable();
    });
    await page.locator("#goithau-table tbody [data-list-select-row]").check();
    await page.locator("[data-list-filter='goithau']").click();
    await panel.getByLabel("Từ ngày", { exact: true }).fill("2026-10-31");
    await panel.getByLabel("Đến ngày", { exact: true }).fill("2026-10-01");
    await panel.locator("[data-filter-action='apply']").click();
    await panel.locator("[data-filter-error]").waitFor({ state: "visible" });
    assert.equal(await panel.isVisible(), true);
    assert.deepEqual(await page.evaluate(() => {
      const { model, filters, selection } = window.listFixture;
      return { filters: filters.getBusinessListFilters(model, "goithau"), page: model.currentPage.goithau, count: selection.getBusinessListSelection(model, "goithau").count };
    }), { filters: packageApplied, page: 2, count: 1 }, "invalid release-date range keeps the applied package filters, page and selection");
    assert.equal(await page.locator("#goithau-table tbody [data-list-select-row]").getAttribute("data-record-id"), "goithau-other");
    await panel.locator("[data-filter-action='cancel']").last().click();
    await page.evaluate(async () => {
      const { model, view, selection } = window.listFixture;
      selection.clearBusinessListSelection(model, "goithau");
      model.pageSize = 20;
      model.currentPage.goithau = 1;
      await view.renderGoiThauTable();
    });
    await page.locator("[data-list-filter='goithau']").click();
    await panel.locator("[data-filter-action='clear']").click();
    assert.equal(await panel.locator("[data-filter-condition]").count(), 0);
    await panel.locator("[data-filter-action='cancel']").last().click();
    await page.locator("[data-list-filter='goithau']").click();
    assert.equal(await panel.locator("[data-filter-condition]").count(), 10, "Cancel must preserve the applied conditions");
    await panel.getByLabel("Từ ngày", { exact: true }).fill("2026-11-01");
    await panel.getByLabel("Từ ngày", { exact: true }).press("Escape");
    await panel.waitFor({ state: "hidden" });
    assert.equal(await page.locator("#goithau-table tbody [data-list-select-row]").count(), 2, "Escape cancels the current draft");
    await page.setViewportSize({ width: 390, height: 844 });
    await page.evaluate(() => window.listFixture.view.enhanceVisibleContent(document.getElementById("tab-goithau")));
    await page.locator("#tab-goithau .business-list-mobile-selection [data-list-select-page]").check();
    assert.equal(await page.evaluate(() => {
      const { model, selection } = window.listFixture;
      return selection.getBusinessListSelection(model, "goithau").count;
    }), 2, "mobile page selection remains available when card layout hides the table header");
    await page.locator("[data-list-filter='goithau']").click();
    const panelBounds = await panel.boundingBox();
    assert.ok(panelBounds.x >= 0 && panelBounds.x + panelBounds.width <= 390, "mobile filter popup stays within the viewport");
    assert.ok(panelBounds.y >= 0 && panelBounds.y + panelBounds.height <= 844, "mobile filter popup height stays within the viewport");
    const applyBounds = await panel.locator("[data-filter-action='apply']").boundingBox();
    assert.ok(applyBounds.y >= panelBounds.y && applyBounds.y + applyBounds.height <= panelBounds.y + panelBounds.height, "Apply remains visible in the modal footer");
    await panel.locator(".business-filter-body").evaluate((body) => { body.scrollTop = body.scrollHeight; });
    const scrolledApplyBounds = await panel.locator("[data-filter-action='apply']").boundingBox();
    assert.ok(Math.abs(applyBounds.y - scrolledApplyBounds.y) < 1, "scrolling the modal body keeps the footer fixed");
    if (process.env.BF_BUSINESS_LIST_SCREENSHOT) {
      await panel.locator(".business-filter-body").evaluate((body) => { body.scrollTop = 0; });
      await page.screenshot({ path: process.env.BF_BUSINESS_LIST_SCREENSHOT, fullPage: true });
    }
    await panel.locator("[data-filter-action='cancel']").last().click();
    await page.setViewportSize({ width: 1280, height: 800 });
    for (const type of types) {
      const definition = fields[type];
      const expectedFilters = type === "kehoach" ? [
        { field: "chuDauTuId", operator: "in", value: ["investor-a", "investor-b"] },
        { field: "ngayPheDuyet", operator: "range", value: { min: "2026-10-01", max: "2026-10-31" } },
      ] : type === "hopdong" ? contractApplied : packageApplied;
      let interceptedRoute;
      let requestReady;
      const requested = new Promise((done) => { requestReady = done; });
      const routeHandler = (route) => { interceptedRoute = route; requestReady(); };
      await page.route("**/api/paginate?**", routeHandler);
      await page.evaluate(({ type, definition, expectedFilters }) => {
        const { model, view, filters } = window.listFixture;
        document.querySelectorAll(".tab-pane").forEach((pane) => pane.classList.toggle("active", pane.id === `tab-${type}`));
        filters.setBusinessListFilters(model, type, expectedFilters);
        model.useServerSidePagination = true;
        model.pageSize = 10;
        model.currentPage[type] = 1;
        window.listFixture.inFlight = view[definition.render]();
      }, { type, definition, expectedFilters });
      await requested;
      const requestUrl = new URL(interceptedRoute.request().url());
      assert.deepEqual(JSON.parse(requestUrl.searchParams.get("filters")), expectedFilters, `${type} sends the exact applied filters to server pagination`);
      assert.equal(requestUrl.searchParams.get("nam"), "");
      assert.equal(requestUrl.searchParams.get("thang"), "");
      if (type === "goithau") {
        assert.equal(requestUrl.searchParams.get("trangThai"), "");
        assert.equal(requestUrl.searchParams.get("hinhThuc"), "");
      }
      assert.equal(await page.locator(`#${type}-table thead [data-list-select-page]`).isDisabled(), true, "loading must disable selection for the previous page");
      const items = await page.evaluate((type) => window.listFixture.model.state[type].filter((row) => row.isLatest === 1).slice(0, 10), type);
      await interceptedRoute.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ items, totalItems: items.length }) });
      await page.evaluate(async () => window.listFixture.inFlight);
      assert.equal(await page.locator(`#${type}-table thead [data-list-select-page]`).isDisabled(), false);
      await page.unroute("**/api/paginate?**", routeHandler);
    }
    for (const type of types) {
      await page.evaluate(async ({ type, render }) => {
        const { model, view, filters } = window.listFixture;
        model.useServerSidePagination = false;
        model.state.activerole = "employee";
        model.currentPage[type] = 1;
        filters.setBusinessListFilters(model, type, []);
        document.querySelectorAll(".tab-pane").forEach((pane) => pane.classList.toggle("active", pane.id === `tab-${type}`));
        await view[render]();
      }, { type, render: fields[type].render });
      await page.locator(`#${type}-table tbody [data-list-select-row]`).first().check();
      assert.equal(await page.locator(`#${type}-row-selection`).isVisible(), true);
      assert.equal(await page.locator(`#${type}-row-selection [data-list-selection-action='delete']`).count(), 0, "employee row selection does not introduce a delete action");
    }
    // Package codes are optional while a package is still in preparation.
    // Searching by the Vietnamese package name must continue to work when
    // that optional field is null in a legacy or imported row.
    await page.evaluate(async () => {
      const { model, view } = window.listFixture;
      const source = model.state.goithau[0] || {};
      model.state.activerole = "manager";
      model.state.goithau = [{
        ...source,
        id: "goithau-dieu-tra",
        rootId: "goithau-dieu-tra",
        phienBan: "00",
        isLatest: 1,
        maGoiThau: null,
        tenGoiThau: "Điều tra hiện trạng",
      }];
      model.currentPage.goithau = 1;
      model.pageSize = 10;
      document.querySelectorAll(".tab-pane").forEach((pane) => pane.classList.toggle("active", pane.id === "tab-goithau"));
      document.getElementById("search-goithau").value = "Điều tra";
      await view.renderGoiThauTable();
    });
    assert.equal(await page.locator("#goithau-table tbody [data-list-select-row]").count(), 1, "Vietnamese package-name search must include rows with no package code");
    assert.match(await page.locator("#goithau-table tbody td:nth-child(3)").first().textContent(), /Điều tra hiện trạng/u);
    await page.evaluate(async () => {
      const { view } = window.listFixture;
      document.getElementById("search-goithau").value = "Dieu tra";
      await view.renderGoiThauTable();
    });
    assert.equal(await page.locator("#goithau-table tbody [data-list-select-row]").count(), 1, "Vietnamese package-name search must also match an unaccented query");
    assert.deepEqual(errors, []);
  } finally {
    await browser.close();
    server.closeAllConnections();
    await new Promise((done) => server.close(done));
  }
});
