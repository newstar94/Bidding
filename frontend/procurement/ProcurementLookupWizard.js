import { ProcurementLookupClient } from "./ProcurementLookupClient.js";
import {
  applySelectedRows,
  buildComparisonRows,
} from "./ProcurementLookupPreview.js";

const PREVIEW_SCHEMA = "biddingflow-procurement-preview-v1";
const CODE_PATTERN = /^(PL|IB)\d{10}(?:-\d{2})?$/i;

function createDebouncedLookup(callback, delay = 600, timers = globalThis) {
  let timer = null;
  return {
    schedule() {
      if (timer !== null) timers.clearTimeout(timer);
      timer = timers.setTimeout(() => {
        timer = null;
        callback();
      }, delay);
    },
    cancel() {
      if (timer !== null) timers.clearTimeout(timer);
      timer = null;
    },
  };
}

function appendText(parent, tagName, value, className = "") {
  const element = parent.ownerDocument.createElement(tagName);
  if (className) element.className = className;
  element.textContent = String(value ?? "");
  parent.append(element);
  return element;
}

function formIdentity(form) {
  return String(form?.querySelector("input[type='hidden']")?.value || "");
}

function rowFingerprint(rows, document) {
  return JSON.stringify((rows || []).map((row) => [
    row.controlId,
    String(document?.getElementById(row.controlId)?.value ?? ""),
  ]));
}

function baseCode(code) {
  return String(code || "").trim().toUpperCase().replace(/-\d{2}$/, "");
}

function displayValue(value) {
  return value === null || value === undefined || String(value).trim() === ""
    ? "—"
    : String(value);
}

export class ProcurementLookupWizard {
  constructor({
    controller,
    modal,
    client = new ProcurementLookupClient(),
    document = globalThis.document,
  }) {
    this.controller = controller;
    this.modal = modal;
    this.client = client;
    this.document = document;
    this.context = null;
    this.preview = null;
    this.rows = [];
    this.requestGeneration = 0;
    this.lookupController = null;
    this.draftFingerprint = "";
    this.opener = null;
    this.debouncedLookup = createDebouncedLookup(() => this.lookup(), 600);
    this.bind();
  }

  bind() {
    const code = this.modal.querySelector("[data-procurement-lookup-code]");
    code.addEventListener("input", () => {
      this.clearPreview();
      this.setStatus("Đang chờ mã tra cứu hợp lệ…");
      this.debouncedLookup.schedule();
    });
    code.addEventListener("keydown", (event) => {
      if (event.key !== "Enter") return;
      event.preventDefault();
      this.debouncedLookup.cancel();
      this.lookup();
    });
    this.modal.querySelector("[data-procurement-lookup-run]")
      .addEventListener("click", () => this.lookup());
    this.modal.querySelector("[data-procurement-lookup-apply]")
      .addEventListener("click", () => this.apply());
    this.modal.addEventListener("change", (event) => {
      const field = event.target?.dataset?.procurementLookupField;
      if (!field) return;
      const row = this.rows.find((item) => item.field === field);
      if (row) row.apply = Boolean(event.target.checked);
      this.refreshApplyGate();
    });
    this.modal.querySelectorAll("[data-close='modal-procurement-lookup']")
      .forEach((button) => button.addEventListener("click", () => this.cleanup()));
    this.modal.addEventListener("keydown", (event) => this.handleModalKeydown(event));
  }

  setContext({ kind, formId, codeInputId, workspaceLease, opener = null }) {
    this.cleanup();
    this.context = {
      kind: String(kind || "").toUpperCase(),
      formId,
      codeInputId,
      workspaceLease: String(workspaceLease || ""),
      identity: formIdentity(this.document.getElementById(formId)),
    };
    this.opener = opener;
    const code = String(this.document.getElementById(codeInputId)?.value || "").trim();
    this.modal.querySelector("[data-procurement-lookup-code]").value = code;
    const kindLabel = this.modal.querySelector("[data-procurement-lookup-kind]");
    if (kindLabel) {
      kindLabel.textContent = this.context.kind === "PLAN"
        ? "Kế hoạch lựa chọn nhà thầu"
        : "Thông báo mời thầu / Gói thầu";
    }
    this.setStatus("Nhập mã PL/IB rồi tra cứu để xem dữ liệu trước khi áp dụng.");
  }

