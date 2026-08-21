import { ProcurementImportClient } from "./ProcurementImportClient.js";
import { SequentialRevisionController } from "./SequentialRevisionController.js";
import {
  materializeProcurementRevisionDraft,
  materializeProcurementRevisionIntoExisting,
  materializeProcurementRevisionFromPrevious,
  procurementRevisionNumbersEqual,
} from "./ProcurementDraftWorkflow.js";
import { resolveImportedInvestorDraft } from "./InvestorResolver.js";
import { lookupPartnerInfo } from "../partners/partnerTaxLookup.js";
import {
  forgetProcurementImportSession,
  rememberProcurementImportSession,
} from "./ProcurementImportResume.js";
import { packageNoticeLabel, planPreviewFields } from "./fieldMapping.js";
import {
  captureWorkspaceLease,
  currentWorkspaceToken,
  isWorkspaceLeaseCurrent,
  workspaceChangedError,
} from "../app/workspaceLease.js";
import {
  createPlanVersionDraftSession,
  discardPlanVersionDraftForImportSession,
  findPlanVersionDraftSession,
  refreshPlanVersionDraftSession,
  savePlanVersionDraftSession,
} from "../plans/PlanVersionDraftSession.js";

const TERMINAL_STATUSES = new Set(["COMPLETED", "PARTIAL", "FAILED"]);
const DRAFT_KEY = "procurement_plan_import_draft_v1";
const PLAN_IMPORT_MATERIALIZATION_STATE_KEYS = Object.freeze([
  "chudautu",
  "kehoach",
  "goithau",
  "goithauhanghoa",
  "thongtinmothau",
  "hanghoaduthaunhathau",
  "assignments",
  "selectedPlanVersion",
  "selectedPackageVersion",
  "selectedPackageVersionIntent",
]);

export class PlanImportDraftStore {
  constructor(storage) {
    this.storage = storage;
  }

  save(value) {
    if (!this.storage) return;
    this.storage.setItem(DRAFT_KEY, JSON.stringify({
      schemaVersion: 1,
      savedAt: new Date().toISOString(),
      code: String(value?.code || ""),
      revisionMode: String(value?.revisionMode || "LATEST"),
      selectedRevision: value?.selectedRevision || null,
      investorId: value?.investorId || null,
      bundleDigest: value?.bundleDigest || null,
      decisions: value?.decisions || {
        packageMatches: {}, fieldConflicts: {}, fieldValues: {},
      },
    }));
  }

  load() {
    if (!this.storage) return null;
    try {
      const value = JSON.parse(this.storage.getItem(DRAFT_KEY) || "null");
      return value?.schemaVersion === 1 ? value : null;
    } catch {
      return null;
    }
  }

  clear() {
    this.storage?.removeItem(DRAFT_KEY);
  }
}

export function summarizePreview(preview) {
  const packages = Array.isArray(preview?.packages) ? preview.packages : [];
  return packages.reduce((summary, row) => {
    const action = String(row.action || "UNKNOWN");
    summary.total += 1;
    summary[action] = (summary[action] || 0) + 1;
    return summary;
  }, { total: 0 });
}

function activeRevisionIds(preview) {
  const explicit = preview?.importSession?.activeRevisionIds;
  if (Array.isArray(explicit) && explicit.length) return new Set(explicit.map(String));
  const revisions = preview?.importSession?.revisions;
  return new Set(
    Array.isArray(revisions)
      ? revisions.map((row) => String(row?.revisionId || "")).filter(Boolean)
      : [],
  );
}

function decisionObservationKey(row) {
  const observationId = String(row?.planDetailRevisionId || row?.packageObservationId || "");
  const revisionId = String(row?.sourceRevisionId || row?.revisionId || "");
  return revisionId && observationId ? `${revisionId}::${observationId}` : observationId;
}

function splitDecisionObservationKey(value) {
  const text = String(value || "");
  const marker = text.indexOf("::");
  if (marker < 0) return { revisionId: null, packageObservationId: text };
  return {
    revisionId: text.slice(0, marker) || null,
    packageObservationId: text.slice(marker + 2),
  };
}

function decisionKeyForPreview(row, preview) {
  const active = activeRevisionIds(preview);
  if (active.size && row?.sourceRevisionId) return decisionObservationKey(row);
  return String(row?.planDetailRevisionId || row?.packageObservationId || "");
}

function decisionPackageRows(preview) {
  const active = activeRevisionIds(preview);
  const rows = new Map();
  [...(preview?.packages || []), ...(preview?.decisionPackages || [])].forEach((row) => {
    const sourceRevisionId = String(row?.sourceRevisionId || "");
    if (sourceRevisionId && active.size && !active.has(sourceRevisionId)) return;
    const key = `${sourceRevisionId || "latest"}:${row.planDetailRevisionId || row.symbol || ""}`;
    rows.set(key, row);
  });
  return [...rows.values()];
}

export function buildSequentialDecisionPayload(decisions, investorId) {
  const splitKey = (key) => {
    const separator = String(key).lastIndexOf(":");
    const observation = separator < 0
      ? String(key)
      : String(key).slice(0, separator);
    return {
      ...splitDecisionObservationKey(observation),
      field: separator < 0 ? "" : String(key).slice(separator + 1),
    };
  };
  return {
    investorId: String(investorId || "").trim() || null,
    packageMatches: Object.entries(decisions?.packageMatches || {}).map(
      ([key, value]) => {
        const parsed = splitDecisionObservationKey(key);
        return {
          ...(parsed.revisionId ? { revisionId: parsed.revisionId } : {}),
          packageObservationId: parsed.packageObservationId,
          ...value,
        };
      },
    ),
    fieldConflicts: Object.entries(decisions?.fieldConflicts || {}).map(
      ([key, resolution]) => {
        const { revisionId, packageObservationId, field } = splitKey(key);
        return { ...(revisionId ? { revisionId } : {}), packageObservationId, field, resolution };
      },
    ),
    fieldValues: Object.entries(decisions?.fieldValues || {}).map(([key, value]) => {
      const { revisionId, packageObservationId, field } = splitKey(key);
      return { ...(revisionId ? { revisionId } : {}), packageObservationId, field, value };
    }),
  };
}

