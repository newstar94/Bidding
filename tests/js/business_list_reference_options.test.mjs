import assert from "node:assert/strict";
import { createServer } from "node:http";
import { readFile } from "node:fs/promises";
import { extname, resolve, sep } from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";
import { chromium } from "playwright";

const projectRoot = resolve(fileURLToPath(new URL("../..", import.meta.url)));

async function fixture(type = "goithau") {
  const template = await readFile(resolve(projectRoot, `views/tabs/tab_${type}.html`), "utf8");
  const server = createServer(async (request, response) => {
    try {
      const pathname = new URL(request.url, "http://127.0.0.1").pathname;
      if (pathname === "/") {
        response.writeHead(200, { "content-type": "text/html; charset=utf-8" });
        response.end(`<!doctype html><html lang="vi"><head><title>Reference choices</title>
          <link rel="stylesheet" data-runtime-styles href="/views/css/runtime-styles.css">
        </head><body><main>${template}</main></body></html>`);
        return;
      }
      const path = resolve(projectRoot, `.${pathname}`);
      if (!path.startsWith(`${projectRoot}${sep}`)) throw new Error("Invalid fixture path");
      const content = await readFile(path);
      const contentType = [".js", ".mjs"].includes(extname(path)) ? "text/javascript; charset=utf-8"
        : extname(path) === ".css" ? "text/css; charset=utf-8" : "text/plain; charset=utf-8";
      response.writeHead(200, { "content-type": contentType });
      response.end(content);
    } catch {
      response.writeHead(404);
      response.end();
    }
  });
  await new Promise((done) => server.listen(0, "127.0.0.1", done));
  const browser = await chromium.launch({ headless: true });
  const page = await browser.newPage();
  const errors = [];
  page.on("pageerror", (error) => errors.push(error.message));
  await page.goto(`http://127.0.0.1:${server.address().port}/`);
  await page.evaluate(async (type) => {
    const [{ BiddingView }, packages, contracts, controls, filters, selection] = await Promise.all([
      import("/frontend/app/BiddingView.js"), import("/frontend/packages/GoiThauTable.js"),
      import("/frontend/contracts/HopDongComponent.js"),
      import("/frontend/shared/BusinessListControls.js"), import("/frontend/shared/BusinessListFilters.js"),
      import("/frontend/shared/BusinessListSelection.js"),
    ]);
    window.lucide = { createIcons() {} };
    const state = {
      activeuser: { id: "user-1" }, activerole: "admin", activetab: type,
      goithau: [], hopdong: [], kehoach: [], chudautu: [], nhathau: [], assignments: [], employees: [],
      customcontractstatuses: [], thongtinmothau: [], selectedPackageVersion: {}, selectedPackageVersionIntent: {}, selectedHopDongVersion: {},
    };
    const model = {
      state, useServerSidePagination: true, pageSize: 10, currentPage: { goithau: 1, hopdong: 1 }, sortState: { goithau: {}, hopdong: {} },
      workspaceScope: { key: "user-1:org-1", organizationId: "org-1" },
      getWorkspaceToken() { return this.workspaceScope.key; },
      getFilteredGoiThau: () => [], getLatestPackages: () => [], getLatestPlan: () => null, getLatestHopDong: () => [],
      getPackageBaseCode: (value) => value, getPlanBaseCode: (value) => value,
      formatCurrency: (value) => `${value} ₫`, savePage() {},
    };
    const view = new BiddingView(model);
    view.renderGoiThauTable = packages.renderGoiThauTable.bind(view);
    view.renderHopDongTable = contracts.renderHopDongTable.bind(view);
    view.showToast = () => {};
    document.getElementById(`tab-${type}`).classList.add("active");
    await controls.ensureBusinessListControls(view, type);
    window.referenceFixture = { model, view, controls, filters, selection };
  }, type);
  return {
    page, errors,
    async close() {
      await browser.close();
      server.closeAllConnections();
      await new Promise((done) => server.close(done));
    },
  };
}

