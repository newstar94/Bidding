import { ProcurementImportClient } from "./ProcurementImportClient.js";
import { currentWorkspaceToken } from "../app/workspaceLease.js";


export function canApplyNoticePreview(preview) {
  return Boolean(
    preview?.previewId
    && !(preview.blockingIssues || []).length
    && preview.notice?.targetPackage?.rootId
    && Number(preview.notice?.expectedPackageRowVersion) > 0,
  );
}


function idempotencyKey() {
  if (globalThis.crypto?.randomUUID) {
    return `procurement-notice:${globalThis.crypto.randomUUID()}`;
  }
  return `procurement-notice:${Date.now()}:${Math.random().toString(16).slice(2)}`;
}


function appendFact(target, label, value) {
  const row = target.ownerDocument.createElement("div");
  row.className = "procurement-import__fact";
  const term = target.ownerDocument.createElement("dt");
  term.textContent = label;
  const detail = target.ownerDocument.createElement("dd");
  detail.textContent = String(value ?? "—");
  row.append(term, detail);
  target.append(row);
}


function renderPreview(modal, preview) {
  const facts = modal.querySelector("[data-procurement-notice-preview]");
  facts.replaceChildren();
  const notice = preview.notice || {};
  const source = notice.preview || {};
  const target = notice.targetPackage || {};
  appendFact(facts, "Mã thông báo", notice.noticeNo);
  appendFact(facts, "Phiên bản nguồn", notice.selectedRevision);
  appendFact(facts, "Loại", source.kind || "UNKNOWN");
  appendFact(facts, "Trạng thái nguồn", source.status || "—");
  appendFact(facts, "Package root", target.rootId || "Chưa xác định");
  appendFact(facts, "Package version hiện tại", target.localVersion ?? "—");

  const revisions = modal.querySelector("[data-procurement-notice-revision]");
  revisions.replaceChildren();
  (notice.availableRevisions || []).forEach((revision) => {
    const option = revisions.ownerDocument.createElement("option");
    option.value = revision;
    option.textContent = `Phiên bản nguồn ${revision}`;
    option.selected = revision === notice.selectedRevision;
    revisions.append(option);
  });

  const issues = modal.querySelector("[data-procurement-notice-issues]");
  issues.replaceChildren();
  [...(preview.blockingIssues || []), ...(preview.warnings || [])].forEach((issue) => {
    const item = issues.ownerDocument.createElement("li");
    item.className = "procurement-import__issue";
    if ((preview.blockingIssues || []).includes(issue)) item.classList.add("is-blocking");
    item.textContent = issue.message || issue.code || "Cảnh báo nguồn";
    issues.append(item);
  });
  issues.hidden = issues.children.length === 0;
  modal.querySelector("[data-procurement-notice-summary]").textContent = (
    target.rootId
      ? `Gói ${target.rootId} · local version ${target.localVersion ?? 0}`
      : "Chưa xác định được gói nhận cập nhật"
  );
}


export class NoticeImportWizard {
  constructor({ controller, modal, client = new ProcurementImportClient() }) {
    this.controller = controller;
    this.modal = modal;
    this.client = client;
    this.preview = null;
    this.prepareController = null;
    this.applyController = null;
    this.requestGeneration = 0;
    this.workspaceLease = "";
    this.targetPackageRootId = "";
    this.bind();
  }

  bind() {
    this.modal.querySelector("[data-procurement-notice-prepare]")
      .addEventListener("click", () => this.prepare());
    this.modal.querySelector("[data-procurement-notice-apply]")
      .addEventListener("click", () => this.apply());
    this.modal.querySelector("[data-procurement-notice-code]")
      .addEventListener("input", () => {
        this.preview = null;
        this.refreshApplyGate();
        this.setStatus("Mã đã thay đổi. Hãy chuẩn bị preview mới.");
      });
    this.modal.querySelectorAll(
      "[data-close='modal-procurement-notice-import']",
    ).forEach((button) => button.addEventListener("click", () => this.cleanup()));
  }

  setContext({ code, targetPackageRootId, workspaceLease }) {
    this.cleanup();
    this.targetPackageRootId = String(targetPackageRootId || "");
    this.workspaceLease = String(workspaceLease || "");
    this.modal.querySelector("[data-procurement-notice-code]").value = String(code || "");
    this.setStatus("Chuẩn bị preview để kiểm tra thông báo và gói nhận cập nhật.");
  }

  setStatus(message, urgent = false) {
    const status = this.modal.querySelector("[data-procurement-notice-status]");
    status.setAttribute("aria-live", urgent ? "assertive" : "polite");
    status.textContent = message;
  }

  refreshApplyGate() {
    const button = this.modal.querySelector("[data-procurement-notice-apply]");
    if (button) button.disabled = !canApplyNoticePreview(this.preview);
  }

