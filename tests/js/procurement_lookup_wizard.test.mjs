import assert from "node:assert/strict";
import fs from "node:fs";
import test from "node:test";

import { ProcurementLookupClient } from "../../frontend/procurement/ProcurementLookupClient.js";
import {
  applyPackageDetails,
  applySelectedRows,
  buildComparisonRows,
} from "../../frontend/procurement/ProcurementLookupPreview.js";
import {
  ProcurementInlineLookup,
  originatePackageImportFlow,
  startProcurementPackageImport,
} from "../../frontend/procurement/ProcurementInlineLookup.js";
import { bindProcurementCodeAutoLookup } from "../../frontend/procurement/ProcurementAutoLookup.js";
import {
  hasServerCapability,
  invalidateServerCapabilities,
  PROCUREMENT_IMPORT_CAPABILITY,
  PROCUREMENT_LOOKUP_CAPABILITY,
  updateServerCapabilitiesFromSession,
} from "../../frontend/auth/serverCapabilities.js";

function deferred() {
  let resolve;
  let reject;
  const promise = new Promise((done, fail) => {
    resolve = done;
    reject = fail;
  });
  return { promise, resolve, reject };
}


test("lookup client sends only code and workspace lease with cancellation", async () => {
  const calls = [];
  const client = new ProcurementLookupClient({
    post: async (url, body, options) => {
      calls.push({ url, body, options });
      return { schemaVersion: "biddingflow-procurement-preview-v1" };
    },
  });
  const abortController = new AbortController();

  await client.lookup({
    code: " ib2600000001 ",
    workspaceLease: "org-1",
  }, { signal: abortController.signal });

  assert.equal(calls[0].url, "/api/procurement/lookup");
  assert.deepEqual(calls[0].body, {
    code: "IB2600000001",
    workspaceLease: "org-1",
  });
  assert.equal(calls[0].options.signal, abortController.signal);
  assert.equal(calls[0].options.retries, 0);
  assert.throws(
    () => client.lookup({
      code: "IB2600000001",
      workspaceLease: "org-1",
      browserMode: "research-stealth",
    }),
    /code.*workspaceLease/i,
  );
});


test("lookup client forwards explicit complete revision options", async () => {
  const calls = [];
  const client = new ProcurementLookupClient({
    post: async (url, payload, options) => {
      calls.push({ url, payload, options });
      return { found: true };
    },
  });

  await client.lookup({
    code: "pl2600244105",
    detailLevel: "complete",
    revisionMode: "all",
  });

  assert.deepEqual(calls[0].payload, {
    code: "PL2600244105",
    workspaceLease: null,
    detailLevel: "COMPLETE",
    revisionMode: "ALL",
  });
});


test("lookup controls follow the server-owned procurement capability", () => {
  invalidateServerCapabilities();
  updateServerCapabilitiesFromSession({
    valid: true,
    user: { id: "user-1" },
    serverCapabilities: ["procurement-lookup-v1"],
  });
  assert.equal(hasServerCapability("procurement-lookup-v1"), true);

  updateServerCapabilitiesFromSession({
    valid: true,
    user: { id: "user-1" },
    serverCapabilities: [],
  });
  assert.equal(hasServerCapability("procurement-lookup-v1"), false);
  invalidateServerCapabilities();
});


test("legacy import controls require their own server capability", () => {
  invalidateServerCapabilities();
  updateServerCapabilitiesFromSession({
    valid: true,
    user: { id: "user-1" },
    serverCapabilities: [PROCUREMENT_LOOKUP_CAPABILITY],
  });
  assert.equal(hasServerCapability(PROCUREMENT_LOOKUP_CAPABILITY), true);
  assert.equal(hasServerCapability(PROCUREMENT_IMPORT_CAPABILITY), false);

  updateServerCapabilitiesFromSession({
    valid: true,
    user: { id: "user-1" },
    serverCapabilities: [PROCUREMENT_IMPORT_CAPABILITY],
  });
  assert.equal(hasServerCapability(PROCUREMENT_LOOKUP_CAPABILITY), false);
  assert.equal(hasServerCapability(PROCUREMENT_IMPORT_CAPABILITY), true);
  invalidateServerCapabilities();
});


test("MSC checkbox looks up after code entry without duplicate blur requests", async () => {
  const codeInput = Object.assign(new EventTarget(), { value: "" });
  const checkbox = Object.assign(new EventTarget(), {
    checked: false,
    disabled: false,
  });
  const calls = [];
  let resolveLookup;
  bindProcurementCodeAutoLookup({
    codeInput,
    checkbox,
    runLookup: () => {
      calls.push(codeInput.value);
      return new Promise((resolve) => { resolveLookup = resolve; });
    },
  });

  codeInput.value = "PL2600000001";
  codeInput.dispatchEvent(new Event("blur"));
  assert.deepEqual(calls, []);

  checkbox.checked = true;
  checkbox.dispatchEvent(new Event("change"));
  codeInput.dispatchEvent(new Event("change"));
  codeInput.dispatchEvent(new Event("blur"));
  assert.deepEqual(calls, ["PL2600000001"]);

  resolveLookup({ applied: true });
  await Promise.resolve();
  await Promise.resolve();
  codeInput.dispatchEvent(new Event("blur"));
  assert.deepEqual(calls, ["PL2600000001"]);
});


test("failed MSC auto lookup can retry the same code", async () => {
  const codeInput = Object.assign(new EventTarget(), { value: "IB2600000001" });
  const checkbox = Object.assign(new EventTarget(), {
    checked: true,
    disabled: false,
  });
  let calls = 0;
  bindProcurementCodeAutoLookup({
    codeInput,
    checkbox,
    runLookup: async () => {
      calls += 1;
      return null;
    },
  });

  codeInput.dispatchEvent(new Event("change"));
  await Promise.resolve();
  await Promise.resolve();
  codeInput.dispatchEvent(new Event("blur"));
  await Promise.resolve();
  await Promise.resolve();

  assert.equal(calls, 2);
});


function control(value = "", options = null) {
  const events = [];
  return {
    value,
    options: options?.map((optionValue) => ({ value: optionValue })) || undefined,
    dispatchEvent(event) { events.push(event.type); },
    events,
  };
}


test("package preview protects existing draft values and rejects unknown enums", () => {
  const controls = new Map([
    ["gt-ma", control("")],
    ["gt-ten", control("Tên nội bộ")],
    ["gt-gia", control("")],
    ["gt-linhvuc", control("Tư vấn", ["Tư vấn", "Hàng hóa", "Xây lắp"])],
    ["gt-hinhthuc", control("Đấu thầu rộng rãi", ["Đấu thầu rộng rãi"])],
  ]);
  const rows = buildComparisonRows("PACKAGE", {
    notifyNo: "IB2600000002",
    bidName: "Gói B",
    bidPrice: 2_000_000_000,
    bidField: "HH",
    bidForm: "UNKNOWN_FORM",
  }, { getControl: (id) => controls.get(id) || null });

  const byField = Object.fromEntries(rows.map((row) => [row.field, row]));
  assert.equal(byField.notifyNo.apply, true);
  assert.equal(byField.bidName.apply, false);
  assert.equal(byField.bidPrice.draftValue, "2.000.000.000");
  assert.equal(byField.bidField.draftValue, "Hàng hóa");
  assert.equal(byField.bidForm.draftValue, null);
  assert.match(byField.bidForm.warning, /không nhận diện/i);
});