export function canStartSequentialImport(preview, context) {
  if (!preview?.importSession?.sessionId) return false;
  const enrichmentStatus = String(
    preview?.enrichmentStatus
    || preview?.importSession?.enrichmentStatus
    || "COMPLETED",
  ).toUpperCase();
  if (enrichmentStatus !== "COMPLETED") return false;
  if (!context) {
    return !decisionPackageRows(preview).some((row) => row.action === "AMBIGUOUS");
  }
  const decisions = context.decisions || {};
  if (!String(context.investorId || "").trim()) return false;
  const matches = decisions.packageMatches || {};
  const conflicts = decisions.fieldConflicts || {};
  const fieldValues = decisions.fieldValues || {};
  const active = activeRevisionIds(preview);
  if (decisionPackageRows(preview).some((row) => {
    const observationId = decisionKeyForPreview(row, preview);
    if (row.action === "AMBIGUOUS" && !matches[observationId]) return true;
    return (row.fieldConflicts || []).some(
      (conflict) => !conflicts[
        `${observationId}:${String(conflict.field || "")}`
      ],
    );
  })) return false;
  return !(preview.blockingIssues || []).some((issue) => {
    if (
      issue.sourceRevisionId
      && active.size
      && !active.has(String(issue.sourceRevisionId))
    ) return false;
    if (
      issue.code !== "PROCUREMENT_REQUIRED_FIELDS_MISSING"
      || !issue.packageObservationId
      || !issue.field
    ) return false;
    const value = fieldValues[
      `${decisionKeyForPreview(issue, preview)}:${String(issue.field || "")}`
    ];
    return value === undefined || value === null || String(value).trim() === "";
  });
}

export function createDebouncedPreparer(callback, delay = 600, timers = globalThis) {
  let timer = null;
  return {
    schedule(...args) {
      if (timer !== null) timers.clearTimeout(timer);
      timer = timers.setTimeout(() => {
        timer = null;
        callback(...args);
      }, delay);
    },
    cancel() {
      if (timer !== null) timers.clearTimeout(timer);
      timer = null;
    },
  };
}

function appendText(parent, tagName, text, className = "") {
  const element = parent.ownerDocument.createElement(tagName);
  if (className) element.className = className;
  element.textContent = String(text ?? "");
  parent.append(element);
  return element;
}

function renderPlan(modal, preview) {
  const target = modal.querySelector("[data-procurement-plan-preview]");
  target.replaceChildren();
  planPreviewFields(preview).forEach(([label, value]) => {
    const row = target.ownerDocument.createElement("div");
    row.className = "procurement-import__fact";
    appendText(row, "dt", label);
    appendText(row, "dd", value);
    target.append(row);
  });
}

function appendDecisionSelect(parent, { label, dataAttribute, observationId, options }) {
  const select = parent.ownerDocument.createElement("select");
  select.setAttribute("aria-label", label);
  select.dataset[dataAttribute] = observationId;
  const placeholder = select.ownerDocument.createElement("option");
  placeholder.value = "";
  placeholder.textContent = "-- Chọn quyết định --";
  select.append(placeholder);
  options.forEach(({ value, text }) => {
    const option = select.ownerDocument.createElement("option");
    option.value = value;
    option.textContent = text;
    select.append(option);
  });
  parent.append(select);
  return select;
}

export function renderPackages(modal, preview) {
  const body = modal.querySelector("[data-procurement-packages]");
  body.replaceChildren();
  decisionPackageRows(preview).forEach((pkg) => {
    const row = body.ownerDocument.createElement("tr");
    row.dataset.action = pkg.action || "UNKNOWN";
    appendText(row, "td", pkg.symbol || "—");
    appendText(row, "td", pkg.name || "—");
    appendText(row, "td", packageNoticeLabel(pkg));
    const revisionLabel = pkg.sourceRevisionNumber
      ? `PB ${pkg.sourceRevisionNumber} · `
      : "";
    const actionCell = appendText(row, "td", `${revisionLabel}${pkg.action || "UNKNOWN"}`);
    actionCell.className = "procurement-import__action";
    const observationId = decisionObservationKey(pkg);
    if (pkg.action === "AMBIGUOUS") {
      appendDecisionSelect(actionCell, {
        label: `Ghép gói ${pkg.symbol || pkg.name || observationId}`,
        dataAttribute: "procurementMatch",
        observationId,
        options: [
          ...(pkg.matchCandidates || []).map((candidate) => ({
            value: String(candidate.rootId || ""),
            text: `${candidate.symbol || "—"} · ${candidate.name || candidate.rootId}`,
          })),
          { value: "__NEW__", text: "Đây là gói mới" },
        ],
      });
    }
    (pkg.fieldConflicts || []).forEach((conflict) => {
      const select = appendDecisionSelect(actionCell, {
        label: `Xử lý xung đột ${conflict.field} của gói ${pkg.symbol || observationId}`,
        dataAttribute: "procurementConflict",
        observationId,
        options: [
          { value: "KEEP_LOCAL", text: `Giữ nội bộ · ${conflict.field}` },
          { value: "APPLY_SOURCE", text: `Dùng nguồn · ${conflict.field}` },
        ],
      });
      select.dataset.field = conflict.field;
    });
    body.append(row);
  });
}

export function renderIssues(modal, preview) {
  const target = modal.querySelector("[data-procurement-issues]");
  target.replaceChildren();
  const active = activeRevisionIds(preview);
  const scopedIssues = (preview.blockingIssues || []).filter((item) => (
    !item.sourceRevisionId
    || !active.size
    || active.has(String(item.sourceRevisionId))
  ));
  const items = [
    ...scopedIssues.map((item) => ({ ...item, blocking: true })),
    ...(preview.warnings || []),
  ];
  items.forEach((item) => {
    const row = target.ownerDocument.createElement("li");
    appendText(
      row, "span",
      item.message || `${item.code}${item.field ? ` · ${item.field}` : ""}`,
    );
    row.className = item.blocking
      ? "procurement-import__issue is-blocking"
      : "procurement-import__issue";
    if (item.blocking && item.packageObservationId && item.field) {
      const input = target.ownerDocument.createElement("input");
      input.type = item.field === "priceVnd" ? "number" : "text";
      input.min = item.field === "priceVnd" ? "0" : "";
      input.dataset.procurementFieldValue = decisionObservationKey(item);
      input.dataset.field = String(item.field);
      input.setAttribute(
        "aria-label",
        `Bổ sung ${item.field} cho gói ${item.packageObservationId}`,
      );
      row.append(input);
    }
    target.append(row);
  });
  target.hidden = items.length === 0;
}