async function addReferenceField(page, type = "goithau", key = "keHoachId") {
  const panel = page.locator(`#${type}-filter-panel`);
  await page.locator(`[data-list-filter='${type}']`).click();
  await panel.locator(".business-filter-field-picker > summary").click();
  await panel.locator(`[data-filter-field][value='${key}:value']`).check();
  await panel.locator(".business-filter-field-picker > summary").click();
  return panel;
}

function response(items, totalItems = items.length) {
  return { status: 200, contentType: "application/json", body: JSON.stringify({ items, totalItems }) };
}

function directoryResponse(users) {
  return { status: 200, contentType: "application/json", body: JSON.stringify(users) };
}

test("a reference request survives a draft re-render and can reload its current generation", async () => {
  const app = await fixture();
  try {
    const { page } = app;
    let resolveFirst;
    const firstRoute = new Promise((done) => { resolveFirst = done; });
    await page.route("**/api/paginate?**", async (route) => { resolveFirst(route); });
    const panel = await addReferenceField(page);
    await panel.locator("[data-filter-options='0'] > summary").click();
    const route = await firstRoute;
    assert.equal(new URL(route.request().url()).searchParams.get("table"), "kehoach");
    await panel.locator(".business-filter-field-picker > summary").click();
    await panel.locator("[data-filter-field][value='linhVuc:value']").check();
    await panel.locator(".business-filter-field-picker > summary").click();
    await route.fulfill(response([{ id: "plan-remote", maKeHoach: "KH-REMOTE", tenKeHoach: "Kế hoạch từ máy chủ" }]));
    await page.waitForFunction(() => window.referenceFixture.model.state.kehoach.some((row) => row.id === "plan-remote"));
    await panel.locator("[data-filter-options='0'] > summary").click();
    await panel.locator("[data-filter-option-list='0'] [value='plan-remote']").waitFor({ state: "visible", timeout: 5000 });
    assert.deepEqual(app.errors, []);
  } finally {
    await app.close();
  }
});

test("reference search starts at page one and blocks loading more from the previous query", async () => {
  const app = await fixture();
  try {
    const { page } = app;
    const seen = [];
    let resolveSearch;
    const searchRoute = new Promise((done) => { resolveSearch = done; });
    await page.route("**/api/paginate?**", async (route) => {
      const query = new URL(route.request().url()).searchParams;
      seen.push({ search: query.get("search"), page: query.get("page") });
      if (!query.get("search")) await route.fulfill(response([
        { id: "plan-previous", maKeHoach: "OLD", tenKeHoach: "Trước khi tìm" },
      ], 150));
      else resolveSearch(route);
    });
    const panel = await addReferenceField(page);
    await panel.locator("[data-filter-options='0'] > summary").click();
    const more = panel.locator("[data-filter-load-more='0']");
    await more.waitFor({ state: "visible" });
    await panel.locator("[data-filter-option-search='0']").fill("Máy");
    const route = await searchRoute;
    assert.equal(new URL(route.request().url()).searchParams.get("page"), "1");
    assert.equal(await more.isVisible() && await more.isEnabled(), false, "Xem thêm must not use the previous query page during search");
    await route.fulfill(response([{ id: "plan-match", maKeHoach: "MATCH", tenKeHoach: "Máy xét nghiệm" }], 1));
    await panel.locator("[data-filter-option-list='0'] [value='plan-match']").waitFor({ state: "visible" });
    assert.equal(await panel.locator("[data-filter-option-list='0'] [value='plan-previous']").count(), 0);
    assert.deepEqual(seen, [{ search: "", page: "1" }, { search: "Máy", page: "1" }]);
    assert.deepEqual(app.errors, []);
  } finally {
    await app.close();
  }
});