test("plan and package previews skip malformed source dates", () => {
  const planDate = control("");
  const packageDate = control("");
  const planRows = buildComparisonRows("PLAN", {
    decisionDate: "31/02/2026",
  }, { getControl: (id) => (id === "kh-ngaypheduyet" ? planDate : null) });
  const packageRows = buildComparisonRows("PACKAGE", {
    bidCloseDate: "2026-13-40T99:99:00",
  }, { getControl: (id) => (id === "gt-thoigiandongthau" ? packageDate : null) });

  const planMapped = planRows.find((row) => row.field === "decisionDate");
  const packageMapped = packageRows.find((row) => row.field === "bidCloseDate");
  assert.equal(planMapped.draftValue, null);
  assert.equal(planMapped.apply, false);
  assert.equal(packageMapped.draftValue, null);
  assert.equal(packageMapped.apply, false);
});


test("package preview maps Mua Sam Cong TG contract code", () => {
  const contract = control("", ["Trọn gói", "Theo đơn giá cố định"]);
  const rows = buildComparisonRows("PACKAGE", {
    contractType: "TG",
  }, { getControl: (id) => (id === "gt-loaihopdong" ? contract : null) });
  const mapped = rows.find((row) => row.field === "contractType");

  assert.equal(mapped.sourceValue, "Trọn gói");
  assert.equal(mapped.draftValue, "Trọn gói");
  assert.equal(mapped.warning, null);
  assert.equal(mapped.apply, true);
});


test("package preview maps current Mua Sam Cong catalog codes", () => {
  const controls = new Map([
    ["gt-hinhthuc", control("", ["Lựa chọn nhà thầu trong trường hợp đặc biệt"])],
    ["gt-loaihopdong", control("", ["Theo đơn giá cố định"])],
  ]);
  const rows = buildComparisonRows("PACKAGE", {
    bidForm: "LCNT_DB",
    contractType: "DGCD",
  }, { getControl: (id) => controls.get(id) || null });
  const mapped = Object.fromEntries(rows.map((row) => [row.field, row]));

  assert.equal(
    mapped.bidForm.draftValue,
    "Lựa chọn nhà thầu trong trường hợp đặc biệt",
  );
  assert.equal(mapped.contractType.draftValue, "Theo đơn giá cố định");
});


test("package preview maps bid guarantee into the package form", () => {
  const guarantee = control("");
  const rows = buildComparisonRows("PACKAGE", {
    bidGuarantee: 28_000_000,
  }, {
    getControl: (id) => (id === "gt-giatribaomothau" ? guarantee : null),
  });
  const mapped = rows.find((row) => row.field === "bidGuarantee");

  assert.equal(mapped.controlId, "gt-giatribaomothau");
  assert.equal(mapped.draftValue, "28.000.000");
  assert.equal(mapped.apply, true);
});


test("package preview maps the Mua Sam Cong online mode", () => {
  const onlineMode = control("", ["Qua mạng", "Không qua mạng"]);
  const rows = buildComparisonRows("PACKAGE", {
    onlineMode: "Không qua mạng",
  }, {
    getControl: (id) => (id === "gt-quatmang" ? onlineMode : null),
  });
  const mapped = rows.find((row) => row.field === "onlineMode");

  assert.equal(mapped.controlId, "gt-quatmang");
  assert.equal(mapped.draftValue, "Không qua mạng");
  assert.equal(mapped.apply, true);
});


test("package preview maps linked plan scheduling fields", () => {
  const controls = new Map([
    ["gt-tuychonmuathem", control("Không", ["Không", "Có"])],
    ["gt-thoigiantochuc", control("")],
    ["gt-thoigianbatdautochuc", control("")],
  ]);
  const rows = buildComparisonRows("PACKAGE", {
    additionalPurchaseOption: true,
    selectionDuration: "45 ngày",
    selectionStart: "Quý II/2026",
  }, { getControl: (id) => controls.get(id) || null });
  const mapped = Object.fromEntries(rows.map((row) => [row.field, row]));

  assert.equal(mapped.additionalPurchaseOption.draftValue, "Có");
  assert.equal(mapped.selectionDuration.draftValue, "45 ngày");
  assert.equal(mapped.selectionStart.draftValue, "Quý II/2026");
});


test("package preview maps the normalized E-HSMT evaluation method", () => {
  const evaluationMethod = control("", [
    "Giá thấp nhất",
    "Giá đánh giá",
    "Giá cố định",
    "Kết hợp giữa kỹ thuật và giá",
    "Dựa trên kỹ thuật",
  ]);
  const rows = buildComparisonRows("PACKAGE", {
    evaluationMethod: "Giá đánh giá",
  }, {
    getControl: (id) => (
      id === "gt-phuongphapdanhgia" ? evaluationMethod : null
    ),
  });
  const mapped = rows.find((row) => row.field === "evaluationMethod");

  assert.equal(mapped.controlId, "gt-phuongphapdanhgia");
  assert.equal(mapped.draftValue, "Giá đánh giá");
  assert.equal(mapped.apply, true);
});


test("inline package lookup fills bid guarantee without saving", async () => {
  const previousDocument = globalThis.document;
  const identity = { value: "package-a" };
  const form = {
    querySelector: (selector) => (selector === "input[type='hidden']" ? identity : null),
  };
  const code = control("IB2600000002");
  const guarantee = control("");
  const button = inlineButton();
  const status = inlineStatus();
  const controls = {
    "form-goithau": form,
    "gt-ma": code,
    "gt-giatribaomothau": guarantee,
    "btn-open-procurement-lookup-package": button,
    "procurement-lookup-package-status": status,
  };
  const document = { getElementById: (id) => controls[id] || null };
  const controller = {
    model: {
      getWorkspaceToken: () => "org-1",
      formatVND: (value) => new Intl.NumberFormat("vi-VN").format(value),
    },
  };
  controller.startProcurementPackageImport = startProcurementPackageImport.bind(controller);
  const lookup = new ProcurementInlineLookup({
    controller,
    importClient: {
      async prepareNotice() {
        return {
          importSession: {
            sessionId: "session-package",
            revisions: [{ revisionNumber: "00" }],
          },
        };
      },
      async getPlanRevisionDraft() {
        return {
          revisionNumber: "00",
          packageDrafts: [{
            maGoiThau: "IB2600000002",
            giaTriBaoDamDuThau: 28_000_000,
            sourceRevision: { revisionNumber: "00" },
          }],
        };
      },
    },
    client: { async lookup() { assert.fail("must use sequential session"); } },
    document,
  });

  globalThis.document = document;
  let result;
  try {
    result = await lookup.run({
      kind: "PACKAGE",
      formId: "form-goithau",
      codeInputId: "gt-ma",
      buttonId: "btn-open-procurement-lookup-package",
      statusId: "procurement-lookup-package-status",
    });
  } finally {
    if (previousDocument === undefined) delete globalThis.document;
    else globalThis.document = previousDocument;
  }

  assert.equal(guarantee.value, "28.000.000");
  assert.equal(result.revisionNumber, "00");
  assert.match(status.textContent, /dữ liệu chưa được lưu/i);
});


