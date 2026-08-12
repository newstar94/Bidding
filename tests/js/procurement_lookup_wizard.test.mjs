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
} from "../../frontend/procurement/ProcurementInlineLookup.js";
import {
  hasServerCapability,
  invalidateServerCapabilities,
  PROCUREMENT_IMPORT_CAPABILITY,
  PROCUREMENT_LOOKUP_CAPABILITY,
  updateServerCapabilitiesFromSession,
} from "../../frontend/auth/serverCapabilities.js";


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


test("inline package lookup fills bid guarantee without saving", async () => {
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
  const lookup = new ProcurementInlineLookup({
    controller: { model: { activeWorkspaceLease: "org-1" } },
    client: {
      async lookup() {
        return {
          schemaVersion: "biddingflow-procurement-preview-v1",
          kind: "PACKAGE",
          canonicalCode: "IB2600000002",
          data: { notifyNo: "IB2600000002", bidGuarantee: 28_000_000 },
        };
      },
    },
    document: { getElementById: (id) => controls[id] || null },
  });

  const result = await lookup.run({
    kind: "PACKAGE",
    formId: "form-goithau",
    codeInputId: "gt-ma",
    buttonId: "btn-open-procurement-lookup-package",
    statusId: "procurement-lookup-package-status",
  });

  assert.equal(guarantee.value, "28.000.000");
  assert.equal(result.applied, 2);
  assert.match(status.textContent, /dữ liệu chưa được lưu/i);
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
    textContent: "Lấy dữ liệu từ Mua Sắm Công",
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


test("inline lookup fills the open plan form without opening another modal", async () => {
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
  let lookupRequest;
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
    controller: { model: { activeWorkspaceLease: "org-1" } },
    client: {
      async lookup(request) {
        lookupRequest = request;
        return {
          schemaVersion: "biddingflow-procurement-preview-v1",
          kind: "PLAN",
          canonicalCode: "PL2600000001",
          data: {
            planNo: "PL2600000001",
            planName: "Kế hoạch từ nguồn",
            planType: "Dự án",
            projectName: "Dự án từ nguồn",
            totalInvestment: 3_000_000_000,
          },
        };
      },
    },
    document: { getElementById: (id) => controls[id] || null },
  });

  const result = await lookup.run({
    kind: "PLAN",
    formId: "form-kehoach",
    codeInputId: "kh-ma",
    buttonId: "btn-open-procurement-lookup-plan",
    statusId: "procurement-lookup-plan-status",
  });

  assert.equal(result.applied, 5);
  assert.equal(name.value, "Kế hoạch từ nguồn");
  assert.equal(planType.value, "Dự án");
  assert.equal(projectName.value, "Dự án từ nguồn");
  assert.equal(total.value, "3.000.000.000");
  assert.match(status.textContent, /đã điền 5 trường/i);
  assert.equal(status.dataset.state, "success");
  assert.equal(button.textContent, "Lấy dữ liệu từ Mua Sắm Công");
  assert.equal(button.disabled, false);
  assert.deepEqual(lookupRequest, {
    code: "PL2600000001",
    workspaceLease: "org-1",
    detailLevel: "COMPLETE",
    revisionMode: "LATEST",
  });
});


test("inline lookup discards a response after the active form changes", async () => {
  let resolveLookup;
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
    controller: { model: { activeWorkspaceLease: "org-1" } },
    client: { lookup: () => new Promise((resolve) => { resolveLookup = resolve; }) },
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
  resolveLookup({
    schemaVersion: "biddingflow-procurement-preview-v1",
    kind: "PLAN",
    canonicalCode: "PL2600000001",
    data: { planNo: "PL2600000001" },
  });
  const result = await pending;

  assert.equal(result, null);
  assert.match(status.textContent, /biểu mẫu.*thay đổi/i);
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

  assert.match(planModal, /id="btn-open-procurement-lookup-plan"/);
  assert.match(planModal, /id="btn-open-procurement-import"/);
  assert.match(planModal, /id="procurement-lookup-plan-status"/);
  assert.match(
    planModal,
    /value="Dự toán và kế hoạch" selected>Kế hoạch và dự toán<\/option>/,
  );
  assert.match(
    planWorkflow,
    /getElementById\("kh-pheduyet"\)\.value = "Dự toán và kế hoạch"/,
  );
  assert.match(packageModal, /id="btn-open-procurement-lookup-package"/);
  assert.match(packageModal, /id="btn-open-procurement-notice-import"/);
  assert.match(packageModal, /id="procurement-lookup-package-status"/);
  assert.doesNotMatch(controller, /"modal-procurement-lookup"/);
  assert.match(workflows, /ProcurementInlineLookup\.js/);
  assert.match(
    planWorkflow,
    /hasServerCapability\(PROCUREMENT_LOOKUP_CAPABILITY\)/,
  );
  assert.match(
    planWorkflow,
    /hasServerCapability\(PROCUREMENT_IMPORT_CAPABILITY\)/,
  );
  assert.match(
    fs.readFileSync("frontend/packages/GoiThauWorkflow.js", "utf8"),
    /hasServerCapability\(PROCUREMENT_LOOKUP_CAPABILITY\)/,
  );
  assert.match(
    fs.readFileSync("frontend/packages/GoiThauWorkflow.js", "utf8"),
    /hasServerCapability\(PROCUREMENT_IMPORT_CAPABILITY\)/,
  );
});
