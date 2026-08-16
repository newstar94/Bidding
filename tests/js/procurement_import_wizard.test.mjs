import assert from "node:assert/strict";
import fs from "node:fs";
import test from "node:test";

import { ProcurementImportClient } from "../../frontend/procurement/ProcurementImportClient.js";
import {
  applyOpeningImportToDraft,
  canApplyOpeningPreview,
  countOpeningContractors,
  financialOpeningTimestamp,
  mapOpeningBidder,
  prepareOpeningForLifecycle,
  reconcileOpeningDrafts,
} from "../../frontend/procurement/OpeningImportWizard.js";
import {
  PlanImportWizard,
  PlanImportDraftStore,
  canApplyPreview,
  canStartSequentialImport,
  createDebouncedPreparer,
  renderIssues,
  renderPackages,
  summarizePreview,
} from "../../frontend/procurement/PlanImportWizard.js";
import { SequentialRevisionController } from "../../frontend/procurement/SequentialRevisionController.js";
import {
  deriveInvestorShortName,
  resolveImportedInvestorDraft,
} from "../../frontend/procurement/InvestorResolver.js";
import {
  buildInitialPartnerVersion,
  normalizePartnerRecord,
  PARTNER_FORM_CONFIGS,
  validatePartnerRecord,
} from "../../frontend/partners/PartnerFormController.js";
import {
  ProcurementInlineLookup,
  completeProcurementPackageImportRevision,
} from "../../frontend/procurement/ProcurementInlineLookup.js";
import { shouldCreatePackageVersion } from "../../frontend/packages/GoiThauWorkflow.js";
import { completeProcurementPlanImportRevision } from "../../frontend/procurement/PlanImportWizard.js";
import {
  ProcurementImportResumeStore,
  resumeProcurementImportSession,
} from "../../frontend/procurement/ProcurementImportResume.js";


class FakeElement {
  constructor(ownerDocument, tagName = "div") {
    this.ownerDocument = ownerDocument;
    this.tagName = tagName.toUpperCase();
    this.children = [];
    this.dataset = {};
    this.attributes = {};
    this.className = "";
    this.textContent = "";
    this.value = "";
    this.hidden = false;
    this.disabled = false;
  }

  append(child) { this.children.push(child); }
  replaceChildren(...children) { this.children = children; }
  setAttribute(name, value) { this.attributes[name] = String(value); }
}

test("resume pointer stores only bounded session metadata", () => {
  const values = new Map();
  const store = new ProcurementImportResumeStore({
    getItem: (key) => values.get(key) ?? null,
    setItem: (key, value) => values.set(key, String(value)),
    removeItem: (key) => values.delete(key),
  });
  store.save({
    sessionId: "session-1", kind: "PLAN", familyNo: "PL2600000001",
    revisionNumber: "00", canonicalBundle: { secret: "must-not-persist" },
  });

  const restored = store.load();
  assert.deepEqual(Object.keys(restored).sort(), [
    "familyNo", "kind", "revisionNumber", "savedAt", "sessionId",
  ]);
  assert.equal(JSON.stringify(restored).includes("must-not-persist"), false);
});

test("refresh resumes the server session at its first uncommitted revision", async () => {
  const values = new Map();
  const storage = {
    getItem: (key) => values.get(key) ?? null,
    setItem: (key, value) => values.set(key, String(value)),
    removeItem: (key) => values.delete(key),
  };
  new ProcurementImportResumeStore(storage).save({
    sessionId: "session-1", kind: "PACKAGE", familyNo: "IB2600000001",
    revisionNumber: "00",
  });
  const calls = [];
  const controller = {
    model: { workspaceStorage: storage, getWorkspaceToken: () => "lease-1" },
    view: { customConfirm: async () => true },
    startProcurementPackageImport: async (flow) => calls.push(flow),
  };
  const resumed = await resumeProcurementImportSession.call(controller, {
    client: {
      getImportSession: async () => ({
        sessionId: "session-1", kind: "PACKAGE", currentIndex: 1,
        status: "WAITING_NEXT_CONFIRMATION",
        revisions: [{ revisionNumber: "00" }, { revisionNumber: "01" }],
      }),
      getPlanRevisionDraft: async (_id, revisionNumber) => ({
        revisionNumber, packageDrafts: [{ maGoiThau: "IB2600000001" }],
      }),
    },
  });

  assert.equal(resumed, true);
  assert.equal(calls[0].currentDraft.revisionNumber, "01");
  assert.equal(calls[0].controller.currentIndex, 1);
});


test("plan import recovery draft is local UI state, not a Bidding version", () => {
  const values = new Map();
  const storage = {
    setItem(key, value) { values.set(key, value); },
    getItem(key) { return values.get(key) ?? null; },
    removeItem(key) { values.delete(key); },
  };
  const store = new PlanImportDraftStore(storage);
  store.save({
    code: "PL2600000001", revisionMode: "ALL", selectedRevision: "01",
    investorId: "investor-1", bundleDigest: "sha256:bundle",
    decisions: { packageMatches: {}, fieldConflicts: {}, fieldValues: {} },
  });

  const draft = store.load();
  assert.equal(draft.code, "PL2600000001");
  assert.equal(draft.selectedRevision, "01");
  assert.equal(draft.phienBan, undefined);
  assert.equal(draft.canonicalRevision, undefined);
  store.clear();
  assert.equal(store.load(), null);
});