function optionExists(select, value) {
  return [...(select?.options || select?.children || [])]
    .some((option) => String(option?.value ?? "") === String(value ?? ""));
}

export function rehydrateDecisionControls(modal, preview, decisions, investorId = null) {
  const next = {
    packageMatches: { ...(decisions?.packageMatches || {}) },
    fieldConflicts: { ...(decisions?.fieldConflicts || {}) },
    fieldValues: { ...(decisions?.fieldValues || {}) },
  };
  const allowedMatches = new Set();
  const allowedConflicts = new Set();
  const allowedFields = new Set();
  const body = modal.querySelector("[data-procurement-packages]");
  for (const row of body?.children || []) {
    const actionCell = row.children?.[3];
    for (const control of actionCell?.children || []) {
      const key = String(control.dataset?.procurementMatch || "");
      if (key) {
        allowedMatches.add(key);
        const decision = next.packageMatches[key];
        const value = decision?.new ? "__NEW__" : decision?.localRootId || "";
        if (value && optionExists(control, value)) control.value = value;
        else delete next.packageMatches[key];
      }
      const conflictKey = control.dataset?.procurementConflict
        ? `${control.dataset.procurementConflict}:${control.dataset.field || ""}`
        : "";
      if (conflictKey) {
        allowedConflicts.add(conflictKey);
        const value = next.fieldConflicts[conflictKey];
        if (value && optionExists(control, value)) control.value = value;
        else delete next.fieldConflicts[conflictKey];
      }
    }
  }
  const issues = modal.querySelector("[data-procurement-issues]");
  for (const row of issues?.children || []) {
    for (const control of row.children || []) {
      const key = control.dataset?.procurementFieldValue
        ? `${control.dataset.procurementFieldValue}:${control.dataset.field || ""}`
        : "";
      if (!key) continue;
      allowedFields.add(key);
      if (Object.hasOwn(next.fieldValues, key)) {
        control.value = String(next.fieldValues[key] ?? "");
      } else {
        delete next.fieldValues[key];
      }
    }
  }
  Object.keys(next.packageMatches).forEach((key) => {
    if (!allowedMatches.has(key)) delete next.packageMatches[key];
  });
  Object.keys(next.fieldConflicts).forEach((key) => {
    if (!allowedConflicts.has(key)) delete next.fieldConflicts[key];
  });
  Object.keys(next.fieldValues).forEach((key) => {
    if (!allowedFields.has(key)) delete next.fieldValues[key];
  });
  const investor = modal.querySelector("[data-procurement-investor]");
  const restoredInvestorId = String(investorId || "").trim();
  const visibleInvestorId = restoredInvestorId && optionExists(investor, restoredInvestorId)
    ? restoredInvestorId
    : "";
  if (investor) investor.value = visibleInvestorId;
  return { decisions: next, investorId: visibleInvestorId || null };
}

function renderRevisions(modal, preview) {
  const select = modal.querySelector("[data-procurement-revision]");
  select.replaceChildren();
  (preview.plan?.availableRevisions || []).forEach((revision) => {
    const option = select.ownerDocument.createElement("option");
    option.value = revision;
    option.textContent = `Phiên bản nguồn ${revision}`;
    option.selected = (preview.plan?.selectedRevisions || []).includes(revision);
    select.append(option);
  });
}

export class PlanImportWizard {
  constructor({ controller, modal, client = new ProcurementImportClient() }) {
    this.controller = controller;
    this.modal = modal;
    this.client = client;
    this.preview = null;
    this.decisions = { packageMatches: {}, fieldConflicts: {}, fieldValues: {} };
    this.prepareController = null;
    this.applyController = null;
    this.enrichmentController = null;
    this.requestGeneration = 0;
    this.workspaceLease = currentWorkspaceToken(controller?.model);
    this.draftStore = new PlanImportDraftStore(
      controller?.model?.workspaceStorage || null,
    );
    this.debouncedPrepare = createDebouncedPreparer(() => this.prepare(), 600);
    this.bind();
  }

  bind() {
    const code = this.modal.querySelector("[data-procurement-code]");
    code.addEventListener("input", () => {
      this.preview = null;
      this.setStatus("Đang chờ mã KHLCNT hợp lệ…");
      this.debouncedPrepare.schedule();
    });
    code.addEventListener("keydown", (event) => {
      if (event.key === "Enter") {
        event.preventDefault();
        this.debouncedPrepare.cancel();
        this.prepare();
      }
    });
    this.modal.querySelector("[data-procurement-prepare]").addEventListener("click", () => this.prepare());
    this.modal.querySelector("[data-procurement-apply]").addEventListener("click", () => this.apply());
    this.modal.querySelectorAll("[data-close='modal-procurement-import']").forEach((button) => {
      button.addEventListener("click", () => this.cleanup());
    });
    this.modal.addEventListener("change", (event) => this.captureDecision(event));
    this.modal.addEventListener("input", (event) => this.captureDecision(event));
  }

  saveDraft() {
    this.draftStore.save({
      code: this.modal.querySelector("[data-procurement-code]")?.value,
      revisionMode: this.modal.querySelector("[data-procurement-mode]")?.value,
      selectedRevision: this.modal.querySelector("[data-procurement-revision]")?.value || null,
      investorId: this.modal.querySelector("[data-procurement-investor]")?.value || null,
      bundleDigest: this.preview?.bundleDigest || null,
      decisions: this.decisions,
    });
  }

  restoreDraft() {
    const draft = this.draftStore.load();
    if (!draft) return null;
    const code = this.modal.querySelector("[data-procurement-code]");
    const mode = this.modal.querySelector("[data-procurement-mode]");
    const revision = this.modal.querySelector("[data-procurement-revision]");
    const investor = this.modal.querySelector("[data-procurement-investor]");
    if (code && draft.code) code.value = draft.code;
    if (mode && draft.revisionMode) mode.value = draft.revisionMode;
    if (revision && draft.selectedRevision) revision.value = draft.selectedRevision;
    if (investor && draft.investorId) investor.value = draft.investorId;
    return draft;
  }