test("inline package import materializes source goods before the package form is saved", async () => {
  const previousDocument = globalThis.document;
  const identity = { value: "package-a" };
  const form = {
    querySelector: (selector) => (
      selector === "input[type='hidden']" ? identity : null
    ),
  };
  const lotRows = [];
  const document = {
    getElementById(id) {
      if (id === "form-goithau") return form;
      return null;
    },
  };
  const state = {
    goithau: [{ id: "package-a", phanLo: "", phanLoList: [] }],
    goithauhanghoa: [],
  };
  state.goithau[0].phanLo = String.fromCharCode(67, 195, 179);
  const controller = {
    model: {
      state, db: {}, workspaceStorage: { setItem() {}, getItem() {}, removeItem() {} },
      workspaceScope: { key: "org-1" }, getWorkspaceToken: () => "org-1",
    },
    _loadPhanLoRows: (rows) => lotRows.push(...rows),
    _loadTuyChonMuaThemRows: () => undefined,
  };

  globalThis.document = document;
  try {
    await startProcurementPackageImport.call(controller, originatePackageImportFlow(controller, {
      currentDraft: {
        revisionNumber: "00",
        packageDrafts: [{
          maGoiThau: "IB2600271825",
          phanLo: true,
          danhSachPhanLo: [{ maPhanLo: "PP1", tenPhanLo: "Lot 1" }],
          danhSachHangHoa: [{
            maPhanLo: "PP1", tenPhanLo: "Lot 1",
            maHangHoa: "1", tenHangHoa: "Goods A",
            donViTinh: "Box", soLuong: 2,
          }],
          sourceRevision: { revisionNumber: "00" },
        }],
      },
      session: { sessionId: "session-package" },
      controller: { revisions: [] },
    }));
  } finally {
    if (previousDocument === undefined) delete globalThis.document;
    else globalThis.document = previousDocument;
  }

  assert.equal(lotRows.length, 1);
  assert.equal(state.goithauhanghoa.length, 1);
  assert.equal(state.goithauhanghoa[0].goiThauId, "package-a");
  assert.equal(
    state.goithauhanghoa[0].phanLoId,
    state.goithau[0].phanLoList[0].id,
  );
});

test("package flow start rejects an origin capability from a previous workspace", async () => {
  const controller = {
    model: {
      state: {}, db: { name: "db-b" }, workspaceStorage: { name: "storage-b" },
      workspaceScope: { key: "org-b" }, getWorkspaceToken: () => "org-b@1",
    },
  };
  const origin = {
    ...controller.model,
    db: { name: "db-a" },
    workspaceStorage: { name: "storage-a" },
    workspaceScope: { key: "org-a" },
    getWorkspaceToken: () => "org-a@1",
  };
  const flow = originatePackageImportFlow({ model: origin }, {
    session: { sessionId: "session-a" },
    controller: { revisions: [] },
    currentDraft: { revisionNumber: "00", packageDrafts: [{ maGoiThau: "IB2600000001" }] },
  });

  await assert.rejects(
    startProcurementPackageImport.call(controller, flow),
    (error) => error?.code === "WORKSPACE_CHANGED",
  );
  assert.equal(controller.procurementPackageImport, undefined);
});

test("package flow start rejects a replaced session in the same workspace", async () => {
  const controller = {
    model: {
      state: {}, db: { name: "db-a" }, workspaceStorage: { name: "storage-a" },
      workspaceScope: { key: "org-a" }, getWorkspaceToken: () => "org-a@1",
    },
  };
  const activeFlow = originatePackageImportFlow(controller, {
    session: { sessionId: "session-new" },
    controller: { revisions: [] },
    currentDraft: { revisionNumber: "00", packageDrafts: [{ maGoiThau: "IB2600000002" }] },
  });
  controller.procurementPackageImport = activeFlow;
  const staleFlow = originatePackageImportFlow(controller, {
    session: { sessionId: "session-old" },
    controller: { revisions: [] },
    currentDraft: { revisionNumber: "00", packageDrafts: [{ maGoiThau: "IB2600000001" }] },
  });

  await assert.rejects(
    startProcurementPackageImport.call(controller, staleFlow),
    (error) => error?.code === "FLOW_CHANGED",
  );
  assert.equal(controller.procurementPackageImport, activeFlow);
});

test("package details select medicine and multi-lot then load authoritative lots", () => {
  const medicineYes = control("1");
  medicineYes.checked = false;
  const multiLot = control("Không", ["Không", "Có"]);
  const packagePrice = control("987.654.321");
  const packageGuarantee = control("9.000.000");
  const originalMultiLotDispatch = multiLot.dispatchEvent.bind(multiLot);
  multiLot.dispatchEvent = (event) => {
    originalMultiLotDispatch(event);
    if (event.type === "change") packagePrice.value = "0";
  };
  const loaded = [];
  const document = {
    getElementById(id) {
      return {
        "gt-phanlo": multiLot,
        "gt-gia": packagePrice,
        "gt-giatribaomothau": packageGuarantee,
      }[id] || null;
    },
    querySelector(selector) {
      return selector === 'input[name="gt-goithauthuoc"][value="1"]'
        ? medicineYes
        : null;
    },
  };

  const result = applyPackageDetails({
    isMedicinePackage: true,
    isMultiLot: true,
    lots: [
      {
        lotNo: "PP2600000001",
        lotName: "Thuốc A",
        lotPrice: 400_000_000,
        bidGuarantee: 4_000_000,
        executionPeriod: "220 ngày",
      },
      {
        lotNo: "PP2600000002",
        lotName: "Thuốc B",
        lotPrice: 587_654_321,
        bidGuarantee: 5_000_000,
        executionPeriod: "220 ngày",
      },
    ],
  }, {
    document,
    controller: {
      _loadPhanLoRows(rows) {
        loaded.push(...rows);
        packagePrice.value = "0";
        packageGuarantee.value = "0";
      },
    },
  });

  assert.equal(medicineYes.checked, true);
  assert.deepEqual(medicineYes.events, ["input", "change"]);
  assert.equal(multiLot.value, "Có");
  assert.deepEqual(multiLot.events, ["input", "change"]);
  assert.equal(packagePrice.value, "987.654.321");
  assert.equal(packageGuarantee.value, "9.000.000");
  assert.deepEqual(loaded, [
    {
      maPhanLo: "PP2600000001",
      tenPhanLo: "Thuốc A",
      giaTriPhanLo: 400_000_000,
      baoDamDuThau: 4_000_000,
      thoiGianThucHien: "220 ngày",
    },
    {
      maPhanLo: "PP2600000002",
      tenPhanLo: "Thuốc B",
      giaTriPhanLo: 587_654_321,
      baoDamDuThau: 5_000_000,
      thoiGianThucHien: "220 ngày",
    },
  ]);
  assert.deepEqual(result, { applied: 4, skipped: 0 });
});


test("plan investor maps only by exact existing option text", () => {
  const investor = control("");
  investor.options = [
    { value: "", textContent: "-- Chọn Chủ đầu tư --" },
    { value: "investor-1", textContent: "Chủ đầu tư nội bộ" },
  ];
  const rows = buildComparisonRows("PLAN", {
    investorName: "Chủ đầu tư nội bộ",
  }, { getControl: (id) => (id === "kh-chudautuid" ? investor : null) });
  const matched = rows.find((row) => row.field === "investorCode");

  assert.equal(matched.sourceValue, "Chủ đầu tư nội bộ");
  assert.equal(matched.draftValue, "investor-1");
  assert.equal(matched.apply, true);

  const unmatchedRows = buildComparisonRows("PLAN", {
    investorName: "Tên gần giống nhưng không trùng",
  }, { getControl: (id) => (id === "kh-chudautuid" ? investor : null) });
  const unmatched = unmatchedRows.find((row) => row.field === "investorCode");
  assert.equal(unmatched.draftValue, null);
  assert.match(unmatched.warning, /khớp chính xác/i);
});