function fakeDocument() {
  const document = {};
  document.createElement = (tagName) => new FakeElement(document, tagName);
  return document;
}


test("apply client sends only preview authority and CAS decisions", async () => {
  const calls = [];
  const client = new ProcurementImportClient({
    post: async (url, body, options) => {
      calls.push({ url, body, options });
      return { ok: true };
    },
  });
  const request = {
    previewId: "opaque-preview",
    idempotencyKey: "import-1",
    expectedPlanRowVersion: 7,
    decisions: { investorId: "investor-1" },
    workspaceLease: "org-1",
  };
  await client.applyPlan(request);

  assert.equal(calls[0].url, "/api/procurement/imports/plan/apply");
  assert.deepEqual(calls[0].body, request);
  assert.equal(calls[0].options.headers["Idempotency-Key"], "import-1");
  assert.throws(
    () => client.applyPlan({ ...request, canonicalPlan: { name: "untrusted" } }),
    /previewId/,
  );
});


test("prepare client forwards AbortSignal and revision mode", async () => {
  const controller = new AbortController();
  let captured;
  const client = new ProcurementImportClient({
    post: async (_url, body, options) => {
      captured = { body, options };
      return {};
    },
  });
  await client.preparePlan(
    { code: "PL2600000001", revisionMode: "ALL", workspaceLease: "org-1" },
    { signal: controller.signal },
  );
  assert.equal(captured.body.revisionMode, "ALL");
  assert.equal(captured.options.signal, controller.signal);
});


test("session client loads one prepared revision without sending canonical payload", async () => {
  const calls = [];
  const client = new ProcurementImportClient({
    get: async (url, options) => {
      calls.push({ url, options });
      return { revisionNumber: "00" };
    },
  });
  await client.getPlanRevisionDraft("session/1", "00", {
    workspaceLease: "org-1",
  });
  assert.equal(
    calls[0].url,
    "/api/procurement/imports/plan/sessions/session%2F1/revisions/00?workspaceLease=org-1",
  );
});


test("plan wizard starts editable workflow at first session revision and never bulk applies", async () => {
  const calls = [];
  const wizard = Object.create(PlanImportWizard.prototype);
  wizard.preview = {
    previewId: "preview-1",
    blockingIssues: [],
    packages: [],
    importSession: {
      sessionId: "session-1",
      revisions: [{ revisionNumber: "01" }, { revisionNumber: "00" }],
    },
  };
  wizard.decisions = { packageMatches: {}, fieldConflicts: {}, fieldValues: {} };
  wizard.workspaceLease = "org-1";
  wizard.modal = {
    querySelector(selector) {
      if (selector === "[data-procurement-apply]") return { disabled: false };
      return null;
    },
  };
  wizard.client = {
    getPlanRevisionDraft: async (_sessionId, revisionNumber) => ({
      revisionNumber, planDraft: { maKeHoach: "PL2600000001" }, packageDrafts: [],
    }),
    applyPlan: async () => { throw new Error("bulk apply must not run"); },
  };
  wizard.controller = {
    startProcurementPlanImport: async (flow) => calls.push(flow),
    view: { closeModal: (id) => calls.push(id) },
  };
  wizard.setStatus = () => {};
  wizard.draftStore = { clear() {} };

  await wizard.apply();
  assert.equal(calls[0].currentDraft.revisionNumber, "00");
  assert.deepEqual(
    calls[0].controller.revisions.map((row) => row.revisionNumber),
    ["00", "01"],
  );
  assert.equal(calls[1], "modal-procurement-import");
});


test("standalone notice client keeps canonical notice data server-side", async () => {
  const calls = [];
  const client = new ProcurementImportClient({
    post: async (url, body, options) => {
      calls.push({ url, body, options });
      return { ok: true };
    },
  });
  await client.prepareNotice({
    code: "IB2600000002", revisionMode: "LATEST", workspaceLease: "org-1",
  });
  const request = {
    previewId: "notice-preview", idempotencyKey: "notice-import-1",
    expectedPackageRowVersion: 3, workspaceLease: "org-1",
  };
  await client.applyNotice(request);

  assert.equal(calls[0].url, "/api/procurement/imports/notice/prepare");
  assert.equal(calls[1].url, "/api/procurement/imports/notice/apply");
  assert.deepEqual(calls[1].body, request);
  assert.throws(
    () => client.applyNotice({ ...request, canonicalNotice: { status: "PUBLISHED" } }),
    /previewId/,
  );
});


