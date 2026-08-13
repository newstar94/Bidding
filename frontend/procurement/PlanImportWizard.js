import { ProcurementImportClient } from "./ProcurementImportClient.js";
import { SequentialRevisionController } from "./SequentialRevisionController.js";
import {
  materializeProcurementRevisionDraft,
  materializeProcurementRevisionFromPrevious,
} from "./ProcurementDraftWorkflow.js";
import { resolveImportedInvestorDraft } from "./InvestorResolver.js";
import { lookupPartnerInfo } from "../partners/partnerTaxLookup.js";
import {
  forgetProcurementImportSession,
  rememberProcurementImportSession,
} from "./ProcurementImportResume.js";
import { packageNoticeLabel, planPreviewFields } from "./fieldMapping.js";

const TERMINAL_STATUSES = new Set(["COMPLETED", "FAILED"]);
const DRAFT_KEY = "procurement_plan_import_draft_v1";

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

export function canApplyPreview(preview, decisions = {}) {
  if (!preview?.previewId) return false;
  const packageMatches = decisions.packageMatches || {};
  const fieldConflicts = decisions.fieldConflicts || {};
  const fieldValues = decisions.fieldValues || {};
  if ((preview.blockingIssues || []).some((issue) => {
    const observationId = issue.packageObservationId || issue.packageObservationId;
    const key = `${observationId || ""}:${issue.field || ""}`;
    const value = fieldValues[key];
    if (value === null || value === undefined || String(value).trim() === "") return true;
    return issue.field === "priceVnd" && !/^\d+$/.test(String(value));
  })) return false;
  return !(preview.packages || []).some((row) => {
    const observationId = String(row.planDetailRevisionId || "");
    if (row.action === "AMBIGUOUS" && !packageMatches[observationId]) return true;
    return (row.fieldConflicts || []).some(
      (conflict) => !fieldConflicts[`${observationId}:${conflict.field}`],
    );
  });
}