test("plan investor prefers the normalized creator code over its name", () => {
  const investor = control("");
  investor.options = [
    { value: "", textContent: "-- Chọn Chủ đầu tư --", dataset: {} },
    {
      value: "investor-by-name",
      textContent: "Chủ đầu tư nguồn",
      dataset: { investorCode: "OTHER-CODE" },
    },
    {
      value: "investor-by-code",
      textContent: "Tên chủ đầu tư nội bộ",
      dataset: { investorCode: "INV-CREATOR" },
    },
  ];
  const rows = buildComparisonRows("PLAN", {
    investorCode: "INV-CREATOR",
    investorName: "Chủ đầu tư nguồn",
  }, { getControl: (id) => (id === "kh-chudautuid" ? investor : null) });
  const matched = rows.find((row) => row.field === "investorCode");

  assert.equal(matched.draftValue, "investor-by-code");
  assert.equal(matched.warning, null);
});


test("plan preview carries the source total investment into the draft field", () => {
  const total = control("");
  const rows = buildComparisonRows("PLAN", {
    totalInvestment: 3_000_000_000,
  }, { getControl: (id) => (id === "kh-tongmuc" ? total : null) });
  const mapped = rows.find((row) => row.field === "totalInvestment");

  assert.equal(mapped.sourceValue, "3.000.000.000");
  assert.equal(mapped.draftValue, "3.000.000.000");
  assert.equal(mapped.apply, true);
});


test("plan preview applies the normalized Bidding plan type", () => {
  const planType = control("", ["Dự án", "Dự toán mua sắm"]);
  const rows = buildComparisonRows("PLAN", {
    planType: "Dự án",
    sourcePlanType: "DTPT",
  }, { getControl: (id) => (id === "kh-loaihinh" ? planType : null) });
  const mapped = rows.find((row) => row.field === "planType");

  assert.equal(mapped.sourceValue, "Dự án");
  assert.equal(mapped.draftValue, "Dự án");
  assert.equal(mapped.warning, null);
  assert.equal(mapped.apply, true);
});


test("apply mutates only selected controls and never submits the form", () => {
  const name = control("Tên nội bộ");
  const price = control("");
  let submitCount = 0;
  const document = {
    getElementById(id) {
      return { "gt-ten": name, "gt-gia": price }[id] || null;
    },
  };
  const rows = [
    { controlId: "gt-ten", draftValue: "Tên nguồn", apply: false },
    { controlId: "gt-gia", draftValue: "2.000.000.000", apply: true },
  ];

  const result = applySelectedRows(rows, { document, onSubmit: () => { submitCount += 1; } });

  assert.equal(name.value, "Tên nội bộ");
  assert.equal(price.value, "2.000.000.000");
  assert.deepEqual(price.events, ["input", "change"]);
  assert.deepEqual(result, { applied: 1, skipped: 1 });
  assert.equal(submitCount, 0);
});


function inlineButton() {
  return {
    textContent: "Lấy dữ liệu tự động",
    disabled: false,
    dataset: {},
    setAttribute() {},
    removeAttribute() {},
  };
}


function inlineStatus() {
  return {
    textContent: "",
    hidden: true,
    dataset: {},
    setAttribute(name, value) { this[name] = value; },
  };
}

function inlineLoading() {
  const code = { hidden: true, textContent: "" };
  return {
    hidden: true,
    attributes: new Map(),
    code,
    querySelector(selector) {
      return selector === "[data-procurement-loading-code]" ? code : null;
    },
    setAttribute(name, value) { this.attributes.set(name, String(value)); },
  };
}


test("inline MSC lookup shows and closes its loading screen", async () => {
  let resolvePrepare;
  const identity = { value: "plan-loading" };
  const form = {
    attributes: new Map(),
    querySelector: (selector) => (selector === "input[type='hidden']" ? identity : null),
    setAttribute(name, value) { this.attributes.set(name, String(value)); },
    removeAttribute(name) { this.attributes.delete(name); },
  };
  const code = control("PL2600000001");
  const trigger = inlineButton();
  const status = inlineStatus();
  const loading = inlineLoading();
  const controls = {
    "form-kehoach": form,
    "kh-ma": code,
    "procurement-lookup-plan-enabled": trigger,
    "procurement-lookup-plan-status": status,
    "procurement-lookup-plan-loading": loading,
  };
  const lookup = new ProcurementInlineLookup({
    controller: {
      model: { getWorkspaceToken: () => "org-1" },
      async startProcurementPlanImport() {},
    },
    importClient: {
      preparePlan: () => new Promise((resolve) => { resolvePrepare = resolve; }),
      async getPlanRevisionDraft() {
        return { revisionNumber: "00", planDraft: {}, packageDrafts: [] };
      },
    },
    client: { async lookup() { assert.fail("must use sequential session"); } },
    document: { getElementById: (id) => controls[id] || null },
  });
  const phases = [];
  const setStatus = lookup.setStatus.bind(lookup);
  lookup.setStatus = (element, message, state) => {
    phases.push(message);
    setStatus(element, message, state);
  };

  const pending = lookup.run({
    kind: "PLAN",
    formId: "form-kehoach",
    codeInputId: "kh-ma",
    triggerId: "procurement-lookup-plan-enabled",
    statusId: "procurement-lookup-plan-status",
  });

  assert.equal(loading.hidden, false);
  assert.equal(loading.attributes.get("aria-busy"), "true");
  assert.equal(loading.code.hidden, false);
  assert.equal(loading.code.textContent, "PL2600000001");
  assert.equal(form.attributes.get("aria-busy"), "true");
  assert.equal(phases[0], "Đang lấy dữ liệu tự động…");

  resolvePrepare({
    importSession: {
      sessionId: "session-loading",
      revisions: [{ revisionNumber: "00" }],
    },
  });
  await pending;

  assert.deepEqual(phases.slice(0, 3), [
    "Đang lấy dữ liệu tự động…",
    "Đang tìm phiên bản hồ sơ…",
    "Đang chuẩn bị bản xem trước…",
  ]);

  assert.equal(loading.hidden, true);
  assert.equal(loading.attributes.get("aria-busy"), "false");
  assert.equal(form.attributes.has("aria-busy"), false);
  assert.equal(trigger.disabled, false);
});

test("inline plan lookup closes loading after its valid flow handoff changes form identity", async () => {
  const identity = { value: "" };
  const form = {
    attributes: new Map(),
    querySelector: (selector) => (selector === "input[type='hidden']" ? identity : null),
    setAttribute(name, value) { this.attributes.set(name, String(value)); },
    removeAttribute(name) { this.attributes.delete(name); },
  };
  const code = control("PL2600225773");
  const trigger = inlineButton();
  trigger.type = "checkbox";
  const status = inlineStatus();
  const loading = inlineLoading();
  const workspaceStorage = {};
  const controls = {
    "form-kehoach": form,
    "kh-ma": code,
    "procurement-lookup-plan-enabled": trigger,
    "procurement-lookup-plan-status": status,
    "procurement-lookup-plan-loading": loading,
  };
  const controller = {
    model: {
      workspaceStorage,
      getWorkspaceToken: () => "org-1",
    },
    async startProcurementPlanImport(flow) {
      identity.value = "kh-materialized";
      this.procurementPlanImport = { ...flow };
    },
  };
  const lookup = new ProcurementInlineLookup({
    controller,
    importClient: {
      async preparePlan() {
        return {
          importSession: {
            sessionId: "session-materialized",
            revisions: [{ revisionNumber: "00" }],
          },
        };
      },
      async getPlanRevisionDraft() {
        return { revisionNumber: "00", planDraft: {}, packageDrafts: [] };
      },
    },
    document: { getElementById: (id) => controls[id] || null },
  });

  const result = await lookup.run({
    kind: "PLAN",
    formId: "form-kehoach",
    codeInputId: "kh-ma",
    triggerId: "procurement-lookup-plan-enabled",
    statusId: "procurement-lookup-plan-status",
  });

  assert.deepEqual(result, { applied: true, revisionNumber: "00" });
  assert.equal(loading.hidden, true);
  assert.equal(loading.attributes.get("aria-busy"), "false");
  assert.equal(form.attributes.has("aria-busy"), false);
  assert.equal(trigger.disabled, false);
  assert.equal(status.dataset.state, "success");
});

