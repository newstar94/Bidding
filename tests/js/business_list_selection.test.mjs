import assert from "node:assert/strict";
import test from "node:test";

import {
  clearBusinessListSelection,
  clearDeletedBusinessListSelections,
  getBusinessListSelection,
  isBusinessListRowSelected,
  reconcileBusinessListRowVersion,
  selectAllBusinessListResults,
  selectBusinessListPage,
  setBusinessListPage,
  toggleBusinessListRow,
} from "../../frontend/shared/BusinessListSelection.js";
import { bindPaginatedTableSearch } from "../../frontend/app/BiddingControllerForms.js";

const first = { id: "plan-v1", rootId: "plan-root", phienBan: "01" };
const second = { id: "plan-other", rootId: "plan-other", phienBan: "00" };

function modelFixture() {
  const model = {
    state: { activeuser: { id: "user-1" }, activerole: "manager" },
    workspaceScope: { key: "user-1:org-1", organizationId: "org-1" },
    token: "user-1:org-1@1",
    getWorkspaceToken() { return this.token; },
    workspaceStorage: { getItem: () => "visibility-1" },
    currentPage: { kehoach: 2 },
  };
  setBusinessListPage(model, "kehoach", {
    items: [first, second], totalItems: 12, query: { search: "thiết bị", filters: "[]", page: 1 },
  });
  return model;
}

test("explicit selection persists across pagination and sorting with exact version identities", () => {
  const model = modelFixture();
  toggleBusinessListRow(model, "kehoach", first, true);
  setBusinessListPage(model, "kehoach", {
    items: [second], totalItems: 12,
    query: { search: "thiết bị", filters: "[]", page: 2, pageSize: 25, cursor: "next", sortBy: "tenKeHoach", sortOrder: "desc" },
  });

  const descriptor = getBusinessListSelection(model, "kehoach");
  assert.equal(descriptor.count, 1);
  assert.deepEqual(descriptor.selectedVersions, [{ rootId: "plan-root", id: "plan-v1", version: "01" }]);
  assert.equal(isBusinessListRowSelected(model, "kehoach", first), true);
  assert.equal(isBusinessListRowSelected(model, "kehoach", second), false);
  assert.deepEqual(descriptor.query, { filters: [], search: "thiết bị" });
});

test("changing search, filter values or dashboard alert discards the earlier selection", () => {
  for (const query of [
    { search: "công trình", filters: "[]" },
    { search: "thiết bị", filters: [{ field: "loaiHinhMuaSam", operator: "in", value: ["Dự án"] }] },
    { search: "thiết bị", filters: "[]", alertKey: "closingSoon" },
  ]) {
    const model = modelFixture();
    toggleBusinessListRow(model, "kehoach", first, true);
    setBusinessListPage(model, "kehoach", { items: [first], totalItems: 1, query });
    assert.equal(getBusinessListSelection(model, "kehoach").count, 0);
  }
});

test("reordering equivalent filter fields and values keeps selection", () => {
  const model = modelFixture();
  const filters = [
    { field: "loaiHinhMuaSam", operator: "in", value: ["Dự án", "Dự toán mua sắm"] },
    { field: "tenKeHoach", operator: "contains", value: "thiết bị" },
  ];
  setBusinessListPage(model, "kehoach", { items: [first], totalItems: 1, query: { filters } });
  toggleBusinessListRow(model, "kehoach", first, true);
  const reordered = [filters[1], { ...filters[0], value: [...filters[0].value].reverse() }];
  setBusinessListPage(model, "kehoach", { items: [first], totalItems: 1, query: { filters: JSON.stringify(reordered), sortOrder: "desc" } });
  assert.equal(getBusinessListSelection(model, "kehoach").count, 1);
});