test("the real package renderer sends all structured filters to the server and uses its full filtered total", async () => {
  const app = await fixture();
  try {
    const { page } = app;
    const queries = [];
    await page.route("**/api/paginate?**", async (route) => {
      const query = new URL(route.request().url()).searchParams;
      queries.push(Object.fromEntries(query));
      await route.fulfill(response([{
        id: "remote-match", rootId: "remote-match", phienBan: "00", isLatest: 1,
        maGoiThau: "GT-SERVER", tenGoiThau: "Máy chủ trả về", giaGoiThau: "200", ngayQuyetDinh: "2026-10-02", trangThai: "Chuẩn bị",
      }], 111));
    });
    const expected = [
      { field: "linhVuc", operator: "in", value: ["Hàng hóa", "Xây lắp"] },
      { field: "hinhThucLuaChon", operator: "in", value: ["Đấu thầu rộng rãi"] },
      { field: "thoiGianDangTai", operator: "range", value: { min: "2026-10-01", max: "2026-10-31" } },
      { field: "trangThai", operator: "in", value: ["Chuẩn bị", "Đang mời thầu"] },
    ];
    await page.evaluate(async (filters) => {
      const app = window.referenceFixture;
      app.filters.setBusinessListFilters(app.model, "goithau", filters);
      await app.view.renderGoiThauTable();
    }, expected);
    assert.equal(queries.length, 1);
    assert.equal(queries[0].table, "goithau");
    assert.deepEqual(JSON.parse(queries[0].filters), expected);
    assert.equal(queries[0].page, "1");
    assert.equal(queries[0].pageSize, "10");
    assert.equal(await page.locator("#goithau-table tbody [data-list-select-row]").count(), 1);
    assert.equal(await page.evaluate(() => window.referenceFixture.selection.getBusinessListSelection(window.referenceFixture.model, "goithau").totalItems), 111);
    assert.deepEqual(app.errors, []);
  } finally {
    await app.close();
  }
});

test("a workspace change fences a pending reference response and clears the old draft", async () => {
  const app = await fixture();
  try {
    const { page } = app;
    let resolveRequest;
    const pendingRoute = new Promise((done) => { resolveRequest = done; });
    await page.route("**/api/paginate?**", (route) => { resolveRequest(route); });
    const panel = await addReferenceField(page);
    await panel.locator("[data-filter-options='0'] > summary").click();
    const route = await pendingRoute;
    await page.evaluate(async () => {
      const app = window.referenceFixture;
      app.model.workspaceScope = { key: "user-1:org-2", organizationId: "org-2" };
      app.model.state = { ...app.model.state, kehoach: [], goithau: [], assignments: [] };
      await app.controls.ensureBusinessListControls(app.view, "goithau");
    });
    await route.fulfill(response([{ id: "old-tenant-plan", maKeHoach: "OLD", tenKeHoach: "Dữ liệu tổ chức cũ" }]));
    await page.waitForFunction(() => window.referenceFixture.model._paginationRequests.size === 0);
    assert.equal(await panel.isVisible(), false);
    assert.equal(await page.evaluate(() => window.referenceFixture.model.state.kehoach.length), 0);
    await page.locator("[data-list-filter='goithau']").click();
    assert.equal(await panel.locator("[data-filter-condition]").count(), 0);
    assert.deepEqual(app.errors, []);
  } finally {
    await app.close();
  }
});

test("an invalid range keeps the filter modal open and preserves applied filters, page and row selection", async () => {
  const app = await fixture();
  try {
    const { page } = app;
    let requestCount = 0;
    await page.route("**/api/paginate?**", async (route) => {
      requestCount += 1;
      await route.fulfill(response([{
        id: "remote-match", rootId: "remote-match", phienBan: "00", isLatest: 1,
        maGoiThau: "GT-SERVER", tenGoiThau: "Máy chủ trả về", giaGoiThau: "200", ngayQuyetDinh: "2026-10-02", trangThai: "Chuẩn bị",
      }], 111));
    });
    const baseline = [{ field: "trangThai", operator: "in", value: ["Chuẩn bị"] }];
    await page.evaluate(async (filters) => {
      const app = window.referenceFixture;
      app.filters.setBusinessListFilters(app.model, "goithau", filters);
      app.model.currentPage.goithau = 2;
      await app.view.renderGoiThauTable();
    }, baseline);
    await page.locator("#goithau-table tbody [data-list-select-row]").check();
    await page.locator("[data-list-filter='goithau']").click();
    const panel = page.locator("#goithau-filter-panel");
    await panel.locator(".business-filter-field-picker > summary").click();
    await panel.locator("[data-filter-field][value='thoiGianDangTai:value']").check();
    await panel.locator(".business-filter-field-picker > summary").click();
    await panel.locator("[data-filter-index='1'][data-filter-bound='min']").fill("2026-10-31");
    await panel.locator("[data-filter-index='1'][data-filter-bound='max']").fill("2026-10-01");
    await panel.locator("[data-filter-action='apply']").click();
    await panel.locator("[data-filter-error]").waitFor({ state: "visible" });
    assert.equal(await panel.isVisible(), true);
    assert.equal(requestCount, 1, "invalid filter must not request or replace list data");
    const unchanged = await page.evaluate(() => {
      const app = window.referenceFixture;
      return {
        filters: app.filters.getBusinessListFilters(app.model, "goithau"),
        page: app.model.currentPage.goithau,
        count: app.selection.getBusinessListSelection(app.model, "goithau").count,
      };
    });
    assert.deepEqual(unchanged, { filters: baseline, page: 2, count: 1 });
    assert.deepEqual(app.errors, []);
  } finally {
    await app.close();
  }
});