test("inline_plan_post_durable_handoff_failure_preserves_recovery_flow_and_resets_loading", async () => {
  const identity = { value: "" };
  const form = {
    attributes: new Map(),
    querySelector: (selector) => (selector === "input[type='hidden']" ? identity : null),
    setAttribute(name, value) { this.attributes.set(name, String(value)); },
    removeAttribute(name) { this.attributes.delete(name); },
  };
  const code = control("PL2600225773");
  const trigger = inlineButton();
  const status = inlineStatus();
  const loading = inlineLoading();
  const workspaceStorage = {};
  const controls = {
    "form-kehoach": form, "kh-ma": code,
    "procurement-lookup-plan-enabled": trigger,
    "procurement-lookup-plan-status": status,
    "procurement-lookup-plan-loading": loading,
  };
  const controller = {
    model: { workspaceStorage, getWorkspaceToken: () => "org-1" },
    async startProcurementPlanImport(flow) {
      identity.value = "durable-plan";
      this.procurementPlanImport = {
        ...flow, pendingNextUiRecovery: { planId: "durable-plan" },
      };
      const error = new Error("Không thể mở biểu mẫu sau durable point");
      error.procurementMaterializationDurable = true;
      throw error;
    },
  };
  const lookup = new ProcurementInlineLookup({
    controller,
    importClient: {
      async preparePlan() {
        return { importSession: {
          sessionId: "session-durable", revisions: [{ revisionNumber: "00" }],
        } };
      },
      async getPlanRevisionDraft() {
        return { revisionNumber: "00", planDraft: {}, packageDrafts: [] };
      },
    },
    document: { getElementById: (id) => controls[id] || null },
  });

  const result = await lookup.run({
    kind: "PLAN", formId: "form-kehoach", codeInputId: "kh-ma",
    triggerId: "procurement-lookup-plan-enabled",
    statusId: "procurement-lookup-plan-status",
  });

  assert.equal(result, null);
  assert.equal(controller.procurementPlanImport.pendingNextUiRecovery.planId, "durable-plan");
  assert.equal(status.dataset.state, "error");
  assert.equal(loading.hidden, true);
  assert.equal(form.attributes.has("aria-busy"), false);
  assert.equal(trigger.disabled, false);
});

test("old_inline_flow_failure_cannot_reset_new_flow_loading", async () => {
  const handoff = deferred();
  const startEntered = deferred();
  const identity = { value: "" };
  const form = {
    attributes: new Map(),
    querySelector: (selector) => (selector === "input[type='hidden']" ? identity : null),
    setAttribute(name, value) { this.attributes.set(name, String(value)); },
    removeAttribute(name) { this.attributes.delete(name); },
  };
  const code = control("PL2600225773");
  const trigger = inlineButton();
  const status = inlineStatus();
  const loading = inlineLoading();
  const workspaceStorage = {};
  const controls = {
    "form-kehoach": form, "kh-ma": code,
    "procurement-lookup-plan-enabled": trigger,
    "procurement-lookup-plan-status": status,
    "procurement-lookup-plan-loading": loading,
  };
  const controller = {
    model: { workspaceStorage, getWorkspaceToken: () => "org-1" },
    async startProcurementPlanImport(flow) {
      identity.value = "plan-a";
      this.procurementPlanImport = { ...flow };
      startEntered.resolve();
      return handoff.promise;
    },
  };
  const lookup = new ProcurementInlineLookup({
    controller,
    importClient: {
      async preparePlan() {
        return { importSession: {
          sessionId: "session-a", revisions: [{ revisionNumber: "00" }],
        } };
      },
      async getPlanRevisionDraft() {
        return { revisionNumber: "00", planDraft: {}, packageDrafts: [] };
      },
    },
    document: { getElementById: (id) => controls[id] || null },
  });
  const pending = lookup.run({
    kind: "PLAN", formId: "form-kehoach", codeInputId: "kh-ma",
    triggerId: "procurement-lookup-plan-enabled",
    statusId: "procurement-lookup-plan-status",
  });
  await startEntered.promise;
  controller.procurementPlanImport = { importFlowIdentity: Object.freeze({}) };
  identity.value = "plan-b";
  trigger.disabled = true;
  trigger.textContent = "B đang nhập";
  loading.hidden = false;
  loading.setAttribute("aria-busy", "true");
  form.setAttribute("aria-busy", "true");
  status.textContent = "Luồng B đang chạy";
  status.dataset.state = "loading";
  handoff.reject(new Error("Lỗi muộn của A"));
  await pending;

  assert.equal(status.textContent, "Luồng B đang chạy");
  assert.equal(status.dataset.state, "loading");
  assert.equal(trigger.disabled, true);
  assert.equal(loading.hidden, false);
  assert.equal(form.attributes.get("aria-busy"), "true");
});

test("inline stale workspace completion cannot reset or overwrite the new UI", async () => {
  let resolvePrepare;
  let token = "org-a@1";
  const identity = { value: "plan-a" };
  const form = {
    attributes: new Map(),
    querySelector: (selector) => (selector === "input[type='hidden']" ? identity : null),
    setAttribute(name, value) { this.attributes.set(name, String(value)); },
    removeAttribute(name) { this.attributes.delete(name); },
  };
  const code = control("PL2600000001");
  const button = inlineButton();
  const status = inlineStatus();
  const loading = inlineLoading();
  const model = {
    state: {}, db: {}, workspaceStorage: {}, workspaceScope: { key: "org-a" },
    getWorkspaceToken: () => token,
  };
  const controls = {
    "form-kehoach": form,
    "kh-ma": code,
    "procurement-lookup-plan-enabled": button,
    "procurement-lookup-plan-status": status,
    "procurement-lookup-plan-loading": loading,
  };
  const lookup = new ProcurementInlineLookup({
    controller: { model, async startProcurementPlanImport() {} },
    importClient: {
      preparePlan: () => new Promise((resolve) => { resolvePrepare = resolve; }),
    },
    document: { getElementById: (id) => controls[id] || null },
  });

  const pending = lookup.run({
    kind: "PLAN",
    formId: "form-kehoach",
    codeInputId: "kh-ma",
    triggerId: "procurement-lookup-plan-enabled",
    statusId: "procurement-lookup-plan-status",
  });
  token = "org-b@1";
  model.state = {};
  model.db = {};
  model.workspaceStorage = {};
  model.workspaceScope = { key: "org-b" };
  identity.value = "plan-b";
  code.value = "PL2600000002";
  button.dataset.defaultLabel = "B đang lấy dữ liệu";
  button.textContent = "B đang lấy dữ liệu";
  button.disabled = true;
  loading.hidden = false;
  loading.setAttribute("aria-busy", "true");
  form.setAttribute("aria-busy", "true");
  status.textContent = "Trạng thái mới của B";
  status.dataset.state = "loading";
  resolvePrepare({
    importSession: {
      sessionId: "session-a",
      revisions: [{ revisionNumber: "00" }],
    },
  });
  await pending;

  assert.equal(status.textContent, "Trạng thái mới của B");
  assert.equal(status.dataset.state, "loading");
  assert.equal(button.textContent, "B đang lấy dữ liệu");
  assert.equal(button.disabled, true);
  assert.equal(loading.hidden, false);
  assert.equal(loading.attributes.get("aria-busy"), "true");
  assert.equal(form.attributes.get("aria-busy"), "true");
});