test("page checkbox changes only the supplied page and preserves selections from another page", () => {
  const model = modelFixture();
  toggleBusinessListRow(model, "kehoach", first, true);
  selectBusinessListPage(model, "kehoach", [second]);
  assert.equal(getBusinessListSelection(model, "kehoach").count, 2);
  selectBusinessListPage(model, "kehoach", [second], false);
  assert.equal(getBusinessListSelection(model, "kehoach").count, 1);
  assert.equal(isBusinessListRowSelected(model, "kehoach", first), true);
});

test("select all results represents unseen pages and tracks deselection exceptions", () => {
  const model = modelFixture();
  selectAllBusinessListResults(model, "kehoach", [first, second]);
  const unseen = { id: "plan-unseen", rootId: "plan-unseen", phienBan: "00" };
  assert.equal(isBusinessListRowSelected(model, "kehoach", unseen), true);
  toggleBusinessListRow(model, "kehoach", second, false);
  let descriptor = getBusinessListSelection(model, "kehoach");
  assert.equal(descriptor.mode, "query");
  assert.equal(descriptor.count, 11);
  assert.deepEqual(descriptor.excludedRootIds, ["plan-other"]);
  assert.equal(isBusinessListRowSelected(model, "kehoach", second), false);
  toggleBusinessListRow(model, "kehoach", second, true);
  descriptor = getBusinessListSelection(model, "kehoach");
  assert.equal(descriptor.count, 12);
  assert.deepEqual(descriptor.excludedRootIds, []);
});

test("deselecting the full filtered result clears query selection", () => {
  const model = modelFixture();
  setBusinessListPage(model, "kehoach", { items: [first, second], totalItems: 2, query: {} });
  selectAllBusinessListResults(model, "kehoach", [first, second]);
  selectBusinessListPage(model, "kehoach", [first, second], false);
  const descriptor = getBusinessListSelection(model, "kehoach");
  assert.equal(descriptor.mode, "explicit");
  assert.equal(descriptor.count, 0);
  assert.deepEqual(descriptor.excludedRootIds, []);
});

test("displaying a different version drops explicit selection without silently replacing it", () => {
  const model = modelFixture();
  const historical = { ...first, id: "plan-v0", phienBan: "00" };
  toggleBusinessListRow(model, "kehoach", first, true);
  assert.equal(reconcileBusinessListRowVersion(model, "kehoach", historical), true);
  assert.equal(getBusinessListSelection(model, "kehoach").count, 0);
  assert.equal(isBusinessListRowSelected(model, "kehoach", historical), false);
  toggleBusinessListRow(model, "kehoach", historical, true);
  assert.deepEqual(getBusinessListSelection(model, "kehoach").selectedVersions, [{ rootId: "plan-root", id: "plan-v0", version: "00" }]);
});

test("displaying a different version adds an exception to select all until explicitly checked", () => {
  const model = modelFixture();
  const historical = { ...first, id: "plan-v0", phienBan: "00" };
  selectAllBusinessListResults(model, "kehoach", [first, second]);
  assert.equal(reconcileBusinessListRowVersion(model, "kehoach", historical), true);
  assert.equal(getBusinessListSelection(model, "kehoach").count, 11);
  assert.equal(isBusinessListRowSelected(model, "kehoach", historical), false);
  toggleBusinessListRow(model, "kehoach", historical, true);
  const descriptor = getBusinessListSelection(model, "kehoach");
  assert.equal(descriptor.count, 12);
  assert.equal(descriptor.selectedVersions.find((row) => row.rootId === "plan-root").id, "plan-v0");
});

test("each business list and each model has independent checkbox selection", () => {
  const model = modelFixture();
  toggleBusinessListRow(model, "kehoach", first, true);
  toggleBusinessListRow(model, "goithau", { id: "package-1" }, true);
  clearBusinessListSelection(model, "kehoach");
  assert.equal(getBusinessListSelection(model, "kehoach").count, 0);
  assert.equal(getBusinessListSelection(model, "goithau").count, 1);
  assert.equal(getBusinessListSelection(model, "hopdong").count, 0);
  assert.equal(getBusinessListSelection(modelFixture(), "goithau").count, 0);
});