test("contract reference options expose authorized history metadata and apply the selected exact version ID", async () => {
  const app = await fixture("hopdong");
  try {
    const { page } = app;
    const contractQueries = [];
    await page.route("**/api/paginate?**", async (route) => {
      const query = new URL(route.request().url()).searchParams;
      if (query.get("table") === "nhathau") {
        await route.fulfill(response([{
          id: "contractor-current", rootId: "contractor-root", phienBan: "02", isLatest: 1,
          maNhaThau: "NT-A", tenNhaThau: "Nhà thầu A",
          allVersions: [{ id: "contractor-current", phienBan: "02" }, { id: "contractor-history", phienBan: "01" }],
        }]));
      } else {
        contractQueries.push(Object.fromEntries(query));
        await route.fulfill(response([]));
      }
    });
    const panel = await addReferenceField(page, "hopdong", "nhaThauId");
    await panel.locator("[data-filter-options='0'] > summary").click();
    const historical = panel.locator("[data-filter-value='0'][value='contractor-history']");
    await historical.waitFor({ state: "visible", timeout: 5000 });
    assert.match(await historical.locator("..").textContent(), /01/u, "history option must identify its version");
    await historical.check();
    await panel.locator("[data-filter-action='apply']").click();
    await panel.waitFor({ state: "hidden" });
    const expected = [{ field: "nhaThauId", operator: "in", value: ["contractor-history"] }];
    assert.deepEqual(await page.evaluate(() => window.referenceFixture.filters.getBusinessListFilters(window.referenceFixture.model, "hopdong")), expected);
    assert.equal(contractQueries.length, 1);
    assert.deepEqual(JSON.parse(contractQueries[0].filters), expected);
    assert.deepEqual(app.errors, []);
  } finally {
    await app.close();
  }
});

test("cold contract assignee options load the workspace directory and keep readable assignment IDs absent from it", async () => {
  const app = await fixture("hopdong");
  try {
    const { page } = app;
    let requests = 0;
    await page.route("**/api/auth/users", async (route) => {
      requests += 1;
      await route.fulfill(directoryResponse([{ id: "employee-a", name: "Nguyễn A", email: "a@example.test" }]));
    });
    await page.evaluate(() => {
      const model = window.referenceFixture.model;
      model.state.hopdong = [{ id: "visible-contract", organizationId: "org-1" }];
      model.state.assignments = [
        { organizationId: "org-1", targetId: "visible-contract", type: "hopdong", empId: "inactive-assignee" },
        { organizationId: "org-1", targetId: "absent-contract", type: "hopdong", empId: "unread-target" },
        { organizationId: "org-1", targetId: "visible-contract", type: "goithau", empId: "other-type" },
      ];
    });
    const panel = await addReferenceField(page, "hopdong", "assigneeId");
    await panel.locator("[data-filter-options='0'] > summary").click();
    await panel.locator("[data-filter-value='0'][value='employee-a']").waitFor({ state: "visible", timeout: 5000 });
    assert.equal(requests, 1);
    assert.match(await panel.locator("[data-filter-value='0'][value='employee-a']").locator("..").textContent(), /Nguyễn A/u);
    const inactive = panel.locator("[data-filter-value='0'][value='inactive-assignee']");
    assert.equal(await inactive.count(), 1);
    assert.equal((await inactive.locator("..").textContent()).trim(), "inactive-assignee");
    assert.equal(await panel.locator("[data-filter-value='0'][value='unread-target']").count(), 0);
    assert.equal(await panel.locator("[data-filter-value='0'][value='other-type']").count(), 0);
    await panel.locator("[data-filter-option-search='0']").fill("nguyen");
    await panel.locator("[data-filter-value='0'][value='employee-a']").waitFor({ state: "visible" });
    assert.deepEqual(app.errors, []);
  } finally {
    await app.close();
  }
});