export function canStartSequentialImport(preview) {
  if (!preview?.importSession?.sessionId) return false;
  return !(preview.packages || []).some((row) => row.action === "AMBIGUOUS");
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
  (preview.packages || []).forEach((pkg) => {
    const row = body.ownerDocument.createElement("tr");
    row.dataset.action = pkg.action || "UNKNOWN";
    appendText(row, "td", pkg.symbol || "—");
    appendText(row, "td", pkg.name || "—");
    appendText(row, "td", packageNoticeLabel(pkg));
    const actionCell = appendText(row, "td", pkg.action || "UNKNOWN");
    actionCell.className = "procurement-import__action";
    const observationId = String(pkg.planDetailRevisionId || "");
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
  const items = [
    ...(preview.blockingIssues || []).map((item) => ({ ...item, blocking: true })),
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
      input.dataset.procurementFieldValue = String(item.packageObservationId);
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
    this.requestGeneration = 0;
    this.workspaceLease = String(controller?.model?.activeWorkspaceLease || "");
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
    if (button) button.disabled = !canStartSequentialImport(this.preview);
  }

  setStatus(message, urgent = false) {
    const status = this.modal.querySelector("[data-procurement-status]");
    status.setAttribute("aria-live", urgent ? "assertive" : "polite");
    status.textContent = message;
  }

  async prepare() {
    const code = this.modal.querySelector("[data-procurement-code]").value.trim();
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
    this.setStatus("Đang chuẩn bị preview từ nguồn…");
    try {
      const preview = await this.client.preparePlan({
        code,
        revisionMode: mode,
        selectedRevision: mode === "SELECTED" ? selectedRevision : null,
        includeLinkedNotices: true,
        workspaceLease: this.workspaceLease || null,
      }, { signal: this.prepareController.signal });
      if (generation !== this.requestGeneration) return;
      if (code !== this.modal.querySelector("[data-procurement-code]").value.trim()) return;
      const activeWorkspaceLease = String(
        this.controller?.model?.activeWorkspaceLease || "",
      );
      if (activeWorkspaceLease !== requestWorkspaceLease) {
        this.preview = null;
        this.setStatus("Workspace đã thay đổi. Hãy chuẩn bị preview mới.", true);
        this.refreshApplyGate();
        return;
      }
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
      const summary = summarizePreview(preview);
      this.modal.querySelector("[data-procurement-summary]").textContent =
        `${summary.total} gói · ${preview.plan?.selectedRevisions?.length || 0} phiên bản nguồn`;
      this.refreshApplyGate();
      this.saveDraft();
      this.setStatus(canStartSequentialImport(preview)
        ? "Dữ liệu đã sẵn sàng. Phiên bản đầu tiên sẽ mở trong biểu mẫu Kế hoạch."
        : "Preview còn trường hợp ghép gói mơ hồ cần xử lý.",
        !canStartSequentialImport(preview));
    } catch (error) {
      if (error?.name === "AbortError") return;
      this.setStatus(error?.message || "Không thể chuẩn bị preview.", true);
    }
  }

  async apply() {
    if (!canStartSequentialImport(this.preview)) return;
    const importSession = this.preview?.importSession;
    if (!importSession?.sessionId || !(importSession.revisions || []).length) {
      this.setStatus("Phiên nhập tuần tự chưa sẵn sàng. Hãy chuẩn bị lại dữ liệu.", true);
      return;
    }
    this.applyController?.abort();
    this.applyController = new AbortController();
    const button = this.modal.querySelector("[data-procurement-apply]");
    button.disabled = true;
    this.setStatus("Đang mở phiên bản đầu tiên trong biểu mẫu Kế hoạch…");
    try {
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
      await this.controller?.startProcurementPlanImport?.({
        session: importSession,
        controller: sequential,
        currentDraft,
        client: this.client,
      });
      this.draftStore.clear();
      this.controller?.view?.closeModal?.("modal-procurement-import");
    } catch (error) {
      if (error?.name === "AbortError") return;
      this.setStatus(error?.message || "Không thể áp dụng preview.", true);
      button.disabled = false;
    }
  }

  async monitor(operationId) {
    let operation = await this.client.getOperation(operationId, { signal: this.applyController.signal });
    while (!TERMINAL_STATUSES.has(operation.status)) {
      this.setStatus(`Đang nhập ${operation.nextRevisionIndex}/${operation.totalRevisions} phiên bản…`);
      await new Promise((resolve) => globalThis.setTimeout(resolve, 400));
      operation = await this.client.getOperation(operationId, { signal: this.applyController.signal });
    }
    if (operation.status === "FAILED") throw new Error("Tiến trình nhập toàn bộ lịch sử thất bại.");
    return operation;
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
  await this.ensureLazyModal?.("modal-procurement-import");
  const modal = globalThis.document.getElementById("modal-procurement-import");
  if (!modal) return;
  let wizard = modal._procurementImportWizard;
  if (!wizard) {
    wizard = new PlanImportWizard({ controller: this, modal });
    modal._procurementImportWizard = wizard;
  }
  const activeWorkspaceLease = String(this.model?.activeWorkspaceLease || "");
  if (wizard.workspaceLease !== activeWorkspaceLease) {
    wizard.cleanup();
    wizard.workspaceLease = activeWorkspaceLease;
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

function latestPlanForFamily(model, familyNo) {
  const normalized = String(familyNo || "").trim().toUpperCase();
  return (model?.state?.kehoach || [])
    .filter((plan) => (
      String(model?.getPlanBaseCode?.(plan.maKeHoach) || plan.maKeHoach || "")
        .trim().toUpperCase() === normalized
      && plan.isLatest == 1
    ))
    .sort((left, right) => Number(right.phienBan || 0) - Number(left.phienBan || 0))[0] || null;
}

async function materializePlanImportRevision(controller, flow, revisionDraft, previousPlanId = null) {
  const source = revisionDraft?.planDraft?.investorSource || {};
  const investorResolution = await resolveImportedInvestorDraft({
    source,
    records: controller.model?.getLatestChuDauTu?.() || [],
    lookup: lookupPartnerInfo,
    timestamp: controller.model.getCurrentDateTimeString(),
  });
  const prior = previousPlanId
    ? (controller.model.state.kehoach || []).find(
      (plan) => String(plan.id) === String(previousPlanId),
    )
    : latestPlanForFamily(controller.model, revisionDraft.familyNo);
  const materialized = prior
    ? materializeProcurementRevisionFromPrevious(
      controller.model.state,
      prior.id,
      revisionDraft,
      { timestamp: controller.model.getCurrentDateTimeString() },
    )
    : materializeProcurementRevisionDraft(
      controller.model.state,
      revisionDraft,
      { timestamp: controller.model.getCurrentDateTimeString() },
    );
  if (investorResolution.status === "NEW") {
    controller.model.state.chudautu ||= [];
    controller.model.state.chudautu.push(investorResolution.investor);
  }
  materialized.plan.chuDauTuId = investorResolution.investor.id;
  materialized.plan.sourceRevision = revisionDraft.planDraft?.sourceRevision;
  materialized.packages.forEach((pkg) => {
    pkg.keHoachId = materialized.plan.id;
  });
  controller.planBreakdownDraft = materialized.draft;
  controller.procurementPlanImport = {
    ...flow,
    currentDraft: revisionDraft,
    currentPlanId: materialized.plan.id,
    investorResolution,
  };
  rememberProcurementImportSession(controller, controller.procurementPlanImport);
  await controller.plans.edit(materialized.plan.id);
  return materialized;
}

export async function startProcurementPlanImport(flow) {
  if (!flow?.controller || !flow?.currentDraft) {
    throw new TypeError("PROCUREMENT_SESSION_INVALID");
  }
  return materializePlanImportRevision(this, flow, flow.currentDraft);
}

export async function completeProcurementPlanImportRevision(savedPlanId) {
  const flow = this.procurementPlanImport;
  if (!flow?.controller) return false;
  await flow.controller.saveCurrent(savedPlanId);
  const savedRevision = flow.currentDraft.revisionNumber;
  if (!flow.controller.hasNext()) {
    await this.view.customAlert(
      "Hoàn tất nhập kế hoạch",
      `Đã lưu phiên bản ${savedRevision}. Đã hoàn tất toàn bộ phiên bản của Kế hoạch.`,
      "check-circle",
    );
    this.procurementPlanImport = null;
    forgetProcurementImportSession(this);
    return true;
  }
  const nextRevision = flow.controller.revisions[flow.controller.currentIndex + 1];
  const shouldContinue = await this.view.customConfirm(
    `Đã lưu phiên bản ${savedRevision}`,
    `Kế hoạch trên Mua Sắm Công còn phiên bản ${nextRevision.revisionNumber}. Bạn có muốn tiếp tục nhập phiên bản này không?`,
    "help-circle",
  );
  if (!shouldContinue) {
    await (flow.client || new ProcurementImportClient()).cancelImportSession(
      flow.session.sessionId,
      {
        workspaceLease: this.model?.activeWorkspaceLease || null,
        kind: "plan",
      },
    );
    flow.controller.cancel();
    this.procurementPlanImport = null;
    forgetProcurementImportSession(this);
    return true;
  }
  const nextDraft = await flow.controller.next();
  await materializePlanImportRevision(this, flow, nextDraft, savedPlanId);
  return true;
}