  currentContextMatches({ code, identity, workspaceLease }) {
    const currentForm = this.document.getElementById(this.context?.formId);
    return Boolean(
      this.context
      && String(this.modal.querySelector("[data-procurement-lookup-code]")?.value || "")
        .trim().toUpperCase() === code
      && formIdentity(currentForm) === identity
      && String(this.controller?.model?.activeWorkspaceLease || "") === workspaceLease
      && this.context.workspaceLease === workspaceLease,
    );
  }

  setStatus(message, urgent = false) {
    const status = this.modal.querySelector("[data-procurement-lookup-status]");
    status?.setAttribute("aria-live", urgent ? "assertive" : "polite");
    if (status) status.textContent = message;
  }

  clearPreview() {
    this.preview = null;
    this.rows = [];
    this.draftFingerprint = "";
    this.modal.querySelector("[data-procurement-lookup-body]")?.replaceChildren();
    this.modal.querySelector("[data-procurement-lookup-warnings]")?.replaceChildren();
    const packages = this.modal.querySelector("[data-procurement-lookup-packages]");
    if (packages) {
      packages.replaceChildren();
      packages.hidden = true;
    }
    this.refreshApplyGate();
  }

  refreshApplyGate() {
    const button = this.modal.querySelector("[data-procurement-lookup-apply]");
    if (button) {
      button.disabled = !this.preview || !this.rows.some(
        (row) => row.apply && row.draftValue !== null,
      );
    }
  }

  async lookup() {
    if (!this.context) return;
    const codeInput = this.modal.querySelector("[data-procurement-lookup-code]");
    const code = String(codeInput?.value || "").trim().toUpperCase();
    const expectedPrefix = this.context.kind === "PLAN" ? "PL" : "IB";
    if (!CODE_PATTERN.test(code) || !code.startsWith(expectedPrefix)) {
      this.clearPreview();
      this.setStatus(`Mã phải có dạng ${expectedPrefix} + 10 chữ số.`, true);
      return;
    }
    const generation = ++this.requestGeneration;
    this.lookupController?.abort();
    this.lookupController = new AbortController();
    const workspaceLease = this.context.workspaceLease;
    const identity = formIdentity(this.document.getElementById(this.context.formId));
    this.setStatus("Đang tra cứu dữ liệu Mua Sắm Công…");
    try {
      const preview = await this.client.lookup(
        { code, workspaceLease: workspaceLease || null },
        { signal: this.lookupController.signal },
      );
      if (generation !== this.requestGeneration) return;
      if (!this.currentContextMatches({ code, identity, workspaceLease })) {
        this.clearPreview();
        this.setStatus("Biểu mẫu hoặc workspace đã thay đổi. Hãy tra cứu lại.", true);
        return;
      }
      if (
        preview?.schemaVersion !== PREVIEW_SCHEMA
        || preview?.kind !== this.context.kind
        || preview?.canonicalCode !== baseCode(code)
      ) {
        this.clearPreview();
        this.setStatus("Kết quả không khớp chính xác mã hoặc loại biểu mẫu.", true);
        return;
      }
      this.preview = preview;
      this.rows = buildComparisonRows(preview.kind, preview.data, {
        getControl: (id) => this.document.getElementById(id),
      });
      this.draftFingerprint = rowFingerprint(this.rows, this.document);
      this.renderPreview(preview);
      this.refreshApplyGate();
      this.setStatus("Đã có preview. Chọn các field cần áp dụng vào draft đang mở.");
    } catch (error) {
      if (error?.name === "AbortError") return;
      this.clearPreview();
      this.setStatus(error?.message || "Không thể hoàn tất tra cứu.", true);
    }
  }

  renderPreview(preview) {
    const body = this.modal.querySelector("[data-procurement-lookup-body]");
    body.replaceChildren();
    for (const row of this.rows) {
      const tr = body.ownerDocument.createElement("tr");
      appendText(tr, "th", row.label).scope = "row";
      appendText(tr, "td", displayValue(row.currentValue));
      const sourceCell = appendText(tr, "td", displayValue(row.sourceValue));
      if (row.warning) sourceCell.dataset.warning = "true";
      const applyCell = body.ownerDocument.createElement("td");
      const checkbox = body.ownerDocument.createElement("input");
      checkbox.type = "checkbox";
      checkbox.checked = row.apply;
      checkbox.disabled = row.draftValue === null;
      checkbox.dataset.procurementLookupField = row.field;
      checkbox.setAttribute("aria-label", `Áp dụng ${row.label}`);
      applyCell.append(checkbox);
      tr.append(applyCell);
      body.append(tr);
    }
    this.renderWarnings();
    this.renderPlanPackages(preview);
  }