test("a late contract assignee response cannot render into a reopened draft generation", async () => {
  const app = await fixture("hopdong");
  try {
    const { page } = app;
    const requests = [];
    let resolveFirst;
    let resolveSecond;
    const firstRequest = new Promise((done) => { resolveFirst = done; });
    const secondRequest = new Promise((done) => { resolveSecond = done; });
    await page.route("**/api/auth/users", (route) => {
      requests.push(route);
      if (requests.length === 1) resolveFirst(route);
      else resolveSecond(route);
    });
    let panel = await addReferenceField(page, "hopdong", "assigneeId");
    await panel.locator("[data-filter-options='0'] > summary").click();
    const first = await firstRequest;
    await panel.locator("[data-filter-action='cancel']").last().click();
    await panel.waitFor({ state: "hidden" });
    panel = await addReferenceField(page, "hopdong", "assigneeId");
    await panel.locator("[data-filter-options='0'] > summary").click();
    const second = await secondRequest;
    await second.fulfill(directoryResponse([{ id: "current-generation", name: "Nhân sự mới" }]));
    await panel.locator("[data-filter-value='0'][value='current-generation']").waitFor({ state: "visible", timeout: 5000 });
    await first.fulfill(directoryResponse([{ id: "old-generation", name: "Nhân sự cũ" }]));
    await page.waitForFunction(() => window.referenceFixture.model._workspaceRequestControllers.size === 0);
    assert.deepEqual(await page.evaluate(() => window.referenceFixture.model.state.employees.map((row) => row.id)), ["current-generation"], "a stale popup request must not replace shared employee state");
    assert.equal(await panel.locator("[data-filter-value='0'][value='old-generation']").count(), 0);
    assert.equal(await panel.locator("[data-filter-value='0'][value='current-generation']").count(), 1);
    await panel.locator("[data-filter-option-search='0']").fill("nhan");
    assert.equal(await panel.locator("[data-filter-value='0'][value='old-generation']").count(), 0, "local search must retain the current directory generation");
    assert.equal(await panel.locator("[data-filter-value='0'][value='current-generation']").count(), 1);
    assert.deepEqual(app.errors, []);
  } finally {
    await app.close();
  }
});

test("a workspace change fences a delayed contract assignee directory response", async () => {
  const app = await fixture("hopdong");
  try {
    const { page } = app;
    let resolveRequest;
    const pendingRequest = new Promise((done) => { resolveRequest = done; });
    await page.route("**/api/auth/users", (route) => { resolveRequest(route); });
    const panel = await addReferenceField(page, "hopdong", "assigneeId");
    await panel.locator("[data-filter-options='0'] > summary").click();
    const route = await pendingRequest;
    await page.evaluate(async () => {
      const app = window.referenceFixture;
      app.model.workspaceScope = { key: "user-1:org-2", organizationId: "org-2" };
      app.model.state = { ...app.model.state, hopdong: [], assignments: [], employees: [] };
      await app.controls.ensureBusinessListControls(app.view, "hopdong");
    });
    await route.fulfill(directoryResponse([{ id: "old-tenant-employee", name: "Tổ chức cũ" }]));
    await page.waitForFunction(() => window.referenceFixture.model._workspaceRequestControllers.size === 0);
    assert.equal(await panel.isVisible(), false);
    assert.equal(await page.evaluate(() => window.referenceFixture.model.state.employees.length), 0);
    await page.locator("[data-list-filter='hopdong']").click();
    assert.equal(await panel.locator("[data-filter-condition]").count(), 0);
    assert.deepEqual(app.errors, []);
  } finally {
    await app.close();
  }
});