  captureDecision(event) {
    const target = event.target;
    if (!(target instanceof globalThis.HTMLElement)) return;
    if (target.dataset.procurementMatch) {
      const value = target.value;
      if (!value) delete this.decisions.packageMatches[target.dataset.procurementMatch];
      else this.decisions.packageMatches[target.dataset.procurementMatch] = value === "__NEW__"
        ? { new: true }
        : { localRootId: value };
    }
    if (target.dataset.procurementConflict) {
      const key = `${target.dataset.procurementConflict}:${target.dataset.field || ""}`;
      if (target.value) this.decisions.fieldConflicts[key] = target.value;
      else delete this.decisions.fieldConflicts[key];
    }
    if (target.dataset.procurementFieldValue) {
      const key = `${target.dataset.procurementFieldValue}:${target.dataset.field || ""}`;
      this.decisions.fieldValues[key] = target.value;
    }
    this.saveDraft();
    this.refreshApplyGate();
  }

  refreshApplyGate() {
    const button = this.modal.querySelector("[data-procurement-apply]");
    if (button) button.disabled = !canStartSequentialImport(this.preview, {
      decisions: this.decisions,
      investorId: this.modal.querySelector("[data-procurement-investor]")?.value,
    });
  }

  setStatus(message, urgent = false) {
    const status = this.modal.querySelector("[data-procurement-status]");
    status.setAttribute("aria-live", urgent ? "assertive" : "polite");
    status.textContent = message;
  }

  async prepare() {
    const modal = this.modal;
    const codeControl = modal.querySelector("[data-procurement-code]");
    const code = codeControl.value.trim();
    if (!/^PL\d{10}(?:-\d{2})?$/i.test(code)) {
      this.setStatus("Mã KHLCNT phải có dạng PL + 10 chữ số, có thể kèm -00, -01…", true);
      return;
    }
    const generation = ++this.requestGeneration;
    this.prepareController?.abort();
    this.prepareController = new AbortController();
    const mode = this.modal.querySelector("[data-procurement-mode]").value;
    const selectedRevision = this.modal.querySelector("[data-procurement-revision]").value || null;
    const requestWorkspaceLease = this.workspaceLease;
    const originLease = captureWorkspaceLease(this.controller?.model);
    const originStorage = this.controller?.model?.workspaceStorage;
    const isPrepareCapabilityCurrent = () => (
      generation === this.requestGeneration
      && this.modal === modal
      && modal.querySelector("[data-procurement-code]") === codeControl
      && codeControl.value.trim() === code
      && requestWorkspaceLease === originLease.token
      && isWorkspaceLeaseCurrent(this.controller?.model, originLease)
      && this.controller?.model?.workspaceStorage === originStorage
    );
    this.setStatus("Đang chuẩn bị preview từ nguồn…");
    try {
      const preview = await this.client.preparePlan({
        code,
        revisionMode: mode,
        selectedRevision: mode === "SELECTED" ? selectedRevision : null,
        includeLinkedNotices: true,
        workspaceLease: this.workspaceLease || null,
      }, { signal: this.prepareController.signal });
      if (!isPrepareCapabilityCurrent()) return;
      this.preview = preview;
      const draft = this.draftStore.load();
      this.decisions = (
        draft?.bundleDigest === preview.bundleDigest && draft?.decisions
      ) ? draft.decisions : {
        packageMatches: {}, fieldConflicts: {}, fieldValues: {},
      };
      renderPlan(this.modal, preview);
      renderPackages(this.modal, preview);
      renderIssues(this.modal, preview);
      renderRevisions(this.modal, preview);
      const rehydrated = rehydrateDecisionControls(
        this.modal,
        preview,
        this.decisions,
        draft?.investorId || this.modal.querySelector("[data-procurement-investor]")?.value,
      );
      this.decisions = rehydrated.decisions;
      if (rehydrated.investorId) {
        const investor = this.modal.querySelector("[data-procurement-investor]");
        if (investor) investor.value = rehydrated.investorId;
      }
      const summary = summarizePreview(preview);
      this.modal.querySelector("[data-procurement-summary]").textContent =
        `${summary.total} gói · ${preview.plan?.selectedRevisions?.length || 0} phiên bản nguồn`;
      this.refreshApplyGate();
      this.saveDraft();
      const enrichmentPending = preview.enrichmentStatus === "PENDING";
      this.setStatus(
        enrichmentPending
          ? "Preview kế hoạch đã sẵn sàng; đang bổ sung đầy đủ dữ liệu TBMT liên kết…"
          : canStartSequentialImport(preview, {
            decisions: this.decisions,
            investorId: this.modal.querySelector("[data-procurement-investor]")?.value,
          })
            ? "Dữ liệu đã sẵn sàng. Phiên bản đầu tiên sẽ mở trong biểu mẫu Kế hoạch."
            : "Preview còn trường hợp ghép gói mơ hồ hoặc enrichment chưa hoàn tất.",
        !enrichmentPending && !canStartSequentialImport(preview, {
          decisions: this.decisions,
          investorId: this.modal.querySelector("[data-procurement-investor]")?.value,
        }),
      );
      if (preview.enrichmentStatus === "PENDING" && preview.enrichmentOperationId) {
        this.trackEnrichment(preview.enrichmentOperationId);
      }
    } catch (error) {
      if (!isPrepareCapabilityCurrent()) return;
      if (error?.name === "AbortError") return;
      this.setStatus(error?.message || "Không thể chuẩn bị preview.", true);
    }
  }