test("inline plan lookup prepares all revisions and opens editable revision 00 without another modal", async () => {
  const identity = { value: "plan-a" };
  const form = {
    querySelector: (selector) => (selector === "input[type='hidden']" ? identity : null),
  };
  const code = control("PL2600000001");
  const name = control("Tên cũ");
  const planType = control("", ["Dự án", "Dự toán mua sắm"]);
  const projectName = control("");
  projectName.disabled = true;
  const originalDispatch = planType.dispatchEvent.bind(planType);
  planType.dispatchEvent = (event) => {
    originalDispatch(event);
    if (event.type === "change") projectName.disabled = false;
  };
  const total = control("");
  const button = inlineButton();
  const status = inlineStatus();
  const calls = [];
  const controls = {
    "form-kehoach": form,
    "kh-ma": code,
    "kh-ten": name,
    "kh-loaihinh": planType,
    "kh-duan": projectName,
    "kh-tongmuc": total,
    "btn-open-procurement-lookup-plan": button,
    "procurement-lookup-plan-status": status,
  };
  const lookup = new ProcurementInlineLookup({
    controller: {
      model: { getWorkspaceToken: () => "org-1" },
      async startProcurementPlanImport(flow) { calls.push(["start", flow]); },
    },
    importClient: {
      async preparePlan(request) {
        calls.push(["prepare", request]);
        return {
          importSession: {
            sessionId: "session-plan",
            revisions: [{ revisionNumber: "01" }, { revisionNumber: "00" }],
          },
        };
      },
      async getPlanRevisionDraft(_sessionId, revisionNumber) {
        return {
          revisionNumber,
          planDraft: { maKeHoach: "PL2600000001", tenKeHoach: "Kế hoạch 00" },
          packageDrafts: [],
        };
      },
    },
    client: { async lookup() { assert.fail("plan session flow must not lookup LATEST"); } },
    document: { getElementById: (id) => controls[id] || null },
  });

  const result = await lookup.run({
    kind: "PLAN",
    formId: "form-kehoach",
    codeInputId: "kh-ma",
    buttonId: "btn-open-procurement-lookup-plan",
    statusId: "procurement-lookup-plan-status",
  });

  assert.equal(result.revisionNumber, "00");
  assert.equal(calls[0][0], "prepare");
  assert.equal(calls[0][1].revisionMode, "ALL");
  assert.equal(calls[0][1].includeLinkedNotices, true);
  assert.equal(calls[1][0], "start");
  assert.equal(calls[1][1].currentDraft.revisionNumber, "00");
  assert.deepEqual(
    calls[1][1].controller.revisions.map((row) => row.revisionNumber),
    ["00", "01"],
  );
  assert.match(status.textContent, /phiên bản 00/i);
  assert.equal(status.dataset.state, "success");
  assert.equal(button.textContent, "Lấy dữ liệu tự động");
  assert.equal(button.disabled, false);
});


test("inline plan lookup cancels the previous source flow before switching codes", async () => {
  const identity = { value: "plan-a" };
  const form = {
    querySelector: (selector) => (selector === "input[type='hidden']" ? identity : null),
  };
  const code = control("PL2600225772");
  const name = control("Tên cũ");
  const button = inlineButton();
  const status = inlineStatus();
  const cancelled = [];
  const controls = {
    "form-kehoach": form,
    "kh-ma": code,
    "kh-ten": name,
    "btn-open-procurement-lookup-plan": button,
    "procurement-lookup-plan-status": status,
  };
  const controller = {
    model: { getWorkspaceToken: () => "org-1" },
    procurementPlanImport: {
      session: { familyNo: "PL2600225773", sessionId: "old-session" },
    },
    async cancelActiveProcurementImportSession() {
      cancelled.push(this.procurementPlanImport.session.sessionId);
      this.procurementPlanImport = null;
      return true;
    },
    async startProcurementPlanImport(flow) {
      if (this.procurementPlanImport) {
        throw Object.assign(new Error("stale source flow"), {
          name: "AbortError", code: "FLOW_CHANGED",
        });
      }
      this.procurementPlanImport = flow;
      name.value = flow.currentDraft.planDraft.tenKeHoach;
    },
  };
  const lookup = new ProcurementInlineLookup({
    controller,
    importClient: {
      async preparePlan() {
        return {
          importSession: {
            sessionId: "new-session",
            familyNo: "PL2600225772",
            revisions: [{ revisionNumber: "00" }],
          },
        };
      },
      async getPlanRevisionDraft() {
        return {
          revisionNumber: "00",
          planDraft: {
            maKeHoach: "PL2600225772",
            tenKeHoach: "Kế hoạch 5772",
          },
          packageDrafts: [],
        };
      },
    },
    client: { async lookup() { assert.fail("plan session flow must not lookup LATEST"); } },
    document: { getElementById: (id) => controls[id] || null },
  });

  const result = await lookup.run({
    kind: "PLAN",
    formId: "form-kehoach",
    codeInputId: "kh-ma",
    buttonId: "btn-open-procurement-lookup-plan",
    statusId: "procurement-lookup-plan-status",
  });

  assert.equal(result.revisionNumber, "00");
  assert.deepEqual(cancelled, ["old-session"]);
  assert.equal(name.value, "Kế hoạch 5772");
  assert.equal(status.dataset.state, "success");
});


test("inline plan lookup replaces the previous flow when the same code is entered again", async () => {
  const identity = { value: "plan-a" };
  const form = {
    querySelector: (selector) => (selector === "input[type='hidden']" ? identity : null),
  };
  const code = control("PL2600225771");
  const button = inlineButton();
  const status = inlineStatus();
  const cancelled = [];
  let prepareCount = 0;
  const controls = {
    "form-kehoach": form,
    "kh-ma": code,
    "btn-open-procurement-lookup-plan": button,
    "procurement-lookup-plan-status": status,
  };
  const controller = {
    model: { getWorkspaceToken: () => "org-1" },
    async cancelActiveProcurementImportSession() {
      cancelled.push(this.procurementPlanImport.session.sessionId);
      this.procurementPlanImport = null;
      return true;
    },
    async startProcurementPlanImport(flow) {
      if (this.procurementPlanImport) {
        throw Object.assign(new Error("stale source flow"), {
          name: "AbortError", code: "FLOW_CHANGED",
        });
      }
      this.procurementPlanImport = flow;
    },
  };
  const lookup = new ProcurementInlineLookup({
    controller,
    importClient: {
      async preparePlan() {
        prepareCount += 1;
        return {
          importSession: {
            sessionId: `session-${prepareCount}`,
            familyNo: "PL2600225771",
            revisions: [{ revisionNumber: "00" }],
          },
        };
      },
      async getPlanRevisionDraft() {
        return {
          revisionNumber: "00",
          planDraft: { maKeHoach: "PL2600225771" },
          packageDrafts: [],
        };
      },
    },
    client: { async lookup() { assert.fail("plan session flow must not lookup LATEST"); } },
    document: { getElementById: (id) => controls[id] || null },
  });
  const options = {
    kind: "PLAN",
    formId: "form-kehoach",
    codeInputId: "kh-ma",
    buttonId: "btn-open-procurement-lookup-plan",
    statusId: "procurement-lookup-plan-status",
  };

  const first = await lookup.run(options);
  code.value = "";
  code.value = "PL2600225771";
  const second = await lookup.run(options);

  assert.deepEqual({
    firstRevision: first?.revisionNumber,
    secondRevision: second?.revisionNumber,
    cancelled,
    activeSession: controller.procurementPlanImport.session.sessionId,
    statusState: status.dataset.state,
    statusStillLoading: /Đang lấy dữ liệu/i.test(status.textContent),
    buttonDisabled: button.disabled,
  }, {
    firstRevision: "00",
    secondRevision: "00",
    cancelled: ["session-1"],
    activeSession: "session-2",
    statusState: "success",
    statusStillLoading: false,
    buttonDisabled: false,
  });
});


