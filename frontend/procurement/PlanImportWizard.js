import { ProcurementImportClient } from "./ProcurementImportClient.js";
import { packageNoticeLabel, planPreviewFields } from "./fieldMapping.js";

const TERMINAL_STATUSES = new Set(["COMPLETED", "FAILED"]);

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

function randomIdempotencyKey() {
  if (globalThis.crypto?.randomUUID) return `procurement:${globalThis.crypto.randomUUID()}`;
  return `procurement:${Date.now()}:${Math.random().toString(16).slice(2)}`;
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
    this.refreshApplyGate();
  }

  refreshApplyGate() {
    const button = this.modal.querySelector("[data-procurement-apply]");
    if (button) button.disabled = !canApplyPreview(this.preview, this.decisions);
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
      this.decisions = { packageMatches: {}, fieldConflicts: {}, fieldValues: {} };
      renderPlan(this.modal, preview);
      renderPackages(this.modal, preview);
      renderIssues(this.modal, preview);
      renderRevisions(this.modal, preview);
      const summary = summarizePreview(preview);
      this.modal.querySelector("[data-procurement-summary]").textContent =
        `${summary.total} gói · ${preview.plan?.selectedRevisions?.length || 0} phiên bản nguồn`;
      this.refreshApplyGate();
      this.setStatus(canApplyPreview(preview, this.decisions)
        ? "Preview đã sẵn sàng. Kiểm tra và xác nhận trước khi nhập."
        : "Preview còn xung đột hoặc trường bắt buộc cần xử lý.",
        !canApplyPreview(preview, this.decisions));
    } catch (error) {
      if (error?.name === "AbortError") return;
      this.setStatus(error?.message || "Không thể chuẩn bị preview.", true);
    }
  }

  async apply() {
    if (!canApplyPreview(this.preview, this.decisions)) return;
    const investorId = this.modal.querySelector("[data-procurement-investor]").value;
    if (!investorId) {
      this.setStatus("Phải chọn chủ đầu tư hiện hữu trước khi áp dụng.", true);
      return;
    }
    this.applyController?.abort();
    this.applyController = new AbortController();
    const button = this.modal.querySelector("[data-procurement-apply]");
    button.disabled = true;
    this.setStatus("Đang commit kế hoạch, gói thầu và provenance…");
    try {
      const result = await this.client.applyPlan({
        previewId: this.preview.previewId,
        idempotencyKey: randomIdempotencyKey(),
        expectedPlanRowVersion: this.preview.plan?.expectedRowVersion ?? null,
        decisions: {
          investorId,
          packageMatches: Object.entries(this.decisions.packageMatches).map(
            ([packageObservationId, decision]) => ({ packageObservationId, ...decision }),
          ),
          fieldConflicts: Object.entries(this.decisions.fieldConflicts).map(
            ([key, resolution]) => {
              const separator = key.lastIndexOf(":");
              return {
                packageObservationId: key.slice(0, separator),
                field: key.slice(separator + 1),
                resolution,
              };
            },
          ),
          fieldValues: Object.entries(this.decisions.fieldValues).map(([key, value]) => {
            const separator = key.lastIndexOf(":");
            const field = key.slice(separator + 1);
            return {
              packageObservationId: key.slice(0, separator),
              field,
              value: field === "priceVnd" && value !== "" ? Number(value) : value,
            };
          }),
          assignees: [],
        },
        workspaceLease: this.workspaceLease || null,
      }, { signal: this.applyController.signal });
      if (result.operationId) await this.monitor(result.operationId);
      await this.controller?.model?.loadStorageKeys?.(["KEHOACH", "GOITHAU", "ASSIGNMENTS"]);
      this.controller?.view?.renderKeHoachTable?.();
      this.controller?.view?.renderGoiThauTable?.();
      this.setStatus("Đã nhập kế hoạch và gói thầu thành công.");
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
  this.view.openModal("modal-procurement-import");
  if (sourceCode) wizard.debouncedPrepare.schedule();
}