  async trackEnrichment(operationId) {
    this.enrichmentController?.abort();
    this.enrichmentController = new AbortController();
    const generation = this.requestGeneration;
    const preview = this.preview;
    const modal = this.modal;
    const codeControl = modal.querySelector("[data-procurement-code]");
    const code = codeControl?.value?.trim() || "";
    const originLease = captureWorkspaceLease(this.controller?.model);
    const originStorage = this.controller?.model?.workspaceStorage;
    const isEnrichmentCapabilityCurrent = () => (
      generation === this.requestGeneration
      && this.preview === preview
      && this.modal === modal
      && modal.querySelector("[data-procurement-code]") === codeControl
      && String(codeControl?.value || "").trim() === code
      && isWorkspaceLeaseCurrent(this.controller?.model, originLease)
      && this.controller?.model?.workspaceStorage === originStorage
    );
    try {
      let operation = await this.client.getOperation(operationId, {
        signal: this.enrichmentController.signal,
      });
      while (!TERMINAL_STATUSES.has(operation.status)) {
        if (!isEnrichmentCapabilityCurrent()) return;
        this.setStatus(
          `Preview kế hoạch đã sẵn sàng; đang bổ sung dữ liệu TBMT ${operation.nextRevisionIndex || 0}/${operation.totalRevisions || 0}…`,
        );
        await new Promise((resolve) => globalThis.setTimeout(resolve, 700));
        operation = await this.client.getOperation(operationId, {
          signal: this.enrichmentController.signal,
        });
      }
      if (!isEnrichmentCapabilityCurrent()) return;
      if (operation.status === "COMPLETED") {
        const previousDigest = this.preview.bundleDigest;
        let refreshedSession = null;
        if (typeof this.client.getImportSession === "function") {
          refreshedSession = await this.client.getImportSession(
            preview.importSession?.sessionId,
            {
              workspaceLease: this.workspaceLease || null,
              signal: this.enrichmentController.signal,
              kind: "plan",
            },
          );
          if (!isEnrichmentCapabilityCurrent()) return;
        }
        const refreshedDigest = refreshedSession?.bundleDigest || this.preview.bundleDigest;
        this.preview = {
          ...this.preview,
          bundleDigest: refreshedDigest,
          importSession: refreshedSession
            ? { ...this.preview.importSession, ...refreshedSession }
            : this.preview.importSession,
          decisionPackages: refreshedSession
            && Object.hasOwn(refreshedSession, "decisionPackages")
            ? refreshedSession.decisionPackages
            : this.preview.decisionPackages,
          blockingIssues: refreshedSession
            && Object.hasOwn(refreshedSession, "blockingIssues")
            ? refreshedSession.blockingIssues
            : this.preview.blockingIssues,
          enrichmentStatus: "COMPLETED",
        };
        if (refreshedDigest !== previousDigest) {
          this.decisions = {
            packageMatches: {}, fieldConflicts: {}, fieldValues: {},
          };
        }
        renderPackages(this.modal, this.preview);
        renderIssues(this.modal, this.preview);
        const rehydrated = rehydrateDecisionControls(
          this.modal,
          this.preview,
          this.decisions,
          this.modal.querySelector("[data-procurement-investor]")?.value,
        );
        this.decisions = rehydrated.decisions;
        this.refreshApplyGate();
        this.setStatus("Đã bổ sung đầy đủ dữ liệu TBMT; có thể tiếp tục nhập.");
      } else {
        this.preview = { ...this.preview, enrichmentStatus: operation.status };
        this.refreshApplyGate();
        this.setStatus("Preview kế hoạch vẫn sẵn sàng; một phần dữ liệu TBMT chưa lấy được.", true);
      }
    } catch (error) {
      if (error?.name !== "AbortError" && isEnrichmentCapabilityCurrent()) {
        this.setStatus("Preview kế hoạch vẫn sẵn sàng; enrichment nền tạm thời chưa hoàn tất.", true);
      }
    }
  }

  async apply() {
    const investorId = this.modal.querySelector("[data-procurement-investor]")?.value || null;
    if (!canStartSequentialImport(this.preview, {
      decisions: this.decisions,
      investorId,
    })) return;
    const preview = this.preview;
    const importSession = preview?.importSession;
    if (!importSession?.sessionId || !(importSession.revisions || []).length) {
      this.setStatus("Phiên nhập tuần tự chưa sẵn sàng. Hãy chuẩn bị lại dữ liệu.", true);
      return;
    }
    const generation = ++this.requestGeneration;
    const originLease = captureWorkspaceLease(this.controller?.model);
    const originStorage = this.controller?.model?.workspaceStorage;
    const flowIdentity = Object.freeze({});
    const isApplyCapabilityCurrent = () => !(
        generation !== this.requestGeneration
        || this.preview !== preview
        || this.preview?.importSession !== importSession
        || String(importSession.sessionId) !== String(preview?.importSession?.sessionId || "")
        || !isWorkspaceLeaseCurrent(this.controller?.model, originLease)
        || this.controller?.model?.workspaceStorage !== originStorage
    );
    const assertApplyCapabilityCurrent = () => {
      if (!isApplyCapabilityCurrent()) throw workspaceChangedError();
    };
    this.applyController?.abort();
    this.enrichmentController?.abort();
    this.applyController = new AbortController();
    const button = this.modal.querySelector("[data-procurement-apply]");
    button.disabled = true;
    this.setStatus("Đang mở phiên bản đầu tiên trong biểu mẫu Kế hoạch…");
    try {
      const boundSession = await this.client.bindPlanSessionDecisions(
        importSession.sessionId,
        {
          bundleDigest: preview.bundleDigest,
          decisions: buildSequentialDecisionPayload(this.decisions, investorId),
          workspaceLease: this.workspaceLease || null,
        },
        { signal: this.applyController.signal },
      );
      assertApplyCapabilityCurrent();
      Object.assign(importSession, boundSession);
      const sequential = new SequentialRevisionController({
        revisions: importSession.revisions,
        loadRevision: (revision) => this.client.getPlanRevisionDraft(
          importSession.sessionId,
          revision.revisionNumber,
          {
            workspaceLease: this.workspaceLease || null,
            signal: this.applyController.signal,
          },
        ),
        saveRevision: async () => ({ ok: true }),
      });
      const currentDraft = await sequential.loadCurrent();
      assertApplyCapabilityCurrent();
      await this.controller?.startProcurementPlanImport?.({
        session: importSession,
        controller: sequential,
        currentDraft,
        client: this.client,
        importWorkspaceLease: originLease,
        importWorkspaceStorage: originStorage,
        importFlowIdentity: flowIdentity,
      });
      assertApplyCapabilityCurrent();
      this.draftStore.clear();
      this.controller?.view?.closeModal?.("modal-procurement-import");
    } catch (error) {
      if (!isApplyCapabilityCurrent()) return;
      if (error?.name === "AbortError") return;
      this.setStatus(error?.message || "Không thể áp dụng preview.", true);
      button.disabled = false;
    }
  }

  cleanup() {
    this.requestGeneration += 1;
    this.debouncedPrepare.cancel();
    this.prepareController?.abort();
    this.applyController?.abort();
    this.preview = null;
    this.decisions = { packageMatches: {}, fieldConflicts: {}, fieldValues: {} };
    this.refreshApplyGate();
  }
}