test("inline plan lookup does not bind the previous code's investor decision", async () => {
  const identity = { value: "plan-a" };
  const form = {
    querySelector: (selector) => (selector === "input[type='hidden']" ? identity : null),
  };
  const code = control("PL2600225771");
  const investor = control("investor-5773");
  const button = inlineButton();
  const status = inlineStatus();
  const bound = [];
  const controls = {
    "form-kehoach": form,
    "kh-ma": code,
    "kh-chudautuid": investor,
    "btn-open-procurement-lookup-plan": button,
    "procurement-lookup-plan-status": status,
  };
  const controller = {
    model: { getWorkspaceToken: () => "org-1" },
    procurementPlanImport: {
      session: { familyNo: "PL2600225773", sessionId: "old-session" },
    },
    async cancelActiveProcurementImportSession() {
      this.procurementPlanImport = null;
      return true;
    },
    async startProcurementPlanImport() {},
  };
  const lookup = new ProcurementInlineLookup({
    controller,
    importClient: {
      async preparePlan() {
        return {
          importSession: {
            sessionId: "new-session", familyNo: "PL2600225771",
            revisions: [{ revisionNumber: "00" }],
          },
        };
      },
      async getPlanRevisionDraft() {
        return {
          revisionNumber: "00",
          planDraft: { maKeHoach: "PL2600225771" },
          packageDrafts: [],
        };
      },
      async bindPlanSessionDecisions(_sessionId, payload) {
        bound.push(payload.decisions.investorId);
        return {};
      },
    },
    client: { async lookup() { assert.fail("plan session flow must not lookup LATEST"); } },
    document: { getElementById: (id) => controls[id] || null },
  });

  await lookup.run({
    kind: "PLAN",
    formId: "form-kehoach",
    codeInputId: "kh-ma",
    buttonId: "btn-open-procurement-lookup-plan",
    statusId: "procurement-lookup-plan-status",
  });

  assert.deepEqual(bound, [null]);
});


test("inline plan lookup clears a previous investor when the same form changes code", async () => {
  const identity = { value: "plan-a" };
  const form = {
    querySelector: (selector) => (selector === "input[type='hidden']" ? identity : null),
  };
  const code = control("PL2600225773");
  const investor = control("investor-5773");
  const button = inlineButton();
  const status = inlineStatus();
  const bound = [];
  const controls = {
    "form-kehoach": form,
    "kh-ma": code,
    "kh-chudautuid": investor,
    "btn-open-procurement-lookup-plan": button,
    "procurement-lookup-plan-status": status,
  };
  const controller = {
    model: { getWorkspaceToken: () => "org-1" },
    async startProcurementPlanImport() {},
  };
  const importClient = {
    async preparePlan() {
      return {
        importSession: {
          sessionId: `session-${code.value}`,
          familyNo: code.value,
          revisions: [{ revisionNumber: "00" }],
        },
      };
    },
    async getPlanRevisionDraft() {
      return { revisionNumber: "00", planDraft: { maKeHoach: code.value }, packageDrafts: [] };
    },
    async bindPlanSessionDecisions(_sessionId, payload) {
      bound.push(payload.decisions.investorId);
      return {};
    },
  };
  const lookup = new ProcurementInlineLookup({
    controller, importClient,
    client: { async lookup() { assert.fail("plan session flow must not lookup LATEST"); } },
    document: { getElementById: (id) => controls[id] || null },
  });
  const options = {
    kind: "PLAN", formId: "form-kehoach", codeInputId: "kh-ma",
    buttonId: "btn-open-procurement-lookup-plan", statusId: "procurement-lookup-plan-status",
  };

  await lookup.run(options);
  code.value = "PL2600225771";
  await lookup.run(options);

  assert.deepEqual(bound, ["investor-5773", null]);
  assert.equal(investor.value, "");
});


test("inline plan lookup does not bind a local pending investor after returning from breakdown", async () => {
  const identity = { value: "plan-5773" };
  const form = {
    querySelector: (selector) => (selector === "input[type='hidden']" ? identity : null),
  };
  const code = control("PL2600225773");
  const investor = control("investor-pending");
  const button = inlineButton();
  const status = inlineStatus();
  const bound = [];
  const controls = {
    "form-kehoach": form,
    "kh-ma": code,
    "kh-chudautuid": investor,
    "btn-open-procurement-lookup-plan": button,
    "procurement-lookup-plan-status": status,
  };
  const controller = {
    model: {
      getWorkspaceToken: () => "org-1",
      getLatestChuDauTu: () => [{
        id: "investor-pending", tenChuDauTu: "Chủ đầu tư hiển thị",
      }],
    },
    procurementPlanImport: {
      session: { familyNo: "PL2600225773", sessionId: "session-5773" },
      investorResolution: {
        status: "NEW",
        investor: { id: "investor-pending" },
      },
    },
    async startProcurementPlanImport() {},
  };
  const lookup = new ProcurementInlineLookup({
    controller,
    importClient: {
      async preparePlan() {
        return {
          importSession: {
            sessionId: "session-5773-refresh", familyNo: "PL2600225773",
            revisions: [{ revisionNumber: "00" }],
          },
        };
      },
      async getPlanRevisionDraft() {
        return {
          revisionNumber: "00", planDraft: { maKeHoach: "PL2600225773" },
          packageDrafts: [],
        };
      },
      async bindPlanSessionDecisions(_sessionId, payload) {
        bound.push(payload.decisions.investorId);
        return {};
      },
    },
    client: { async lookup() { assert.fail("plan session flow must not lookup LATEST"); } },
    document: { getElementById: (id) => controls[id] || null },
  });

  await lookup.run({
    kind: "PLAN", formId: "form-kehoach", codeInputId: "kh-ma",
    buttonId: "btn-open-procurement-lookup-plan",
    statusId: "procurement-lookup-plan-status",
  });

  assert.deepEqual(bound, [null]);
});