test("opening client keeps canonical opening payload server-side", async () => {
  const calls = [];
  const client = new ProcurementImportClient({
    post: async (url, body) => {
      calls.push({ url, body });
      return { ok: true };
    },
  });
  await client.prepareOpening({
    packageId: "package-1",
    noticeNo: "IB2600000002",
    workspaceLease: "org-1",
  });
  const request = {
    previewId: "opening-preview",
    expectedPackageRowVersion: 3,
    workspaceLease: "org-1",
  };
  await client.applyOpening(request);

  assert.equal(calls[0].url, "/api/procurement/imports/opening/prepare");
  assert.equal(calls[1].url, "/api/procurement/imports/opening/apply");
  assert.deepEqual(calls[1].body, request);
  assert.throws(
    () => client.applyOpening({ ...request, bidders: [{ bidPrice: 1 }] }),
    /previewId/,
  );
});


test("opening lifecycle preparation validates one server preview before the package transition", async () => {
  const calls = [];
  const client = {
    async prepareOpening(request) {
      calls.push(["prepare", request]);
      return {
        previewId: "opening-preview",
        package: { id: "package-1", rowVersion: 4 },
        opening: { bidders: [{ contractorCode: "0100000001" }] },
      };
    },
    async applyOpening(request) {
      calls.push(["apply", request]);
      return {
        package: { id: "package-1", rowVersion: 4 },
        opening: { bidders: [{ contractorCode: "0100000001" }] },
      };
    },
  };
  const controller = {
    model: { getWorkspaceToken: () => "org-1" },
  };
  const result = await prepareOpeningForLifecycle.call(
    controller,
    { id: "package-1", rowVersion: 3, maGoiThau: "IB2600000002-01" },
    { client },
  );

  assert.equal(result.applied.opening.bidders.length, 1);
  assert.deepEqual(calls, [
    ["prepare", {
      packageId: "package-1",
      noticeNo: "IB2600000002",
      workspaceLease: "org-1",
    }],
    ["apply", {
      previewId: "opening-preview",
      expectedPackageRowVersion: 4,
      workspaceLease: "org-1",
    }],
  ]);
});


test("opening mapper preserves lot and bid values without prefilling venture members", () => {
  const mapped = mapOpeningBidder({
    contractorCode: "0100000001",
    contractorName: "Liên danh mẫu",
    contractorType: "JOINT_VENTURE",
    lotNo: "01",
    bidPrice: 100,
    priceAfterDiscount: 90,
    bidGuarantee: 1_000_000,
    bidGuaranteeValidityDays: 120,
    jointVentureMembers: [
      { contractorCode: "0100000001", contractorName: "A", isLeader: true },
      { contractorCode: "0100000002", contractorName: "B" },
    ],
  });

  assert.equal(mapped.loaiNhaThau, "Liên danh");
  assert.equal(mapped.maPhanLo, "01");
  assert.equal(mapped.giaDuThau, 100);
  assert.equal(mapped.giaSauGiamGia, 90);
  assert.equal(mapped.giaTriDamBao, 1_000_000);
  assert.equal(mapped.hieuLucBaoDamNgay, 120);
  assert.deepEqual(mapped.thanhVienLienDanh, []);
  assert.equal(
    canApplyOpeningPreview(
      { previewId: "p", package: { id: "package-1", rowVersion: 3 } },
      { id: "package-1", rowVersion: 3 },
    ),
    true,
  );
});


test("opening mapper fills the lot name paired with the imported lot code", () => {
  const mapped = mapOpeningBidder({
    contractorCode: "vn0100000001",
    contractorName: "Nhà thầu 1",
    lotNo: "PP2600198304",
    lotName: "Atropin sulfat",
  });

  assert.equal(mapped.maPhanLo, "PP2600198304");
  assert.equal(mapped.tenPhanLo, "Atropin sulfat");
});


test("financial opening import prefers the financial phase timestamp", () => {
  assert.equal(
    financialOpeningTimestamp({
      openingAt: "2026-08-01T08:00:00",
      financialOpeningAt: "2026-08-10T09:00:00",
    }),
    "2026-08-10T09:00:00",
  );
  assert.equal(
    financialOpeningTimestamp({ openingAt: "2026-08-01T08:00:00" }),
    "2026-08-01T08:00:00",
  );
});


test("opening preview counts unique contractors across lot bid rows", () => {
  const bidders = [
    { contractorCode: "vn0100000001", contractorName: "Nhà thầu 1", lotNo: "PP01" },
    { contractorCode: "vn0100000001", contractorName: "Nhà thầu 1", lotNo: "PP02" },
    { contractorCode: "vn0100000002", contractorName: "Nhà thầu 2", lotNo: "PP03" },
  ];

  assert.equal(countOpeningContractors(bidders), 2);
});


test("opening mapper detects venture markers even when member details are absent", () => {
  const mapped = mapOpeningBidder({
    contractorCode: "vn-pt",
    contractorName: "Công ty TNHH dịch vụ thương mại P&T",
    jointVentureCode: "PC2600320117",
    jointVentureName: "Liên danh P&T - KN",
  });

  assert.equal(mapped.loaiNhaThau, "Liên danh");
  assert.equal(mapped.maNhaThau, "vn-pt");
  assert.equal(mapped.tenNhaThau, "Liên danh P&T - KN");
  assert.deepEqual(mapped.thanhVienLienDanh, []);
});