export async function openProcurementImportWizard() {
  const lease = captureWorkspaceLease(this.model);
  const storage = this.model?.workspaceStorage;
  await this.ensureLazyModal?.("modal-procurement-import");
  if (
    !isWorkspaceLeaseCurrent(this.model, lease)
    || this.model?.workspaceStorage !== storage
  ) {
    throw workspaceChangedError();
  }
  const modal = globalThis.document.getElementById("modal-procurement-import");
  if (!modal) return;
  let wizard = modal._procurementImportWizard;
  if (!wizard) {
    wizard = new PlanImportWizard({ controller: this, modal });
    modal._procurementImportWizard = wizard;
  }
  const currentToken = currentWorkspaceToken(this.model);
  if (wizard.workspaceLease !== currentToken) {
    wizard.cleanup();
    wizard.workspaceLease = currentToken;
    wizard.draftStore = new PlanImportDraftStore(
      this.model?.workspaceStorage || null,
    );
  }
  const sourceCode = globalThis.document.getElementById("kh-ma")?.value?.trim();
  if (sourceCode) modal.querySelector("[data-procurement-code]").value = sourceCode;
  const investor = modal.querySelector("[data-procurement-investor]");
  investor.replaceChildren();
  const placeholder = investor.ownerDocument.createElement("option");
  placeholder.value = "";
  placeholder.textContent = "-- Chọn chủ đầu tư hiện hữu --";
  investor.append(placeholder);
  (this.model?.getLatestChuDauTu?.() || []).forEach((row) => {
    const option = investor.ownerDocument.createElement("option");
    option.value = row.id;
    option.textContent = `${row.maChuDauTu ? `${row.maChuDauTu} · ` : ""}${row.tenChuDauTu}`;
    investor.append(option);
  });
  const selectedInvestor = globalThis.document.getElementById("kh-chudautuid")?.value;
  if (selectedInvestor) investor.value = selectedInvestor;
  const restoredDraft = wizard.restoreDraft();
  const mode = modal.querySelector("[data-procurement-mode]");
  if (mode && !restoredDraft?.revisionMode) mode.value = "ALL";
  this.view.openModal("modal-procurement-import");
  if (sourceCode || restoredDraft?.code) wizard.debouncedPrepare.schedule();
}

function latestPlanForFamily(model, familyNo, state = model?.state) {
  const normalized = String(familyNo || "").trim().toUpperCase();
  return (state?.kehoach || [])
    .filter((plan) => (
      String(model?.getPlanBaseCode?.(plan.maKeHoach) || plan.maKeHoach || "")
        .trim().toUpperCase() === normalized
      && plan.isLatest == 1
    ))
    .sort((left, right) => Number(right.phienBan || 0) - Number(left.phienBan || 0))[0] || null;
}

export function originatePlanImportFlow(controller, flow) {
  return {
    ...flow,
    importWorkspaceLease: captureWorkspaceLease(controller?.model),
    importWorkspaceStorage: controller?.model?.workspaceStorage,
    importFlowIdentity: Object.freeze({}),
  };
}

function bindPlanImportWorkspace(controller, flow) {
  if (
    !flow?.importWorkspaceLease
    || !flow?.importFlowIdentity
    || !Object.hasOwn(flow, "importWorkspaceStorage")
  ) {
    throw new TypeError("PROCUREMENT_ORIGIN_CAPABILITY_REQUIRED");
  }
  return flow;
}

function planImportFlowChangedError() {
  const error = new Error("Procurement plan import flow changed");
  error.name = "AbortError";
  error.code = "FLOW_CHANGED";
  return error;
}

function planImportFlowIsCurrent(controller, flow, { allowUninstalled = false } = {}) {
  const current = controller?.procurementPlanImport;
  if (!current) return allowUninstalled;
  return current.importFlowIdentity === flow?.importFlowIdentity;
}

function planImportCapabilityIsCurrent(controller, flow, options = {}) {
  return isWorkspaceLeaseCurrent(controller.model, flow?.importWorkspaceLease)
    && controller.model?.workspaceStorage === flow?.importWorkspaceStorage
    && planImportFlowIsCurrent(controller, flow, options);
}

function assertPlanImportWorkspace(controller, flow, options = {}) {
  if (!planImportCapabilityIsCurrent(controller, flow, options)) {
    throw workspaceChangedError();
  }
}

function cloneMaterializationValue(value) {
  if (value === undefined) return undefined;
  return structuredClone(value);
}

function capturePlanImportMaterialization(controller) {
  const state = controller.model.state;
  return {
    state: Object.fromEntries(PLAN_IMPORT_MATERIALIZATION_STATE_KEYS.map((key) => [
      key,
      {
        present: Object.hasOwn(state, key),
        value: cloneMaterializationValue(state[key]),
      },
    ])),
    sessions: cloneMaterializationValue(
      controller.model.planVersionDraftSessions || [],
    ),
    flow: controller.procurementPlanImport || null,
    planBreakdownDraft: controller.planBreakdownDraft,
    tempPlanData: cloneMaterializationValue(controller.tempPlanData),
    tempPlanAction: controller.tempPlanAction,
  };
}

function candidatePlanImportState(state) {
  const candidate = { ...state };
  PLAN_IMPORT_MATERIALIZATION_STATE_KEYS.forEach((key) => {
    if (Object.hasOwn(state, key)) candidate[key] = cloneMaterializationValue(state[key]);
  });
  return candidate;
}

function replaceArrayInPlace(target, nextRows) {
  const existingById = new Map(
    (Array.isArray(target) ? target : []).map((row) => [String(row?.id || ""), row]),
  );
  const rows = (Array.isArray(nextRows) ? nextRows : []).map((row) => {
    const existing = existingById.get(String(row?.id || ""));
    if (!existing) return row;
    Object.keys(existing).forEach((key) => {
      if (!Object.hasOwn(row, key)) delete existing[key];
    });
    Object.assign(existing, row);
    return existing;
  });
  if (Array.isArray(target)) {
    target.splice(0, target.length, ...rows);
    return target;
  }
  return rows;
}