test("inline plan lookup waits for enrichment before loading the revision draft", async () => {
  const identity = { value: "plan-a" };
  const form = {
    querySelector: (selector) => (selector === "input[type='hidden']" ? identity : null),
  };
  const code = control("PL2600000001");
  const button = inlineButton();
  const status = inlineStatus();
  const calls = [];
  const lookup = new ProcurementInlineLookup({
    controller: {
      model: { getWorkspaceToken: () => "org-1" },
      async startProcurementPlanImport(flow) {
        calls.push(["start", flow.currentDraft.packageDrafts[0].trangThai]);
      },
    },
    importClient: {
      async preparePlan() {
        calls.push(["prepare"]);
        return {
          enrichmentStatus: "PENDING",
          enrichmentOperationId: "enrichment-1",
          importSession: {
            sessionId: "session-plan",
            revisions: [{ revisionNumber: "00" }],
          },
        };
      },
      async getOperation(operationId) {
        calls.push(["operation", operationId]);
        return { status: "COMPLETED", nextRevisionIndex: 1, totalRevisions: 1 };
      },
      async getPlanRevisionDraft() {
        calls.push(["draft"]);
        return {
          revisionNumber: "00",
          planDraft: { maKeHoach: "PL2600000001" },
          packageDrafts: [{
            maGoiThau: "IB2600082707",
            trangThai: "Đang mời thầu",
          }],
        };
      },
    },
    client: { async lookup() { assert.fail("plan import must use its session"); } },
    document: {
      getElementById(id) {
        return {
          "form-kehoach": form,
          "kh-ma": code,
          "btn-open-procurement-lookup-plan": button,
          "procurement-lookup-plan-status": status,
        }[id] || null;
      },
    },
  });

  await lookup.run({
    kind: "PLAN",
    formId: "form-kehoach",
    codeInputId: "kh-ma",
    buttonId: "btn-open-procurement-lookup-plan",
    statusId: "procurement-lookup-plan-status",
  });

  assert.deepEqual(calls.map(([kind]) => kind), [
    "prepare", "operation", "draft", "start",
  ]);
  assert.equal(calls.at(-1)[1], "Đang mời thầu");
});


test("inline lookup silently discards a response after the active form changes", async () => {
  let resolvePrepare;
  const status = inlineStatus();
  const code = control("PL2600000001");
  const identity = { value: "plan-a" };
  const button = inlineButton();
  const form = {
    querySelector: (selector) => (selector === "input[type='hidden']" ? identity : null),
  };
  const controls = {
    "form-kehoach": form,
    "kh-ma": code,
    "btn-open-procurement-lookup-plan": button,
    "procurement-lookup-plan-status": status,
  };
  const lookup = new ProcurementInlineLookup({
    controller: { model: { getWorkspaceToken: () => "org-1" } },
    importClient: {
      preparePlan: () => new Promise((resolve) => { resolvePrepare = resolve; }),
    },
    client: { lookup: () => assert.fail("must use sequential session") },
    document: { getElementById: (id) => controls[id] || null },
  });

  const pending = lookup.run({
    kind: "PLAN",
    formId: "form-kehoach",
    codeInputId: "kh-ma",
    buttonId: "btn-open-procurement-lookup-plan",
    statusId: "procurement-lookup-plan-status",
  });
  identity.value = "plan-b";
  status.textContent = "A2 đang lấy dữ liệu";
  status.dataset.state = "loading";
  button.dataset.defaultLabel = "A2 đang lấy dữ liệu";
  button.textContent = "A2 đang lấy dữ liệu";
  button.disabled = true;
  resolvePrepare({
    importSession: {
      sessionId: "session-plan",
      revisions: [{ revisionNumber: "00" }],
    },
  });
  const result = await pending;

  assert.equal(result, null);
  assert.equal(status.textContent, "A2 đang lấy dữ liệu");
  assert.equal(status.dataset.state, "loading");
  assert.equal(button.textContent, "A2 đang lấy dữ liệu");
  assert.equal(button.disabled, true);
});


test("inline lookup reports an invalid code beside the form control", async () => {
  let calls = 0;
  let focused = false;
  const code = {
    value: "123",
    focus() { focused = true; },
  };
  const status = inlineStatus();
  const lookup = new ProcurementInlineLookup({
    controller: { model: {} },
    client: { async lookup() { calls += 1; } },
    document: {
      getElementById(id) {
        return {
          "kh-ma": code,
          "procurement-lookup-plan-status": status,
        }[id] || null;
      },
    },
  });

  const result = await lookup.run({
    kind: "PLAN",
    formId: "form-kehoach",
    codeInputId: "kh-ma",
    buttonId: "btn-open-procurement-lookup-plan",
    statusId: "procurement-lookup-plan-status",
  });

  assert.equal(result, null);
  assert.equal(calls, 0);
  assert.equal(focused, true);
  assert.equal(status.dataset.state, "error");
  assert.match(status.textContent, /nhập mã PL/i);
});


test("plan and package forms expose inline lookup without a comparison modal", () => {
  const planModal = fs.readFileSync("views/modals/modal_kehoach.html", "utf8");
  const packageModal = fs.readFileSync("views/modals/modal_goithau.html", "utf8");
  const controller = fs.readFileSync("frontend/app/BiddingController.js", "utf8");
  const workflows = fs.readFileSync("frontend/packages/BiddingWorkflows.js", "utf8");
  const planWorkflow = fs.readFileSync("frontend/plans/KeHoachWorkflow.js", "utf8");
  const componentStyles = fs.readFileSync("views/css/components.css", "utf8");

  assert.match(planModal, /id="procurement-lookup-plan-enabled"/);
  assert.match(planModal, /id="procurement-lookup-plan-loading"/);
  assert.match(planModal, /<span>Lấy dữ liệu tự động<\/span>/);
  assert.doesNotMatch(planModal, /id="btn-open-procurement-lookup-plan"/);
  assert.doesNotMatch(planModal, /id="btn-open-procurement-import"/);
  assert.match(planModal, /id="procurement-lookup-plan-status"/);
  assert.match(
    planModal,
    /value="Dự toán và kế hoạch" selected>Kế hoạch và dự toán<\/option>/,
  );
  assert.match(
    planWorkflow,
    /getElementById\("kh-pheduyet"\)\.value = "Dự toán và kế hoạch"/,
  );
  for (const fieldId of [
    "kh-sototrinhdutoan",
    "kh-ngaytrinhdutoan",
    "kh-sototrinhkehoach",
    "kh-ngaytrinhkehoach",
    "kh-sototrinhdutoankehoach",
  ]) {
    const fieldPattern = new RegExp(
      `<input[^>]*id="${fieldId}"[^>]*\\brequired(?:\\s|=|>)`,
      "u",
    );
    assert.doesNotMatch(planModal, fieldPattern);
  }
  assert.match(packageModal, /id="procurement-lookup-package-enabled"/);
  assert.match(packageModal, /id="procurement-lookup-package-loading"/);
  assert.match(packageModal, /class="package-identity-grid col-span-2"/);
  assert.match(packageModal, /<span>Lấy dữ liệu tự động<\/span>/);
  assert.doesNotMatch(packageModal, /id="btn-open-procurement-lookup-package"/);
  assert.doesNotMatch(packageModal, /id="btn-open-procurement-notice-import"/);
  assert.match(packageModal, /id="procurement-lookup-package-status"/);
  assert.doesNotMatch(controller, /"modal-procurement-lookup"/);
  assert.match(workflows, /ProcurementInlineLookup\.js/);
  assert.match(
    planWorkflow,
    /hasServerCapability\(\s*PROCUREMENT_LOOKUP_CAPABILITY/,
  );
  assert.match(
    fs.readFileSync("frontend/packages/GoiThauWorkflow.js", "utf8"),
    /hasServerCapability\(\s*PROCUREMENT_LOOKUP_CAPABILITY/,
  );
  assert.match(
    componentStyles,
    /\.plan-identity-grid\s*{[^}]*minmax\(0, 4fr\) minmax\(0, 8fr\)/s,
  );
  assert.match(
    componentStyles,
    /\.package-identity-grid\s*{[^}]*minmax\(0, 5fr\) minmax\(0, 7fr\)/s,
  );
  assert.match(
    componentStyles,
    /\.procurement-code-input-row\s*{[^}]*align-items:\s*stretch/s,
  );
  assert.match(componentStyles, /--identity-control-height:\s*44px/);
  assert.match(
    componentStyles,
    /\.package-identity-grid \.bf-combobox-input,[^}]*height:\s*var\(--identity-control-height\)/s,
  );
});