  renderWarnings() {
    const target = this.modal.querySelector("[data-procurement-lookup-warnings]");
    target.replaceChildren();
    this.rows.filter((row) => row.warning).forEach((row) => {
      appendText(target, "li", `${row.label}: ${row.warning}`);
    });
    target.hidden = target.children.length === 0;
  }

  renderPlanPackages(preview) {
    const target = this.modal.querySelector("[data-procurement-lookup-packages]");
    if (!target) return;
    target.replaceChildren();
    const packages = Array.isArray(preview?.data?.packages) ? preview.data.packages : [];
    if (preview?.kind !== "PLAN") {
      target.hidden = true;
      return;
    }
    target.hidden = false;
    appendText(target, "h4", `${packages.length} gói thầu trong kế hoạch nguồn`);
    const list = target.ownerDocument.createElement("ul");
    packages.forEach((pkg) => {
      appendText(list, "li", pkg.bidName || pkg.notifyNo || "Gói chưa có tên");
    });
    target.append(list);
    appendText(
      target,
      "p",
      "Danh sách này chỉ để xem trước; hệ thống không tự tạo gói thầu liên quan.",
      "helper-text",
    );
  }

  apply() {
    if (!this.preview || !this.context) return;
    const code = String(
      this.modal.querySelector("[data-procurement-lookup-code]")?.value || "",
    ).trim().toUpperCase();
    if (!this.currentContextMatches({
      code,
      identity: this.context.identity,
      workspaceLease: this.context.workspaceLease,
    })) {
      this.setStatus("Biểu mẫu hoặc workspace đã thay đổi. Không áp dụng dữ liệu cũ.", true);
      return;
    }
    if (rowFingerprint(this.rows, this.document) !== this.draftFingerprint) {
      this.setStatus("Draft đã thay đổi sau preview. Hãy tra cứu lại trước khi áp dụng.", true);
      return;
    }
    const result = applySelectedRows(this.rows, { document: this.document });
    this.controller?.view?.showToast?.(
      "Đã áp dụng vào draft",
      `${result.applied} field đã được cập nhật; dữ liệu chưa được lưu.`,
      "success",
    );
    this.cleanup();
    this.controller?.view?.closeModal?.("modal-procurement-lookup");
    this.restoreFocus();
  }

  handleModalKeydown(event) {
    if (event.key === "Escape") {
      event.preventDefault();
      this.cleanup();
      this.controller?.view?.closeModal?.("modal-procurement-lookup");
      this.restoreFocus();
      return;
    }
    if (event.key !== "Tab") return;
    const controls = Array.from(this.modal.querySelectorAll(
      "button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex='0']",
    )).filter((element) => !element.hidden);
    if (!controls.length) return;
    const first = controls[0];
    const last = controls.at(-1);
    if (event.shiftKey && this.document.activeElement === first) {
      event.preventDefault();
      last.focus();
    } else if (!event.shiftKey && this.document.activeElement === last) {
      event.preventDefault();
      first.focus();
    }
  }

  restoreFocus() {
    const callback = () => this.opener?.focus?.({ preventScroll: true });
    if (typeof globalThis.requestAnimationFrame === "function") {
      globalThis.requestAnimationFrame(callback);
    } else callback();
  }

  focusInitial() {
    this.modal.querySelector("[data-procurement-lookup-code]")?.focus?.();
  }

  cleanup() {
    this.requestGeneration += 1;
    this.lookupController?.abort();
    this.debouncedLookup?.cancel();
    this.clearPreview();
  }
}

export async function openProcurementLookupWizard({
  kind,
  formId,
  codeInputId,
  opener = globalThis.document?.activeElement,
}) {
  await this.ensureLazyModal?.("modal-procurement-lookup");
  const modal = globalThis.document.getElementById("modal-procurement-lookup");
  if (!modal) return;
  let wizard = modal._procurementLookupWizard;
  if (!wizard) {
    wizard = new ProcurementLookupWizard({ controller: this, modal });
    modal._procurementLookupWizard = wizard;
  }
  wizard.setContext({
    kind,
    formId,
    codeInputId,
    workspaceLease: this.model?.activeWorkspaceLease || "",
    opener,
  });
  this.view.openModal("modal-procurement-lookup");
  wizard.focusInitial();
}