function publishPlanImportCandidate(controller, candidate, sessions, { invalidate = true } = {}) {
  const state = controller.model.state;
  PLAN_IMPORT_MATERIALIZATION_STATE_KEYS.forEach((key) => {
    if (!Object.hasOwn(candidate, key)) delete state[key];
    else if (Array.isArray(candidate[key])) {
      state[key] = replaceArrayInPlace(
        state[key], candidate[key],
      );
    } else {
      state[key] = candidate[key];
    }
    if (invalidate) controller.model.entityIndexes?.invalidate?.(key);
  });
  controller.model.planVersionDraftSessions = sessions;
}

function restorePlanImportMaterialization(controller, checkpoint) {
  const state = controller.model.state;
  for (const [key, captured] of Object.entries(checkpoint.state)) {
    if (!captured.present) delete state[key];
    else if (Array.isArray(captured.value)) {
      state[key] = replaceArrayInPlace(
        state[key], captured.value,
      );
    } else {
      state[key] = cloneMaterializationValue(captured.value);
    }
    controller.model.entityIndexes?.invalidate?.(key);
  }
  controller.model.planVersionDraftSessions = cloneMaterializationValue(
    checkpoint.sessions,
  );
  controller.procurementPlanImport = checkpoint.flow;
  controller.planBreakdownDraft = checkpoint.planBreakdownDraft;
  controller.tempPlanData = cloneMaterializationValue(checkpoint.tempPlanData);
  controller.tempPlanAction = checkpoint.tempPlanAction;
}

function planImportDraftResources(flow, state, sessions) {
  return {
    state,
    db: flow.importWorkspaceLease.db,
    workspaceStorage: flow.importWorkspaceStorage,
    planVersionDraftSessions: cloneMaterializationValue(sessions),
    workspaceScope: { key: flow.importWorkspaceLease.scope },
    getWorkspaceToken: () => flow.importWorkspaceLease.token,
  };
}

async function materializePlanImportRevision(controller, flow, revisionDraft, previousPlanId = null) {
  flow = bindPlanImportWorkspace(controller, flow);
  const allowUninstalled = !controller.procurementPlanImport;
  assertPlanImportWorkspace(controller, flow, { allowUninstalled });
  const checkpoint = capturePlanImportMaterialization(controller);
  const source = revisionDraft?.planDraft?.investorSource || {};
  const investorRecords = controller.model?.getLatestChuDauTu?.() || [];
  const authoritativeInvestorId = String(
    revisionDraft?.planDraft?.chuDauTuId
    || revisionDraft?.decisionAuthority?.investorId
    || "",
  ).trim();
  let investorResolution;
  if (authoritativeInvestorId) {
    const investor = investorRecords.find(
      (row) => String(row?.id || "") === authoritativeInvestorId,
    );
    if (!investor) throw new Error("PROCUREMENT_INVESTOR_RESOLUTION_FAILED");
    investorResolution = { status: "EXISTING", investor };
  } else {
    investorResolution = await resolveImportedInvestorDraft({
      source,
      records: investorRecords,
      lookup: lookupPartnerInfo,
      timestamp: controller.model.getCurrentDateTimeString(),
    });
  }
  assertPlanImportWorkspace(controller, flow, { allowUninstalled });
  const candidateState = candidatePlanImportState(controller.model.state);
  const prior = previousPlanId
    ? (candidateState.kehoach || []).find(
      (plan) => String(plan.id) === String(previousPlanId),
    )
    : latestPlanForFamily(controller.model, revisionDraft.familyNo, candidateState);
  const sameRevision = prior
    && procurementRevisionNumbersEqual(
      prior.phienBan,
      revisionDraft?.revisionNumber,
    );
  const materialized = sameRevision
    ? materializeProcurementRevisionIntoExisting(
      candidateState,
      prior.id,
      revisionDraft,
      { timestamp: controller.model.getCurrentDateTimeString() },
    )
    : prior
      ? materializeProcurementRevisionFromPrevious(
      candidateState,
      prior.id,
      revisionDraft,
      { timestamp: controller.model.getCurrentDateTimeString() },
      )
      : materializeProcurementRevisionDraft(
        candidateState,
        revisionDraft,
        { timestamp: controller.model.getCurrentDateTimeString() },
      );
  if (investorResolution.status === "NEW") {
    candidateState.chudautu ||= [];
    candidateState.chudautu.push(investorResolution.investor);
  }
  materialized.plan.chuDauTuId = investorResolution.investor.id;
  materialized.plan.sourceRevision = revisionDraft.planDraft?.sourceRevision;
  materialized.packages.forEach((pkg) => {
    pkg.keHoachId = materialized.plan.id;
  });
  const nextFlow = {
    ...flow,
    currentDraft: revisionDraft,
    currentPlanId: materialized.plan.id,
    investorResolution,
    pendingNextRevisionNumber: null,
  };
  let candidatePersisted = false;
  // MSC materialization creates a new local plan before the normal plan form
  // submits. Establish the durable aggregate draft here so the form keeps the
  // intermediate/final-save boundary instead of falling back to /api/sync.
  if (Number(materialized.plan?.rowVersion || 0) <= 0) {
    const draftResources = planImportDraftResources(flow, candidateState, checkpoint.sessions);
    const existingDraft = findPlanVersionDraftSession(draftResources, materialized.plan.id)
      || findPlanVersionDraftSession(draftResources, prior?.id);
    const extendsPersistedPlan = Boolean(
      prior && Number(prior.rowVersion || 0) > 0 && !existingDraft,
    );
    if (!extendsPersistedPlan) {
      const draftSession = existingDraft
        ? refreshPlanVersionDraftSession(
          structuredClone(existingDraft), candidateState, materialized.plan.id,
        )
        : createPlanVersionDraftSession(
          candidateState,
          materialized.plan.id,
          controller.model.getCurrentDateTimeString?.(),
        );
      if (draftSession) {
        await savePlanVersionDraftSession(draftResources, draftSession);
        candidatePersisted = true;
      }
      assertPlanImportWorkspace(controller, flow, { allowUninstalled });
      nextFlow.durableDraftSessions = draftResources.planVersionDraftSessions;
    }
  }
  assertPlanImportWorkspace(controller, flow, { allowUninstalled });
  try {
    publishPlanImportCandidate(
      controller,
      candidateState,
      nextFlow.durableDraftSessions || checkpoint.sessions,
    );
    delete nextFlow.durableDraftSessions;
    controller.planBreakdownDraft = materialized.draft;
    controller.procurementPlanImport = nextFlow;
    rememberProcurementImportSession(controller, nextFlow);
    await controller.plans.edit(materialized.plan.id, {
      keepProcurementCodeEditable: true,
      preserveProcurementLookupSelection: true,
    });
    assertPlanImportWorkspace(controller, nextFlow);
    delete nextFlow.pendingNextUiRecovery;
    return materialized;
  } catch (error) {
    if (candidatePersisted) {
      nextFlow.pendingNextUiRecovery = { planId: materialized.plan.id };
      error.procurementMaterializationDurable = true;
      if (planImportCapabilityIsCurrent(controller, flow, { allowUninstalled })) {
        publishPlanImportCandidate(
          controller,
          candidateState,
          nextFlow.durableDraftSessions || checkpoint.sessions,
          { invalidate: false },
        );
        // The durable candidate owns the next revision. Publish its flow
        // identity even when the UI hand-off failed, so retry recovery cannot
        // leave the controller on the previous source revision.
        controller.procurementPlanImport = nextFlow;
        controller.planBreakdownDraft = materialized.draft;
        controller.tempPlanData = { ...materialized.plan };
        controller.tempPlanAction = "create";
      }
    } else if (planImportCapabilityIsCurrent(controller, nextFlow)) {
      restorePlanImportMaterialization(controller, checkpoint);
    }
    throw error;
  }
}

