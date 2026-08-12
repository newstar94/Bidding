import assert from "node:assert/strict";
import fs from "node:fs";
import test from "node:test";

import { ProcurementLookupClient } from "../../frontend/procurement/ProcurementLookupClient.js";
import {
  applySelectedRows,
  buildComparisonRows,
} from "../../frontend/procurement/ProcurementLookupPreview.js";
import {
  ProcurementLookupWizard,
} from "../../frontend/procurement/ProcurementLookupWizard.js";
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


test("manual lookup cancels the pending debounced lookup", async () => {
  const element = (value = "") => ({
    value,
    hidden: false,
    disabled: false,
    listeners: {},
    addEventListener(type, callback) { this.listeners[type] = callback; },
    replaceChildren() {},
    setAttribute() {},
  });
  const code = element("PL2600000001");
  const status = element();
  const run = element();
  const apply = element();
  const body = element();
  const warnings = element();
  const packages = element();
  const modal = {
    addEventListener() {},
    querySelector(selector) {
      return {
        "[data-procurement-lookup-code]": code,
        "[data-procurement-lookup-status]": status,
        "[data-procurement-lookup-run]": run,
        "[data-procurement-lookup-apply]": apply,
        "[data-procurement-lookup-body]": body,
        "[data-procurement-lookup-warnings]": warnings,
        "[data-procurement-lookup-packages]": packages,
      }[selector] || null;
    },
    querySelectorAll() { return []; },
  };
  const wizard = new ProcurementLookupWizard({
    controller: {},
    modal,
    document: { getElementById: () => null },
  });
  let lookupCount = 0;
  wizard.lookup = () => { lookupCount += 1; };

  code.listeners.input();
  run.listeners.click();
  await new Promise((resolve) => setTimeout(resolve, 650));

  assert.equal(lookupCount, 1);
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


test("plan investor maps only by exact existing option text", () => {
  const investor = control("");
  investor.options = [
    { value: "", textContent: "-- Chọn Chủ đầu tư --" },
    { value: "investor-1", textContent: "Chủ đầu tư nội bộ" },
  ];
  const rows = buildComparisonRows("PLAN", {
    investorName: "Chủ đầu tư nội bộ",
  }, { getControl: (id) => (id === "kh-chudautuid" ? investor : null) });
  const matched = rows.find((row) => row.field === "investorName");

  assert.equal(matched.sourceValue, "Chủ đầu tư nội bộ");
  assert.equal(matched.draftValue, "investor-1");
  assert.equal(matched.apply, true);

  const unmatchedRows = buildComparisonRows("PLAN", {
    investorName: "Tên gần giống nhưng không trùng",
  }, { getControl: (id) => (id === "kh-chudautuid" ? investor : null) });
  const unmatched = unmatchedRows.find((row) => row.field === "investorName");
  assert.equal(unmatched.draftValue, null);
  assert.match(unmatched.warning, /khớp chính xác/i);
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


test("wizard discards lookup response after the active form changes", async () => {
  let resolveLookup;
  const status = { textContent: "", setAttribute() {} };
  const code = { value: "PL2600000001" };
  const formIdentity = { value: "plan-a" };
  const modal = {
    querySelector(selector) {
      return {
        "[data-procurement-lookup-code]": code,
        "[data-procurement-lookup-status]": status,
        "[data-procurement-lookup-apply]": { disabled: false },
      }[selector] || null;
    },
  };
  const form = {
    querySelector(selector) {
      return selector === "input[type='hidden']" ? formIdentity : null;
    },
  };
  const wizard = Object.create(ProcurementLookupWizard.prototype);
  Object.assign(wizard, {
    controller: { model: { activeWorkspaceLease: "org-1" } },
    modal,
    document: { getElementById: (id) => (id === "form-kehoach" ? form : null) },
    client: { lookup: () => new Promise((resolve) => { resolveLookup = resolve; }) },
    context: { kind: "PLAN", formId: "form-kehoach", workspaceLease: "org-1" },
    requestGeneration: 0,
    lookupController: null,
    preview: null,
    rows: [],
  });
  wizard.renderPreview = () => { throw new Error("stale response was rendered"); };

  const pending = wizard.lookup();
  formIdentity.value = "plan-b";
  resolveLookup({
    schemaVersion: "biddingflow-procurement-preview-v1",
    kind: "PLAN",
    canonicalCode: "PL2600000001",
    data: { planNo: "PL2600000001" },
  });
  await pending;

  assert.equal(wizard.preview, null);
  assert.match(status.textContent, /biểu mẫu.*thay đổi/i);
});


test("wizard blocks apply when a mapped draft field changed after preview", () => {
  const status = { textContent: "", setAttribute() {} };
  const code = { value: "IB2600000002" };
  const identity = { value: "package-a" };
  const price = control("2.100.000.000");
  let closeCount = 0;
  const form = {
    querySelector: () => identity,
  };
  const wizard = Object.create(ProcurementLookupWizard.prototype);
  Object.assign(wizard, {
    controller: {
      model: { activeWorkspaceLease: "org-1" },
      view: { closeModal() { closeCount += 1; } },
    },
    modal: {
      querySelector(selector) {
        return {
          "[data-procurement-lookup-code]": code,
          "[data-procurement-lookup-status]": status,
        }[selector] || null;
      },
    },
    document: {
      getElementById(id) {
        return { "form-goithau": form, "gt-gia": price }[id] || null;
      },
    },
    context: {
      kind: "PACKAGE", formId: "form-goithau", identity: "package-a",
      workspaceLease: "org-1",
    },
    preview: { canonicalCode: "IB2600000002" },
    rows: [{ controlId: "gt-gia", draftValue: "2.000.000.000", apply: true }],
    draftFingerprint: JSON.stringify([["gt-gia", ""]]),
  });

  wizard.apply();

  assert.equal(price.value, "2.100.000.000");
  assert.match(status.textContent, /draft.*thay đổi/i);
  assert.equal(closeCount, 0);
});


test("lookup dialog traps tab focus and Escape closes with focus return", () => {
  const focusCalls = [];
  const first = { hidden: false, focus() { focusCalls.push("first"); } };
  const last = { hidden: false, focus() { focusCalls.push("last"); } };
  let cleanupCount = 0;
  let closeCount = 0;
  const wizard = Object.create(ProcurementLookupWizard.prototype);
  Object.assign(wizard, {
    modal: { querySelectorAll: () => [first, last] },
    document: { activeElement: last },
    controller: { view: { closeModal() { closeCount += 1; } } },
    opener: { focus() { focusCalls.push("opener"); } },
    cleanup() { cleanupCount += 1; },
  });
  const tab = {
    key: "Tab", shiftKey: false, prevented: false,
    preventDefault() { this.prevented = true; },
  };
  wizard.handleModalKeydown(tab);
  assert.equal(tab.prevented, true);
  assert.deepEqual(focusCalls, ["first"]);

  const escape = {
    key: "Escape", prevented: false,
    preventDefault() { this.prevented = true; },
  };
  wizard.handleModalKeydown(escape);
  assert.equal(escape.prevented, true);
  assert.equal(cleanupCount, 1);
  assert.equal(closeCount, 1);
  assert.deepEqual(focusCalls, ["first", "opener"]);
});


test("plan and package forms expose draft lookup without replacing import flows", () => {
  const planModal = fs.readFileSync("views/modals/modal_kehoach.html", "utf8");
  const packageModal = fs.readFileSync("views/modals/modal_goithau.html", "utf8");
  const lookupModal = fs.readFileSync(
    "views/modals/modal_procurement_lookup.html", "utf8",
  );
  const controller = fs.readFileSync("frontend/app/BiddingController.js", "utf8");
  const workflows = fs.readFileSync("frontend/packages/BiddingWorkflows.js", "utf8");

  assert.match(planModal, /id="btn-open-procurement-lookup-plan"/);
  assert.match(planModal, /id="btn-open-procurement-import"/);
  assert.match(packageModal, /id="btn-open-procurement-lookup-package"/);
  assert.match(packageModal, /id="btn-open-procurement-notice-import"/);
  assert.match(lookupModal, /id="modal-procurement-lookup"/);
  assert.match(lookupModal, /aria-modal="true"/);
  assert.match(lookupModal, /data-procurement-lookup-body/);
  assert.match(controller, /"modal-procurement-lookup"/);
  assert.match(workflows, /ProcurementLookupWizard\.js/);
  assert.match(
    fs.readFileSync("frontend/plans/KeHoachWorkflow.js", "utf8"),
    /hasServerCapability\(PROCUREMENT_LOOKUP_CAPABILITY\)/,
  );
  assert.match(
    fs.readFileSync("frontend/plans/KeHoachWorkflow.js", "utf8"),
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
