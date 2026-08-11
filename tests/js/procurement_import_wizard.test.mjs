import assert from "node:assert/strict";
import test from "node:test";

import { ProcurementImportClient } from "../../frontend/procurement/ProcurementImportClient.js";
import {
  canApplyOpeningPreview,
  mapOpeningBidder,
  reconcileOpeningDrafts,
} from "../../frontend/procurement/OpeningImportWizard.js";
import {
  PlanImportWizard,
  canApplyPreview,
  createDebouncedPreparer,
  renderIssues,
  renderPackages,
  summarizePreview,
} from "../../frontend/procurement/PlanImportWizard.js";


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


test("opening mapper preserves lot, joint venture, and bid values", () => {
  const mapped = mapOpeningBidder({
    contractorCode: "0100000001",
    contractorName: "Liên danh mẫu",
    contractorType: "JOINT_VENTURE",
    lotNo: "01",
    bidPrice: 100,
    priceAfterDiscount: 90,
    jointVentureMembers: [
      { contractorCode: "0100000001", contractorName: "A", isLeader: true },
      { contractorCode: "0100000002", contractorName: "B" },
    ],
  });

  assert.equal(mapped.loaiNhaThau, "Liên danh");
  assert.equal(mapped.maPhanLo, "01");
  assert.equal(mapped.giaDuThau, 100);
  assert.equal(mapped.giaSauGiamGia, 90);
  assert.deepEqual(
    mapped.thanhVienLienDanh.map((row) => row.vaiTro),
    ["Đứng đầu liên danh", "Thành viên liên danh"],
  );
  assert.equal(
    canApplyOpeningPreview(
      { previewId: "p", package: { id: "package-1", rowVersion: 3 } },
      { id: "package-1", rowVersion: 3 },
    ),
    true,
  );
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
  wizard.controller = { model: { activeWorkspaceLease: "org-1" } };
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
  wizard.controller.model.activeWorkspaceLease = "org-2";
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