export async function startProcurementPlanImport(flow) {
  if (!flow?.controller || !flow?.currentDraft) {
    throw new TypeError("PROCUREMENT_SESSION_INVALID");
  }
  const guardedFlow = bindPlanImportWorkspace(this, flow);
  const activeFlow = this.procurementPlanImport;
  if (activeFlow && activeFlow.importFlowIdentity !== guardedFlow.importFlowIdentity) {
    throw planImportFlowChangedError();
  }
  if (
    String(guardedFlow.session?.sessionId || "") === ""
    || String(guardedFlow.currentDraft?.sessionId || guardedFlow.session?.sessionId || "")
      !== String(guardedFlow.session.sessionId)
  ) {
    throw new TypeError("PROCUREMENT_SESSION_INVALID");
  }
  assertPlanImportWorkspace(this, guardedFlow, { allowUninstalled: true });
  return materializePlanImportRevision(this, guardedFlow, flow.currentDraft);
}

export async function completeProcurementPlanImportRevision(savedPlanId) {
  const flow = bindPlanImportWorkspace(this, this.procurementPlanImport);
  if (!flow?.controller) return false;
  if (this.procurementPlanImport !== flow) this.procurementPlanImport = flow;
  assertPlanImportWorkspace(this, flow);
  if (flow.pendingNextUiRecovery?.planId) {
    rememberProcurementImportSession(this, flow);
    await this.plans.edit(flow.pendingNextUiRecovery.planId, {
      keepProcurementCodeEditable: true,
      preserveProcurementLookupSelection: true,
    });
    assertPlanImportWorkspace(this, flow);
    delete flow.pendingNextUiRecovery;
    return true;
  }
  const currentAlreadySaved = (
    flow.controller.state === "WAITING_NEXT_CONFIRMATION"
  );
  if (!currentAlreadySaved) {
    await flow.controller.saveCurrent(savedPlanId);
    assertPlanImportWorkspace(this, flow);
  }
  const savedRevision = flow.currentDraft.revisionNumber;
  if (!flow.controller.hasNext()) {
    await this.view.customAlert(
      "Hoàn tất nhập kế hoạch",
      `Đã lưu phiên bản ${savedRevision}. Đã hoàn tất toàn bộ phiên bản của Kế hoạch.`,
      "check-circle",
    );
    assertPlanImportWorkspace(this, flow);
    this.procurementPlanImport = null;
    forgetProcurementImportSession(this);
    return true;
  }
  const nextRevision = flow.controller.revisions[flow.controller.currentIndex + 1];
  const discardsLocalDraft = Boolean(
    findPlanVersionDraftSession(this.model, savedPlanId),
  );
  const pendingNextRevision = String(flow.pendingNextRevisionNumber || "");
  const shouldContinue = pendingNextRevision === String(nextRevision.revisionNumber)
    ? true
    : await this.view.customConfirm(
      `Đã lưu phiên bản ${savedRevision}`,
      `Kế hoạch trên Mua Sắm Công còn phiên bản ${nextRevision.revisionNumber}. `
        + (discardsLocalDraft
          ? "Nếu không tiếp tục, toàn bộ bản nháp của lần nhập này sẽ bị hủy và xóa. "
          : "Nếu không tiếp tục, hệ thống sẽ dừng tại phiên bản hiện tại; các phiên bản đã lưu được giữ nguyên. ")
        + "Bạn có muốn tiếp tục không?",
      "help-circle",
    );
  assertPlanImportWorkspace(this, flow);
  if (!shouldContinue) {
    if (discardsLocalDraft) {
      await discardPlanVersionDraftForImportSession(
        this.model, flow.session.sessionId,
      );
      assertPlanImportWorkspace(this, flow);
    }
    let remoteCancelled = false;
    try {
      await (flow.client || new ProcurementImportClient()).cancelImportSession(
        flow.session.sessionId,
        {
          workspaceLease: flow.importWorkspaceLease.token || null,
          kind: "plan",
        },
      );
      assertPlanImportWorkspace(this, flow);
      remoteCancelled = true;
    } finally {
      if (remoteCancelled && planImportCapabilityIsCurrent(this, flow)) {
        flow.controller.cancel();
        this.procurementPlanImport = null;
        forgetProcurementImportSession(this);
      }
    }
    return true;
  }
  flow.pendingNextRevisionNumber = String(nextRevision.revisionNumber);
  rememberProcurementImportSession(this, flow, {
    revisionNumber: nextRevision.revisionNumber,
  });
  const previousIndex = flow.controller.currentIndex;
  try {
    const nextDraft = await flow.controller.next();
    assertPlanImportWorkspace(this, flow);
    await materializePlanImportRevision(
      this,
      { ...flow, pendingNextRevisionNumber: null },
      nextDraft,
      savedPlanId,
    );
  } catch (error) {
    if (!error?.procurementMaterializationDurable) {
      flow.controller.rollbackLoadedNext?.(previousIndex);
    }
    throw error;
  }
  return true;
}
