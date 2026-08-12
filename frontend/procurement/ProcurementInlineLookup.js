import { ProcurementLookupClient } from "./ProcurementLookupClient.js";
import {
  applyPackageDetails,
  applySelectedRows,
  buildComparisonRows,
} from "./ProcurementLookupPreview.js";

const PREVIEW_SCHEMA = "biddingflow-procurement-preview-v1";
const CODE_PATTERN = /^(PL|IB)\d{10}(?:-\d{2})?$/i;

function baseCode(code) {
  return String(code || "").trim().toUpperCase().replace(/-\d{2}$/, "");
}

function formIdentity(form) {
  return String(form?.querySelector("input[type='hidden']")?.value || "");
}

function setButtonLoading(button, loading) {
  if (!button) return;
  if (!button.dataset.defaultLabel) {
    button.dataset.defaultLabel = String(button.textContent || "").trim();
  }
  button.disabled = loading;
  button.textContent = loading ? "Đang lấy dữ liệu…" : button.dataset.defaultLabel;
  if (loading) button.setAttribute("aria-busy", "true");
  else button.removeAttribute("aria-busy");
}

export class ProcurementInlineLookup {
  constructor({
    controller,
    client = new ProcurementLookupClient(),
    document = globalThis.document,
  }) {
    this.controller = controller;
    this.client = client;
    this.document = document;
    this.requestGeneration = 0;
    this.lookupController = null;
  }

  setStatus(status, message, state = "idle") {
    if (!status) return;
    status.hidden = false;
    status.textContent = message;
    status.dataset.state = state;
    status.setAttribute("aria-live", state === "error" ? "assertive" : "polite");
  }

  async run({ kind, formId, codeInputId, buttonId, statusId }) {
    const normalizedKind = String(kind || "").toUpperCase();
    const form = this.document.getElementById(formId);
    const codeInput = this.document.getElementById(codeInputId);
    const button = this.document.getElementById(buttonId);
    const status = this.document.getElementById(statusId);
    const code = String(codeInput?.value || "").trim().toUpperCase();
    const expectedPrefix = normalizedKind === "PLAN" ? "PL" : "IB";
    if (!CODE_PATTERN.test(code) || !code.startsWith(expectedPrefix)) {
      this.setStatus(
        status,
        `Nhập mã ${expectedPrefix} gồm ${expectedPrefix} và 10 chữ số trước khi lấy dữ liệu.`,
        "error",
      );
      codeInput?.focus?.();
      return null;
    }

    const generation = ++this.requestGeneration;
    this.lookupController?.abort();
    this.lookupController = new AbortController();
    const workspaceLease = String(
      this.controller?.model?.activeWorkspaceLease || "",
    );
    const identity = formIdentity(form);
    setButtonLoading(button, true);
    this.setStatus(status, "Đang lấy dữ liệu từ Mua Sắm Công…", "loading");
    try {
      const preview = await this.client.lookup(
        {
          code,
          workspaceLease: workspaceLease || null,
          detailLevel: "COMPLETE",
          revisionMode: "LATEST",
        },
        { signal: this.lookupController.signal },
      );
      if (generation !== this.requestGeneration) return null;
      const contextChanged = (
        formIdentity(form) !== identity
        || String(codeInput?.value || "").trim().toUpperCase() !== code
        || String(this.controller?.model?.activeWorkspaceLease || "")
          !== workspaceLease
      );
      if (contextChanged) {
        this.setStatus(
          status,
          "Biểu mẫu hoặc workspace đã thay đổi. Hãy lấy dữ liệu lại.",
          "error",
        );
        return null;
      }
      if (
        preview?.schemaVersion !== PREVIEW_SCHEMA
        || preview?.kind !== normalizedKind
        || preview?.canonicalCode !== baseCode(code)
      ) {
        this.setStatus(
          status,
          "Kết quả không khớp chính xác mã hoặc loại biểu mẫu.",
          "error",
        );
        return null;
      }

      const rows = buildComparisonRows(normalizedKind, preview.data, {
        getControl: (id) => this.document.getElementById(id),
      });
      rows.forEach((row) => {
        const control = this.document.getElementById(row.controlId);
        // applySelectedRows walks fields in form order. In the plan form,
        // changing planType enables the project fields that follow it.
        row.apply = Boolean(control && row.draftValue !== null);
      });
      const result = applySelectedRows(rows, { document: this.document });
      if (normalizedKind === "PACKAGE") {
        const details = applyPackageDetails(preview.data, {
          document: this.document,
          controller: this.controller,
        });
        result.applied += details.applied;
        result.skipped += details.skipped;
      }
      const warningCount = rows.filter((row) => row.warning).length;
      const warningText = warningCount
        ? ` ${warningCount} trường chưa thể đối chiếu tự động.`
        : "";
      this.setStatus(
        status,
        `Đã điền ${result.applied} trường vào biểu mẫu.${warningText} Dữ liệu chưa được lưu.`,
        result.applied ? "success" : "error",
      );
      this.controller?.view?.showToast?.(
        "Đã lấy dữ liệu",
        `${result.applied} trường đã được điền; hãy kiểm tra trước khi lưu.`,
        result.applied ? "success" : "warning",
      );
      return { ...result, warnings: warningCount };
    } catch (error) {
      if (error?.name === "AbortError") return null;
      this.setStatus(
        status,
        error?.message || "Không thể lấy dữ liệu từ Mua Sắm Công.",
        "error",
      );
      return null;
    } finally {
      if (generation === this.requestGeneration) setButtonLoading(button, false);
    }
  }
}

export async function runProcurementInlineLookup(options) {
  if (!this._procurementInlineLookup) {
    this._procurementInlineLookup = new ProcurementInlineLookup({
      controller: this,
    });
  }
  return this._procurementInlineLookup.run(options);
}
