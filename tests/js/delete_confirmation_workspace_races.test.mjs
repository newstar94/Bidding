import assert from "node:assert/strict";
import test from "node:test";
import DOMPurify from "dompurify";

import { BiddingModel } from "../../frontend/app/BiddingModel.js";
import { deleteHoSoGiayStatus, deleteEmployee } from "../../frontend/admin/AdminUserController.js";
import { deleteHopDong } from "../../frontend/contracts/HopDongWorkflow.js";
import { deleteChuyenGia } from "../../frontend/experts/ChuyenGiaWorkflow.js";
import { deleteKeHoach } from "../../frontend/plans/KeHoachWorkflow.js";
import { deleteChuDauTu } from "../../frontend/partners/ChuDauTuWorkflow.js";
import { deleteNhaThau } from "../../frontend/partners/NhaThauWorkflow.js";
import { restoreCanceledPackage } from "../../frontend/packages/packageRebidWorkflow.js";
import { renderPackageGoodsPanel } from "../../frontend/packages/PackageGoodsWorkflow.js";

function memoryStorage() {
  const values = new Map();
  return {
    getItem: (key) => values.get(key) ?? null,
    readJson: (key, fallback) => structuredClone(values.get(key) ?? fallback),
    writeJson: (key, value) => values.set(key, structuredClone(value)),
  };
}

for (const [table, remove] of [
  ["kehoach", deleteKeHoach],
  ["hopdong", deleteHopDong],
  ["chuyengia", deleteChuyenGia],
  ["chudautu", deleteChuDauTu],
  ["nhathau", deleteNhaThau],
  ["customcontractstatuses", deleteHoSoGiayStatus],
  ["employees", deleteEmployee],
  ["goithau", restoreCanceledPackage],
]) {
  test(`${table} confirmation cannot mutate or submit the newly selected workspace`, async (t) => {
    const record = { id: "record-a", rowVersion: 4, name: "Record A" };
    const otherRecord = { id: "record-b", rowVersion: 5, name: "Record B" };
    const model = new BiddingModel();
    model.workspaceScope = { key: "user:org-a", organizationId: "org-a" };
    model.workspaceStorage = memoryStorage();
    model.db = { stores: [table], async get() { return null; }, async set() {} };
    model.state.activerole = "manager";
    model.state[table] = [record];
    const events = [];
    model.persistChanges = async () => events.push("persist");
    model.persistData = async () => events.push("persist");
    let confirmDelete;
    let confirmationShown;
    const shown = new Promise((resolve) => { confirmationShown = resolve; });
    const confirmation = new Promise((resolve) => { confirmDelete = resolve; });
    const controller = {
      model,
      fetchRecordByLookup: async () => record,
      view: {
        customConfirm() { confirmationShown(); return confirmation; },
        renderKeHoachTable: async () => events.push("render"),
        renderGoiThauTable: async () => events.push("render"),
        renderHopDongTable: async () => events.push("render"),
        renderChuyenGiaTable: async () => events.push("render"),
        renderChuDauTuTable: async () => events.push("render"),
        renderNhaThauTable: async () => events.push("render"),
        renderManagerHoSoGiayPanel: async () => events.push("render"),
        renderManagerEmployeesPanel: async () => events.push("render"),
        customAlert: async () => events.push("alert"),
        showToast: () => events.push("toast"),
      },
      autoSync: async () => { events.push("sync"); return { ok: true }; },
      reloadEmployeesFromDatabase: async () => events.push("reload"),
    };
    const previousDocument = Object.getOwnPropertyDescriptor(globalThis, "document");
    Object.defineProperty(globalThis, "document", { configurable: true, value: {
      cookie: "csrf_token=test", getElementById: () => ({ value: "" }),
    } });
    t.mock.method(globalThis, "fetch", async () => {
      events.push("post");
      return { ok: true, json: async () => ({}) };
    });
    t.after(() => {
      if (previousDocument) Object.defineProperty(globalThis, "document", previousDocument);
      else delete globalThis.document;
    });
    const pending = remove.call(controller, record.id);
    await shown;
    model.workspaceScope = { key: "user:org-b", organizationId: "org-b" };
    model.workspaceStorage = memoryStorage();
    model._workspaceEpoch += 1;
    model.state[table] = [otherRecord];
    confirmDelete(true);
    await pending;
    assert.deepEqual(model.state[table], [otherRecord]);
    assert.equal(model.hasPendingMutationOutboxChanges(), false);
    assert.deepEqual(events, []);
  });
}

test("goods deletion confirmation cannot invoke a mutation in a newly selected workspace", async (t) => {
  const sanitizerDescriptors = new Map(["isSupported", "sanitize"].map((name) => (
    [name, Object.getOwnPropertyDescriptor(DOMPurify, name)]
  )));
  Object.defineProperty(DOMPurify, "isSupported", { configurable: true, value: true });
  Object.defineProperty(DOMPurify, "sanitize", { configurable: true, value: (value) => value });
  t.after(() => {
    for (const [name, descriptor] of sanitizerDescriptors) {
      if (descriptor) Object.defineProperty(DOMPurify, name, descriptor);
      else delete DOMPurify[name];
    }
  });
  const model = new BiddingModel();
  model.workspaceScope = { key: "user:org-a", organizationId: "org-a" };
  model.state.activerole = "manager";
  model.hasPermission = () => true;
  const events = [];
  model.deleteRecord = async () => events.push("delete");
  let confirmDelete;
  let deleteClicked;
  const confirmation = new Promise((resolve) => { confirmDelete = resolve; });
  const button = {
    dataset: { deleteGoods: "goods-a" },
    addEventListener: (_event, callback) => { deleteClicked = callback; },
  };
  const contentWrapper = {
    innerHTML: "",
    querySelector: () => null,
    querySelectorAll: (selector) => selector === "[data-delete-goods]" ? [button] : [],
  };
  const view = {
    model,
    customConfirm: () => confirmation,
    customAlert: async () => events.push("alert"),
    createIconsScoped: () => events.push("render"),
  };
  await renderPackageGoodsPanel(view, { contentWrapper, pkg: {
    id: "package-a", linhVuc: "Hàng hóa", trangThai: "Chuẩn bị", phanLo: "Không",
  } });
  events.length = 0;
  const pending = deleteClicked();
  model.workspaceScope = { key: "user:org-b", organizationId: "org-b" };
  model._workspaceEpoch += 1;
  confirmDelete(true);
  await pending;
  assert.deepEqual(events, []);
});