test("opening draft merge preserves local rows while overwrite replaces them", () => {
  const local = [{
    maNhaThau: "0100000001", tenNhaThau: "Tên đã sửa local",
    maPhanLo: "01", giaDuThau: 95,
  }];
  const source = [
    { contractorCode: "0100000001", contractorName: "Tên nguồn", lotNo: "01", bidPrice: 100 },
    { contractorCode: "0100000002", contractorName: "Nhà thầu mới", lotNo: "01", bidPrice: 90 },
  ];

  const merged = reconcileOpeningDrafts(local, source, "MERGE");
  const overwritten = reconcileOpeningDrafts(local, source, "OVERWRITE");

  assert.equal(merged.conflicts, 1);
  assert.equal(merged.added, 1);
  assert.equal(merged.rows[0].tenNhaThau, "Tên đã sửa local");
  assert.deepEqual(overwritten.rows.map((row) => row.tenNhaThau), [
    "Tên nguồn", "Nhà thầu mới",
  ]);
});


test("opening overwrite removes the initial blank draft row before adding bidders", () => {
  const originalDocument = globalThis.document;
  const tbody = {
    children: [],
    querySelectorAll(selector) {
      return selector === "tr" ? this.children : [];
    },
    replaceChildren(...children) {
      this.children = children;
    },
  };
  const blankRow = {
    querySelector() { return { value: "" }; },
    remove() {
      tbody.children = tbody.children.filter((row) => row !== this);
    },
  };
  tbody.children = [blankRow];
  globalThis.document = {
    getElementById(id) {
      return id === "mothau-table-tbody" ? tbody : null;
    },
  };
  const controller = {
    model: { formatForDatetimeLocal: (value) => value },
    addMoThauRow(_caseType, _pkg, bidder) {
      tbody.children.push({ bidder });
    },
  };

  try {
    const result = applyOpeningImportToDraft.call(controller, {
      pkg: { id: "package-1" },
      applied: {
        opening: {
          bidders: [{
            contractorCode: "vn0100000001",
            contractorName: "Nhà thầu 01",
            bidPrice: 100,
          }],
        },
      },
      action: "OVERWRITE",
    });

    assert.equal(result.added, 1);
    assert.equal(tbody.children.length, 1);
    assert.equal(tbody.children[0].bidder.maNhaThau, "vn0100000001");
  } finally {
    globalThis.document = originalDocument;
  }
});