  async prepare() {
    const code = this.modal.querySelector("[data-procurement-notice-code]").value.trim();
    if (!/^IB\d{10}(?:-\d{2})?$/i.test(code)) {
      this.setStatus("Mã thông báo phải có dạng IB + 10 chữ số, có thể kèm -00, -01…", true);
      return;
    }
    const generation = ++this.requestGeneration;
    const requestWorkspaceLease = this.workspaceLease;
    const requestTargetRoot = this.targetPackageRootId;
    this.prepareController?.abort();
    this.prepareController = new AbortController();
    const mode = this.modal.querySelector("[data-procurement-notice-mode]").value;
    const selectedRevision = this.modal.querySelector(
      "[data-procurement-notice-revision]",
    ).value || null;
    this.setStatus("Đang chuẩn bị preview thông báo…");
    try {
      const preview = await this.client.prepareNotice({
        code,
        revisionMode: mode,
        selectedRevision: mode === "SELECTED" ? selectedRevision : null,
        targetPackageRootId: requestTargetRoot,
        workspaceLease: requestWorkspaceLease || null,
      }, { signal: this.prepareController.signal });
      if (generation !== this.requestGeneration) return;
      if (code !== this.modal.querySelector("[data-procurement-notice-code]").value.trim()) return;
      if (
        currentWorkspaceToken(this.controller?.model) !== requestWorkspaceLease
        || this.targetPackageRootId !== requestTargetRoot
      ) {
        this.preview = null;
        this.setStatus("Workspace hoặc gói đích đã thay đổi. Hãy chuẩn bị lại.", true);
        this.refreshApplyGate();
        return;
      }
      this.preview = preview;
      renderPreview(this.modal, preview);
      this.refreshApplyGate();
      this.setStatus(
        canApplyNoticePreview(preview)
          ? "Preview đã sẵn sàng. Xác nhận để tạo package version mới khi cần."
          : "Chưa xác định chắc chắn gói nhận thông báo.",
        !canApplyNoticePreview(preview),
      );
    } catch (error) {
      if (error?.name === "AbortError") return;
      this.preview = null;
      this.refreshApplyGate();
      this.setStatus(error?.message || "Không thể chuẩn bị thông báo.", true);
    }
  }

  async apply() {
    if (!canApplyNoticePreview(this.preview)) return;
    this.applyController?.abort();
    this.applyController = new AbortController();
    this.refreshApplyGate();
    this.setStatus("Đang áp dụng notice revision vào gói thầu…");
    try {
      await this.client.applyNotice({
        previewId: this.preview.previewId,
        idempotencyKey: idempotencyKey(),
        expectedPackageRowVersion: this.preview.notice.expectedPackageRowVersion,
        workspaceLease: this.workspaceLease || null,
      }, { signal: this.applyController.signal });
      await this.controller?.model?.loadStorageKeys?.(["GOITHAU", "ASSIGNMENTS"]);
      this.controller?.view?.renderGoiThauTable?.();
      this.setStatus("Đã cập nhật thông báo vào đúng dòng phiên bản gói thầu.");
      this.controller?.view?.closeModal?.("modal-procurement-notice-import");
      this.controller?.view?.closeModal?.("modal-goithau");
    } catch (error) {
      if (error?.name === "AbortError") return;
      this.setStatus(error?.message || "Không thể áp dụng thông báo.", true);
      this.refreshApplyGate();
    }
  }

  cleanup() {
    this.requestGeneration += 1;
    this.prepareController?.abort();
    this.applyController?.abort();
    this.preview = null;
    this.refreshApplyGate();
  }
}


export async function openProcurementNoticeImportWizard(packageId = null) {
  await this.ensureLazyModal?.("modal-procurement-notice-import");
  const modal = globalThis.document.getElementById("modal-procurement-notice-import");
  if (!modal) return;
  const selectedId = String(
    packageId || globalThis.document.getElementById("form-goithau-id")?.value || "",
  );
  const pkg = (this.model?.state?.goithau || []).find(
    (row) => String(row.id) === selectedId,
  );
  if (!pkg) {
    await this.view?.customAlert?.(
      "Chưa có gói đích",
      "Chỉ có thể cập nhật mã IB vào một gói thầu hiện hữu.",
      "alert-triangle",
    );
    return;
  }
  let wizard = modal._procurementNoticeImportWizard;
  if (!wizard) {
    wizard = new NoticeImportWizard({ controller: this, modal });
    modal._procurementNoticeImportWizard = wizard;
  }
  wizard.setContext({
    code: globalThis.document.getElementById("gt-ma")?.value || pkg.maGoiThau || "",
    targetPackageRootId: pkg.rootId || pkg.id,
    workspaceLease: currentWorkspaceToken(this.model),
  });
  this.view.openModal("modal-procurement-notice-import");
}