test("workspace, role, account, state and authorization revision changes clear selection", () => {
  for (const change of [
    (model) => { model.token = "user-1:org-2@1"; },
    (model) => { model.state.activerole = "employee"; },
    (model) => { model.state.activeuser = { id: "user-2" }; },
    (model) => { model.state = structuredClone(model.state); },
    (model) => { model.permissionRevision = "2"; },
    (model) => { model.assignmentRevision = "2"; },
    (model) => { model.recordScopeRevision = "2"; },
  ]) {
    const model = modelFixture();
    toggleBusinessListRow(model, "kehoach", first, true);
    change(model);
    assert.equal(getBusinessListSelection(model, "kehoach").count, 0);
  }
});

test("selection descriptors cannot mutate selection or the captured filter query", () => {
  const model = modelFixture();
  toggleBusinessListRow(model, "kehoach", first, true);
  const descriptor = getBusinessListSelection(model, "kehoach");
  descriptor.query.filters.push({ field: "tenKeHoach", operator: "contains", value: "changed" });
  descriptor.selectedVersions[0].id = "changed";
  descriptor.excludedRootIds.push("plan-root");
  const current = getBusinessListSelection(model, "kehoach");
  assert.deepEqual(current.query.filters, []);
  assert.equal(current.selectedVersions[0].id, first.id);
  assert.deepEqual(current.excludedRootIds, []);
});

test("search input clears selection synchronously before its delayed render", () => {
  const previousDocument = globalThis.document;
  const input = new EventTarget();
  input.value = "thiết bị";
  const model = modelFixture();
  let renders = 0;
  globalThis.document = { getElementById: () => input };
  try {
    const render = bindPaginatedTableSearch(model, { inputId: "search-kehoach", table: "kehoach", render: () => { renders += 1; } });
    toggleBusinessListRow(model, "kehoach", first, true);
    input.value = "THIẾT BỊ";
    input.dispatchEvent(new Event("input"));
    assert.equal(getBusinessListSelection(model, "kehoach").count, 1, "case alone leaves the effective query intact");
    input.value = "công trình";
    input.dispatchEvent(new Event("input"));
    assert.equal(getBusinessListSelection(model, "kehoach").count, 0);
    assert.equal(renders, 0, "selection is already clear while rendering is debounced");
    render.flush();
    assert.equal(renders, 1);
  } finally {
    globalThis.document = previousDocument;
  }
});

test("confirmed deletions clear only the affected business table selection", () => {
  const model = modelFixture();
  toggleBusinessListRow(model, "kehoach", first, true);
  toggleBusinessListRow(model, "goithau", { id: "package-1" }, true);
  toggleBusinessListRow(model, "hopdong", { id: "contract-1" }, true);
  const cleared = clearDeletedBusinessListSelections(model, {
    kehoach: [first.id], goithau: [], chudautu: ["investor-1"],
  });
  assert.deepEqual(cleared, ["kehoach"]);
  assert.equal(getBusinessListSelection(model, "kehoach").count, 0);
  assert.equal(getBusinessListSelection(model, "goithau").count, 1);
  assert.equal(getBusinessListSelection(model, "hopdong").count, 1);
});

test("confirmed deletion retires select-all exclusions instead of leaving an incorrect count", () => {
  const model = modelFixture();
  selectAllBusinessListResults(model, "kehoach", [first, second]);
  toggleBusinessListRow(model, "kehoach", second, false);
  clearDeletedBusinessListSelections(model, { kehoach: [{ id: second.id }] });
  const descriptor = getBusinessListSelection(model, "kehoach");
  assert.equal(descriptor.count, 0);
  assert.equal(descriptor.mode, "explicit");
  assert.deepEqual(descriptor.excludedRootIds, []);
});