test("opening imports overwrite drafts without asking for confirmation", () => {
  const source = fs.readFileSync("frontend/procurement/OpeningImportWizard.js", "utf8");

  assert.doesNotMatch(source, /customSelectConfirm/u);
  assert.doesNotMatch(source, /customConfirm/u);
  assert.match(
    source,
    /applyOpeningImportToDraft\.call\(this, \{[\s\S]*action: "OVERWRITE"/u,
  );
});


test("opening import reconciliation does not change package workflow status", () => {
  const pkg = { id: "package-1", trangThai: "Đang mời thầu" };

  const result = reconcileOpeningDrafts([], [{
    contractorCode: "0100000001",
    contractorName: "Nhà thầu 01",
    bidPrice: 100,
  }], "OVERWRITE");

  assert.equal(result.rows.length, 1);
  assert.equal(pkg.trangThai, "Đang mời thầu");
});


test("debounced preparer cancels stale code and runs only the latest value", () => {
  const pending = new Map();
  let sequence = 0;
  const timers = {
    setTimeout(callback) {
      sequence += 1;
      pending.set(sequence, callback);
      return sequence;
    },
    clearTimeout(id) {
      pending.delete(id);
    },
  };
  const values = [];
  const debounced = createDebouncedPreparer((value) => values.push(value), 600, timers);
  debounced.schedule("PL2600000001");
  debounced.schedule("PL2600000002");
  assert.equal(pending.size, 1);
  [...pending.values()][0]();
  assert.deepEqual(values, ["PL2600000002"]);
});


test("summary and apply gate block ambiguous or incomplete preview", () => {
  const ready = {
    previewId: "preview-1",
    blockingIssues: [],
    packages: [{ action: "UNCHANGED" }, { action: "ADDED" }],
  };
  assert.deepEqual(summarizePreview(ready), { total: 2, UNCHANGED: 1, ADDED: 1 });
  assert.equal(canApplyPreview(ready), true);
  assert.equal(canApplyPreview({ ...ready, blockingIssues: [{ field: "priceVnd" }] }), false);
  assert.equal(canApplyPreview({ ...ready, packages: [{ action: "AMBIGUOUS" }] }), false);
});


test("sequential plan import waits until linked-notice enrichment is complete", () => {
  const preview = {
    importSession: {
      sessionId: "session-plan",
      revisions: [{ revisionNumber: "00" }],
    },
    packages: [],
  };
  assert.equal(canStartSequentialImport({
    ...preview, enrichmentStatus: "PENDING",
  }), false);
  assert.equal(canStartSequentialImport({
    ...preview, enrichmentStatus: "PARTIAL",
  }), false);
  assert.equal(canStartSequentialImport({
    ...preview, enrichmentStatus: "FAILED",
  }), false);
  assert.equal(canStartSequentialImport({
    ...preview, enrichmentStatus: "COMPLETED",
  }), true);
});


test("apply gate opens only after every ambiguity, field conflict, and required value is decided", () => {
  const preview = {
    previewId: "preview-1",
    blockingIssues: [{ packageObservationId: "detail-a", field: "capitalDetail" }],
    packages: [{
      planDetailRevisionId: "detail-a",
      action: "AMBIGUOUS",
      fieldConflicts: [{ field: "priceVnd" }],
    }],
  };
  const decisions = {
    packageMatches: { "detail-a": { localRootId: "root-a" } },
    fieldConflicts: { "detail-a:priceVnd": "KEEP_LOCAL" },
    fieldValues: { "detail-a:capitalDetail": "Ngân sách" },
  };
  assert.equal(canApplyPreview(preview, {}), false);
  assert.equal(canApplyPreview(preview, decisions), true);
  assert.equal(canApplyPreview(preview, {
    ...decisions,
    fieldValues: { "detail-a:capitalDetail": "" },
  }), false);
});


test("preview renderer creates accessible controls for every server decision", () => {
  const document = fakeDocument();
  const packageBody = new FakeElement(document, "tbody");
  const issues = new FakeElement(document, "ul");
  const modal = {
    querySelector(selector) {
      if (selector === "[data-procurement-packages]") return packageBody;
      if (selector === "[data-procurement-issues]") return issues;
      return null;
    },
  };
  const preview = {
    packages: [{
      planDetailRevisionId: "detail-a", symbol: "A", name: "Gói A",
      action: "AMBIGUOUS",
      matchCandidates: [{ rootId: "root-a", symbol: "A", name: "Gói cũ" }],
      fieldConflicts: [{ field: "priceVnd" }],
    }],
    blockingIssues: [{
      code: "PROCUREMENT_REQUIRED_FIELDS_MISSING",
      packageObservationId: "detail-a", field: "capitalDetail",
    }],
    warnings: [],
  };

  renderPackages(modal, preview);
  renderIssues(modal, preview);

  const actionCell = packageBody.children[0].children[3];
  const [matchSelect, conflictSelect] = actionCell.children;
  assert.equal(matchSelect.attributes["aria-label"], "Ghép gói A");
  assert.equal(matchSelect.dataset.procurementMatch, "detail-a");
  assert.equal(conflictSelect.dataset.procurementConflict, "detail-a");
  assert.equal(conflictSelect.dataset.field, "priceVnd");
  const requiredInput = issues.children[0].children[1];
  assert.equal(requiredInput.dataset.procurementFieldValue, "detail-a");
  assert.equal(requiredInput.dataset.field, "capitalDetail");
  assert.match(requiredInput.attributes["aria-label"], /capitalDetail/);
});


test("wizard discards a response after workspace change and cleanup clears authority", async () => {
  let resolvePrepare;
  const code = { value: "PL2600000001" };
  const status = {
    textContent: "",
    setAttribute() {},
  };
  const applyButton = { disabled: false };
  const modal = {
    querySelector(selector) {
      return {
        "[data-procurement-code]": code,
        "[data-procurement-mode]": { value: "LATEST" },
        "[data-procurement-revision]": { value: "" },
        "[data-procurement-status]": status,
        "[data-procurement-apply]": applyButton,
      }[selector] || null;
    },
  };
  const wizard = Object.create(PlanImportWizard.prototype);
  let workspaceToken = "org-1";
  wizard.controller = { model: { getWorkspaceToken: () => workspaceToken } };
  wizard.modal = modal;
  wizard.client = {
    preparePlan: () => new Promise((resolve) => { resolvePrepare = resolve; }),
  };
  wizard.preview = null;
  wizard.decisions = { packageMatches: {}, fieldConflicts: {}, fieldValues: {} };
  wizard.prepareController = null;
  wizard.applyController = { aborted: false, abort() { this.aborted = true; } };
  wizard.requestGeneration = 0;
  wizard.workspaceLease = "org-1";
  wizard.debouncedPrepare = { cancelled: false, cancel() { this.cancelled = true; } };

  const pending = wizard.prepare();
  workspaceToken = "org-2";
  resolvePrepare({ previewId: "stale-preview", blockingIssues: [], packages: [] });
  await pending;
  assert.equal(wizard.preview, null);
  assert.match(status.textContent, /workspace/i);

  wizard.preview = { previewId: "authority-to-clear" };
  wizard.cleanup();
  assert.equal(wizard.preview, null);
  assert.deepEqual(wizard.decisions, {
    packageMatches: {}, fieldConflicts: {}, fieldValues: {},
  });
  assert.equal(wizard.applyController.aborted, true);
  assert.equal(wizard.debouncedPrepare.cancelled, true);
  assert.equal(applyButton.disabled, true);
});


test("sequential revision controller never skips or advances after failed save", async () => {
  const loaded = [];
  let shouldFail = true;
  const controller = new SequentialRevisionController({
    revisions: [
      { revisionNumber: "02" },
      { revisionNumber: "00" },
      { revisionNumber: "01" },
    ],
    loadRevision: async (revision) => loaded.push(revision.revisionNumber),
    saveRevision: async () => {
      if (shouldFail) throw new Error("save failed");
      return { ok: true };
    },
  });

  assert.equal(controller.current().revisionNumber, "00");
  assert.equal(controller.hasNext(), true);
  await controller.loadCurrent();
  await assert.rejects(() => controller.saveCurrent(), /save failed/);
  assert.equal(controller.current().revisionNumber, "00");
  assert.equal(controller.state, "EDITING_REVISION");

  shouldFail = false;
  await controller.saveCurrent();
  assert.equal(controller.state, "WAITING_NEXT_CONFIRMATION");
  await controller.next();
  assert.equal(controller.current().revisionNumber, "01");
  assert.deepEqual(loaded, ["00", "01"]);
  controller.cancel();
  assert.equal(controller.state, "CANCELLED");
});

test("choosing no after plan 00 cancels remaining server revisions", async () => {
  const calls = [];
  const sequential = new SequentialRevisionController({
    revisions: [{ revisionNumber: "00" }, { revisionNumber: "01" }],
    loadRevision: async () => ({}), saveRevision: async () => ({ ok: true }),
  });
  await sequential.loadCurrent();
  const controller = {
    model: { getWorkspaceToken: () => "lease-1", workspaceStorage: null },
    procurementPlanImport: {
      session: { sessionId: "session-1" }, controller: sequential,
      currentDraft: { revisionNumber: "00" },
      client: { cancelImportSession: async (...args) => calls.push(args) },
    },
    view: { customConfirm: async () => false },
  };
  controller.completeProcurementPlanImportRevision = completeProcurementPlanImportRevision.bind(controller);

  await controller.completeProcurementPlanImportRevision("plan-00");

  assert.deepEqual(calls, [["session-1", { workspaceLease: "lease-1", kind: "plan" }]]);
  assert.equal(sequential.state, "CANCELLED");
  assert.equal(controller.procurementPlanImport, null);
});

test("package 00 continues with 01 from prepared session without upstream prepare", async () => {
  const loaded = [];
  const sequential = new SequentialRevisionController({
    revisions: [{ revisionNumber: "00" }, { revisionNumber: "01" }],
    loadRevision: async (revision) => {
      loaded.push(revision.revisionNumber);
      return {
        revisionNumber: revision.revisionNumber,
        packageDrafts: [{ maGoiThau: "IB2600000001" }],
      };
    },
    saveRevision: async () => ({ ok: true }),
  });
  const firstDraft = await sequential.loadCurrent();
  const controller = {
    model: { workspaceStorage: null },
    procurementPackageImport: {
      session: { sessionId: "session-1" }, controller: sequential,
      currentDraft: firstDraft,
    },
    view: { customConfirm: async () => true },
    packages: { edit: async () => undefined },
  };
  controller.completeProcurementPackageImportRevision = completeProcurementPackageImportRevision.bind(controller);

  await controller.completeProcurementPackageImportRevision("package-00");

  assert.deepEqual(loaded, ["00", "01"]);
  assert.equal(controller.procurementPackageImport.currentDraft.revisionNumber, "01");
});

test("direct package import saves exactly 00 01 02 from one prepared session", async () => {
  const loaded = [];
  const saved = [];
  const sequential = new SequentialRevisionController({
    revisions: [
      { revisionNumber: "02" },
      { revisionNumber: "00" },
      { revisionNumber: "01" },
    ],
    loadRevision: async (revision) => {
      loaded.push(revision.revisionNumber);
      return {
        revisionNumber: revision.revisionNumber,
        packageDrafts: [{
          maGoiThau: "IB2600000001",
          tenGoiThau: `Gói ${revision.revisionNumber}`,
          sourceRevision: { revisionNumber: revision.revisionNumber },
        }],
      };
    },
    saveRevision: async (revision, savedPackageId) => {
      saved.push({ revisionNumber: revision.revisionNumber, savedPackageId });
      return { ok: true };
    },
  });
  const firstDraft = await sequential.loadCurrent();
  const filled = [];
  const previousDocument = globalThis.document;
  globalThis.document = { getElementById: () => null };
  const controller = {
    model: { workspaceStorage: null },
    procurementPackageImport: {
      session: { sessionId: "session-1" },
      controller: sequential,
      currentDraft: firstDraft,
      sourcePackageDraft: firstDraft.packageDrafts[0],
    },
    view: {
      customConfirm: async () => true,
      customAlert: async () => undefined,
    },
    packages: {
      edit: async (id) => filled.push(id),
    },
  };
  controller.completeProcurementPackageImportRevision = (
    completeProcurementPackageImportRevision.bind(controller)
  );

  try {
    await controller.completeProcurementPackageImportRevision("package-00");
    await controller.completeProcurementPackageImportRevision("package-01");
    await controller.completeProcurementPackageImportRevision("package-02");
  } finally {
    if (previousDocument === undefined) delete globalThis.document;
    else globalThis.document = previousDocument;
  }

  assert.deepEqual(loaded, ["00", "01", "02"]);
  assert.deepEqual(saved, [
    { revisionNumber: "00", savedPackageId: "package-00" },
    { revisionNumber: "01", savedPackageId: "package-01" },
    { revisionNumber: "02", savedPackageId: "package-02" },
  ]);
  assert.deepEqual(filled, ["package-00", "package-01"]);
  assert.equal(controller.procurementPackageImport, null);
  assert.equal(sequential.state, "COMPLETED");
});

test("authoritative package versioning ignores date heuristics and follows source revision", () => {
  const previous = {
    phienBan: "01",
    thoiGianDangTai: "2026-01-01T09:00:00",
    thoiGianDongThau: "2026-01-10T09:00:00",
    thoiGianMoThau: "2026-01-10T09:00:00",
  };
  const changedDates = {
    thoiGianDangTai: "2026-02-01T09:00:00",
    thoiGianDongThau: "2026-02-10T09:00:00",
    thoiGianMoThau: "2026-02-10T09:00:00",
  };

  assert.equal(shouldCreatePackageVersion(previous, changedDates, {
    provider: "MUASAMCONG", revisionNumber: "01",
  }), false);
  assert.equal(shouldCreatePackageVersion(previous, changedDates, {
    provider: "MUASAMCONG", revisionNumber: "02",
  }), true);
  assert.equal(shouldCreatePackageVersion(previous, changedDates), true);
});

test("investor resolver reuses normalized code and does not call external lookup", async () => {
  let lookupCalls = 0;
  const existing = { id: "investor-1", maChuDauTu: "ABC", maSoThue: "0101" };
  const result = await resolveImportedInvestorDraft({
    source: { code: "abc-01", taxCode: "0101" },
    records: [existing],
    lookup: async () => { lookupCalls += 1; },
  });
  assert.equal(result.status, "EXISTING");
  assert.equal(result.investor, existing);
  assert.equal(lookupCalls, 0);
});

test("investor resolver reuses an existing investor by normalized tax code", async () => {
  let lookupCalls = 0;
  const existing = {
    id: "investor-tax", maChuDauTu: "OTHER-CODE", maSoThue: "0101234567",
  };
  const result = await resolveImportedInvestorDraft({
    source: { code: "missing-code", taxCode: " 0101234567 " },
    records: [existing],
    lookup: async () => { lookupCalls += 1; },
  });

  assert.equal(result.status, "EXISTING");
  assert.equal(result.investor, existing);
  assert.equal(lookupCalls, 0);
});

test("investor short name is derived only from a QĐ decision suffix", () => {
  assert.equal(deriveInvestorShortName("547-QĐ/BPTTH"), "BPTTH");
  assert.equal(deriveInvestorShortName("1679/QĐ-BVQY"), "BVQY");
  assert.equal(deriveInvestorShortName(" 1679 / QĐ - bvqy "), "BVQY");
  assert.equal(deriveInvestorShortName("1679/BVQY"), "");
  assert.equal(deriveInvestorShortName("1679/QĐ-BVQY/2026"), "");
  assert.equal(deriveInvestorShortName(""), "");
});

test("investor resolver creates one pending initial version through shared validation", async () => {
  const result = await resolveImportedInvestorDraft({
    source: {
      code: "vn0101234567-01",
      approvalDecisionNo: "547-QĐ/BPTTH",
    },
    records: [],
    lookup: async () => ({
      org_code: "vn0101234567", tax_code: "0101234567", name: "Bệnh viện A",
      representative_name: "Nguyễn Văn A", representative_position: "Giám đốc",
      address: "Số 1, Hà Nội",
    }),
    createId: () => "investor-draft",
    timestamp: "2026-08-13 10:00:00",
    effectiveDate: "2026-08-13",
  });
  assert.equal(result.status, "NEW");
  assert.equal(result.investor.id, "investor-draft");
  assert.equal(result.investor.phienBan, "00");
  assert.equal(result.investor.tenVietTat, "BPTTH");
  assert.equal(result.investor.maChuDauTu, "vn0101234567");
  assert.equal(result.investor.tenChuDauTu, "Bệnh viện A");
});

test("investor resolver leaves short name blank for an unsupported decision format", async () => {
  const result = await resolveImportedInvestorDraft({
    source: {
      code: "vn0101234567",
      approvalDecisionNo: "547/BPTTH",
    },
    records: [],
    lookup: async () => ({
      org_code: "vn0101234567", tax_code: "0101234567", name: "Hospital A",
      short_name: "UPSTREAM", representative_name: "Nguyen Van A",
      representative_position: "Director", address: "1 Hanoi",
    }),
    createId: () => "investor-draft",
  });

  assert.equal(result.investor.tenVietTat, "");
});

test("investor resolver retry reuses the pending version without another lookup", async () => {
  const records = [];
  let lookupCalls = 0;
  const options = {
    source: { code: "vn0101234567-01" },
    records,
    lookup: async () => {
      lookupCalls += 1;
      return {
        org_code: "vn0101234567", tax_code: "0101234567",
        name: "Bệnh viện A", representative_name: "Nguyễn Văn A",
        representative_position: "Giám đốc", address: "Số 1, Hà Nội",
      };
    },
    createId: () => "investor-draft",
    timestamp: "2026-08-13 10:00:00",
    effectiveDate: "2026-08-13",
  };
  const first = await resolveImportedInvestorDraft(options);
  records.push(first.investor);
  const retried = await resolveImportedInvestorDraft(options);

  assert.equal(first.status, "NEW");
  assert.equal(retried.status, "EXISTING");
  assert.equal(retried.investor.id, "investor-draft");
  assert.equal(lookupCalls, 1);
});

test("investor resolver rechecks local records after lookup before creating", async () => {
  const records = [];
  const intervening = {
    id: "investor-authoritative", maChuDauTu: "vn0101234567",
    maSoThue: "0101234567",
  };
  const result = await resolveImportedInvestorDraft({
    source: { code: "vn0101234567-01" },
    records,
    lookup: async () => {
      records.push(intervening);
      return {
        org_code: "vn0101234567", tax_code: "0101234567",
        name: "Bệnh viện A", representative_name: "Nguyễn Văn A",
        representative_position: "Giám đốc", address: "Số 1, Hà Nội",
      };
    },
    createId: () => assert.fail("intervening local investor must be reused"),
  });

  assert.equal(result.status, "EXISTING");
  assert.equal(result.investor, intervening);
});

test("manual and imported investor creation share normalization validation and versioning", async () => {
  const sourceRecord = {
    maChuDauTu: " vn0101234567-01 ", maSoThue: " 0101234567 ",
    tenChuDauTu: "  BỆNH VIỆN   A ", daiDienCdt: " nguyễn   văn a ",
    chucVuDaiDien: "Giám đốc", diaChi: "Số 1, Hà Nội",
    email: "invalid-email",
  };
  const normalized = normalizePartnerRecord(sourceRecord, PARTNER_FORM_CONFIGS.chudautu);
  const manualErrors = validatePartnerRecord(
    normalized, [], null, PARTNER_FORM_CONFIGS.chudautu,
  );
  assert.ok(manualErrors.some((error) => error.controlId === "cdt-email"));

  await assert.rejects(
    () => resolveImportedInvestorDraft({
      source: { code: sourceRecord.maChuDauTu }, records: [],
      lookup: async () => ({
        org_code: sourceRecord.maChuDauTu,
        tax_code: sourceRecord.maSoThue,
        name: sourceRecord.tenChuDauTu,
        representative_name: sourceRecord.daiDienCdt,
        representative_position: sourceRecord.chucVuDaiDien,
        address: sourceRecord.diaChi,
        email: sourceRecord.email,
      }),
    }),
    /PROCUREMENT_INVESTOR_RESOLUTION_FAILED/,
  );

  const initial = buildInitialPartnerVersion(
    { ...normalized, email: "contact@example.test" },
    { id: "investor-00", timestamp: "2026-08-13T10:00:00Z" },
  );
  assert.equal(initial.phienBan, "00");
  assert.equal(initial.tenChuDauTu, "Bệnh viện a");
});

test("investor resolver rejects incomplete source data instead of inventing fields", async () => {
  await assert.rejects(
    () => resolveImportedInvestorDraft({
      source: { code: "vn0101234567" }, records: [],
      lookup: async () => ({ org_code: "vn0101234567", name: "Bệnh viện A" }),
    }),
    /PROCUREMENT_INVESTOR_RESOLUTION_FAILED/,
  );
});

test("direct package lookup prepares all revisions and starts at 00", async () => {
  const controls = new Map([
    ["form-goithau", { querySelector: () => ({ value: "" }) }],
    ["gt-ma", { value: "IB2600000001", focus() {} }],
    ["lookup", { disabled: false, dataset: {}, textContent: "Lấy dữ liệu", setAttribute() {}, removeAttribute() {} }],
    ["status", { hidden: true, dataset: {}, setAttribute() {}, textContent: "" }],
  ]);
  const calls = [];
  const controller = {
    model: { getWorkspaceToken: () => "org-1" },
    startProcurementPackageImport: async (flow) => calls.push(flow),
    view: { showToast() {} },
  };
  const lookup = new ProcurementInlineLookup({
    controller,
    client: {
      prepareNotice: async (request) => {
        calls.push(request);
        return {
          importSession: {
            sessionId: "session-package",
            revisions: [{ revisionNumber: "01" }, { revisionNumber: "00" }],
          },
        };
      },
      getPlanRevisionDraft: async (_sessionId, revisionNumber) => ({
        revisionNumber,
        packageDrafts: [{ maGoiThau: "IB2600000001", tenGoiThau: "Gói 00" }],
      }),
    },
    document: { getElementById: (id) => controls.get(id) || null },
  });

  await lookup.run({
    kind: "PACKAGE", formId: "form-goithau", codeInputId: "gt-ma",
    buttonId: "lookup", statusId: "status",
  });
  assert.equal(calls[0].revisionMode, "ALL");
  assert.equal(calls[1].currentDraft.revisionNumber, "00");
  assert.deepEqual(
    calls[1].controller.revisions.map((row) => row.revisionNumber),
    ["00", "01"],
  );
});
