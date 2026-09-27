import test from "node:test";
import assert from "node:assert/strict";

import {
  capturePackageListContext,
  deletePackageView,
  readPackageSavedViews,
  rememberPackageListContext,
  renderPackageSavedViews,
  restorePackageListContext,
  savePackageView,
} from "../../frontend/packages/PackageListContext.js";

function select(options) {
  return {
    options: options.map(([value, label]) => ({ value, textContent: label })),
    value: "",
    replaceChildren(...children) { this.options = children; this.value = ""; },
    add(child) { this.options.push(child); },
    get selectedOptions() { return this.options.filter((option) => option.value === this.value); },
  };
}

function fixture() {
  const controls = new Map([
    ["search-goithau", { value: "" }],
    ["filter-goithau-trangthai", select([["", "Tất cả"], ["Đang mời thầu", "Đang mời thầu"]])],
    ["filter-goithau-hinhthuc", select([["", "Tất cả"], ["Đấu thầu rộng rãi", "Đấu thầu rộng rãi"]])],
    ["filter-goithau-nam", select([["", "Năm"], ["2026", "2026"]])],
    ["filter-goithau-thang", select([["", "Tháng"], ["9", "9"]])],
    ["goithau-saved-view", select([["", "Chọn chế độ xem"]])],
    ["goithau-update-view", { disabled: true }],
    ["goithau-delete-view", { disabled: true }],
  ]);
  globalThis.document = {
    getElementById: (id) => controls.get(id) || null,
    createElement: () => ({ textContent: "", value: "" }),
  };
  const scopedStorage = (scope) => {
    const data = new Map();
    return {
      scope,
      readJson: (key, fallback) => data.has(key) ? structuredClone(data.get(key)) : fallback,
      writeJson: (key, value) => data.set(key, structuredClone(value)),
    };
  };
  const model = {
    sortState: { goithau: { field: "maGoiThau", order: "asc" } },
    currentPage: { goithau: 1 },
    dashboardAlertFilter: "",
    dashboardAlertFilterLabel: "",
    workspaceStorage: scopedStorage("user-a:org-a"),
    workspaceSessionStorage: scopedStorage("user-a:org-a"),
  };
  return { controls, model, scopedStorage };
}

test("package list context restores scoped search, filters and page without URL state", () => {
  const { controls, model } = fixture();
  controls.get("search-goithau").value = "hồ sơ riêng";
  controls.get("filter-goithau-trangthai").value = "Đang mời thầu";
  model.currentPage.goithau = 3;
  rememberPackageListContext(model);
  const saved = model.workspaceSessionStorage.readJson("bf_package_list_context", null);
  assert.equal(saved.search, "hồ sơ riêng");
  controls.get("search-goithau").value = "";
  controls.get("filter-goithau-trangthai").value = "";
  model.currentPage.goithau = 1;
  restorePackageListContext(model, saved);
  assert.equal(controls.get("search-goithau").value, "hồ sơ riêng");
  assert.equal(controls.get("filter-goithau-trangthai").value, "Đang mời thầu");
  assert.equal(model.currentPage.goithau, 3);
});

test("personal saved views contain filters and sort, reject retired options, and stay in one workspace", () => {
  const { controls, model, scopedStorage } = fixture();
  controls.get("search-goithau").value = "CCCD 123";
  controls.get("filter-goithau-hinhthuc").value = "Đấu thầu rộng rãi";
  model.sortState.goithau = { field: "giaGoiThau", order: "desc" };
  savePackageView(model, "Theo hình thức", "view-1");
  const saved = readPackageSavedViews(model);
  assert.equal(saved.length, 1);
  assert.equal(saved[0].context.search, undefined);
  assert.equal(saved[0].context.sort.field, "giaGoiThau");
  assert.equal(controls.get("goithau-saved-view").value, "view-1");
  assert.equal(controls.get("goithau-update-view").disabled, false);

  const otherWorkspace = { ...model, workspaceStorage: scopedStorage("user-b:org-b") };
  assert.deepEqual(readPackageSavedViews(otherWorkspace), []);
  restorePackageListContext(model, {
    ...saved[0].context,
    filters: { ...saved[0].context.filters, status: "Đã bị loại bỏ" },
    sort: { field: "unsupported", order: "desc" },
  });
  assert.equal(controls.get("filter-goithau-trangthai").value, "");
  assert.equal(model.sortState.goithau.field, "giaGoiThau");

  deletePackageView(model, "view-1");
  renderPackageSavedViews(model);
  assert.deepEqual(readPackageSavedViews(model), []);
  assert.equal(controls.get("goithau-delete-view").disabled, true);
  assert.equal(capturePackageListContext(model, { includeSearch: false }).search, undefined);
});

test("a saved year remains usable before its page has loaded", () => {
  const { controls, model } = fixture();
  restorePackageListContext(model, {
    filters: { year: "2025", month: "12" },
    sort: { field: "maGoiThau", order: "asc" },
    page: 1,
  });
  assert.equal(controls.get("filter-goithau-nam").value, "2025");
  assert.equal(controls.get("filter-goithau-thang").value, "12");
  assert.equal(controls.get("filter-goithau-nam").options.at(-1).value, "2025");
  assert.equal(controls.get("filter-goithau-thang").options.at(-1).value, "12");
});
