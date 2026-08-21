import { ProcurementLookupClient } from "./ProcurementLookupClient.js";
import { ProcurementImportClient } from "./ProcurementImportClient.js";
import { SequentialRevisionController } from "./SequentialRevisionController.js";
import { fillPackageFormFromProcurementDraft } from "./ProcurementDraftWorkflow.js";
import {
  forgetProcurementImportSession,
  rememberProcurementImportSession,
} from "./ProcurementImportResume.js";
import {
  applyPackageDetails,
  applySelectedRows,
  buildComparisonRows,
} from "./ProcurementLookupPreview.js";
import {
  captureWorkspaceLease,
  currentWorkspaceToken,
  isWorkspaceLeaseCurrent,
  workspaceChangedError,
} from "../app/workspaceLease.js";

const PREVIEW_SCHEMA = "biddingflow-procurement-preview-v1";
const CODE_PATTERN = /^(PL|IB)\d{10}(?:-\d{2})?$/i;
const ENRICHMENT_TERMINAL_STATUSES = new Set(["COMPLETED", "PARTIAL", "FAILED"]);

function waitForDelay(milliseconds, signal) {
  if (signal?.aborted) {
    return Promise.reject(new DOMException("Aborted", "AbortError"));
  }
  return new Promise((resolve, reject) => {
    const timer = globalThis.setTimeout(() => {
      signal?.removeEventListener?.("abort", onAbort);
      resolve();
    }, milliseconds);
    const onAbort = () => {
      globalThis.clearTimeout(timer);
      signal?.removeEventListener?.("abort", onAbort);
      reject(new DOMException("Aborted", "AbortError"));
    };
    signal?.addEventListener?.("abort", onAbort, { once: true });
  });
}

async function waitForPlanEnrichment(client, preview, {
  signal,
  onProgress = () => undefined,
} = {}) {
  const initialStatus = String(
    preview?.enrichmentStatus
    || preview?.importSession?.enrichmentStatus
    || "COMPLETED",
  ).toUpperCase();
  if (initialStatus === "COMPLETED") return null;
  const operationId = String(preview?.enrichmentOperationId || "").trim();
  if (!operationId) {
    throw new Error("Phiên bổ sung dữ liệu TBMT chưa sẵn sàng.");
  }
  let operation = await client.getOperation(operationId, { signal });
  while (!ENRICHMENT_TERMINAL_STATUSES.has(String(operation?.status || "").toUpperCase())) {
    onProgress(operation);
    await waitForDelay(500, signal);
    operation = await client.getOperation(operationId, { signal });
  }
  const finalStatus = String(operation?.status || "").toUpperCase();
  if (finalStatus !== "COMPLETED") {
    throw new Error(
      finalStatus === "PARTIAL"
        ? "Chưa lấy đủ dữ liệu của tất cả TBMT liên kết. Vui lòng thử lại."
        : "Không thể bổ sung dữ liệu TBMT liên kết. Vui lòng thử lại.",
    );
  }
  return operation;
}

function baseCode(code) {
  return String(code || "").trim().toUpperCase().replace(/-\d{2}$/, "");
}

function formIdentity(form) {
  return String(form?.querySelector("input[type='hidden']")?.value || "");
}

function setButtonLoading(button, loading) {
  if (!button) return;
  if (button.type === "checkbox") {
    button.disabled = loading;
    if (loading) button.setAttribute("aria-busy", "true");
    else button.removeAttribute("aria-busy");
    return;
  }
  if (!button.dataset.defaultLabel) {
    button.dataset.defaultLabel = String(button.textContent || "").trim();
  }
  button.disabled = loading;
  button.textContent = loading ? "Đang lấy dữ liệu…" : button.dataset.defaultLabel;
  if (loading) button.setAttribute("aria-busy", "true");
  else button.removeAttribute("aria-busy");
}

function setLookupLoading(loadingScreen, form, loading, code = "") {
  if (loading) form?.setAttribute?.("aria-busy", "true");
  else form?.removeAttribute?.("aria-busy");
  if (!loadingScreen) return;

  const codeLabel = loadingScreen.querySelector?.(
    "[data-procurement-loading-code]",
  );
  if (codeLabel) {
    codeLabel.textContent = code;
    codeLabel.hidden = !code;
  }
  loadingScreen.setAttribute("aria-busy", String(loading));
  loadingScreen.hidden = !loading;
}

function inlineImportCapabilityIsCurrent({
  controller,
  generation,
  currentGeneration,
  form,
  identity,
  codeInput,
  code,
  originLease,
  originStorage,
}) {
  return generation === currentGeneration
    && formIdentity(form) === identity
    && String(codeInput?.value || "").trim().toUpperCase() === code
    && isWorkspaceLeaseCurrent(controller?.model, originLease)
    && controller?.model?.workspaceStorage === originStorage;
}

export class ProcurementInlineLookup {
  constructor({
    controller,
    client = new ProcurementLookupClient(),
    importClient = null,
    document = globalThis.document,
  }) {
    this.controller = controller;
    this.client = client;
    this.importClient = importClient || (
      typeof client?.prepareNotice === "function"
        ? client
        : new ProcurementImportClient()
    );
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

  async run({
    kind,
    formId,
    codeInputId,
    triggerId,
    buttonId,
    statusId,
    loadingId,
  }) {
    const normalizedKind = String(kind || "").toUpperCase();
    const form = this.document.getElementById(formId);
    const codeInput = this.document.getElementById(codeInputId);
    const button = this.document.getElementById(triggerId || buttonId);
    const status = this.document.getElementById(statusId);
    const loadingScreen = this.document.getElementById(
      loadingId || `procurement-lookup-${normalizedKind === "PLAN" ? "plan" : "package"}-loading`,
    );
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
    const originLease = captureWorkspaceLease(this.controller?.model);
    const workspaceLease = originLease.token;
    const originStorage = this.controller?.model?.workspaceStorage;
    const identity = formIdentity(form);
    setButtonLoading(button, true);
    setLookupLoading(loadingScreen, form, true, code);
    this.setStatus(status, "Đang lấy dữ liệu từ Mua Sắm Công…", "loading");
    try {
      if (normalizedKind === "PACKAGE" || normalizedKind === "PLAN") {
        const prepare = normalizedKind === "PACKAGE"
          ? this.importClient.prepareNotice.bind(this.importClient)
          : this.importClient.preparePlan.bind(this.importClient);
        const preview = await prepare({
          code,
          revisionMode: "ALL",
          ...(normalizedKind === "PACKAGE" ? { targetPackageRootId: null } : {
            includeLinkedNotices: true,
          }),
          workspaceLease: workspaceLease || null,
        }, { signal: this.lookupController.signal });
        if (generation !== this.requestGeneration) return null;
        const contextChanged = (
          formIdentity(form) !== identity
          || String(codeInput?.value || "").trim().toUpperCase() !== code
          || currentWorkspaceToken(this.controller?.model) !== workspaceLease
        );
        if (contextChanged) {
          this.setStatus(
            status,
            "Biểu mẫu hoặc workspace đã thay đổi. Hãy lấy dữ liệu lại.",
            "error",
          );
          return null;
        }
        const importSession = preview?.importSession;
        if (!importSession?.sessionId || !(importSession.revisions || []).length) {
          throw new Error("Phiên nhập gói thầu chưa sẵn sàng.");
        }
        if (normalizedKind === "PLAN") {
          await waitForPlanEnrichment(this.importClient, preview, {
            signal: this.lookupController.signal,
            onProgress: (operation) => this.setStatus(
              status,
              `Đang bổ sung dữ liệu TBMT ${operation?.nextRevisionIndex || 0}/${operation?.totalRevisions || 0}…`,
              "loading",
            ),
          });
          const changedWhileEnriching = (
            generation !== this.requestGeneration
            || formIdentity(form) !== identity
            || String(codeInput?.value || "").trim().toUpperCase() !== code
            || currentWorkspaceToken(this.controller?.model) !== workspaceLease
          );
          if (changedWhileEnriching) {
            this.setStatus(
              status,
              "Biểu mẫu hoặc workspace đã thay đổi. Hãy lấy dữ liệu lại.",
              "error",
            );
            return null;
          }
        }
        const sequential = new SequentialRevisionController({
          revisions: importSession.revisions,
          loadRevision: (revision) => this.importClient.getPlanRevisionDraft(
            importSession.sessionId,
            revision.revisionNumber,
            {
              workspaceLease: workspaceLease || null,
              signal: this.lookupController.signal,
              kind: normalizedKind === "PACKAGE" ? "notice" : "plan",
            },
          ),
          saveRevision: async () => ({ ok: true }),
        });
        const currentDraft = await sequential.loadCurrent();
        if (!inlineImportCapabilityIsCurrent({
          controller: this.controller,
          generation,
          currentGeneration: this.requestGeneration,
          form,
          identity,
          codeInput,
          code,
          originLease,
          originStorage,
        })) {
          throw workspaceChangedError();
        }
        const start = normalizedKind === "PACKAGE"
          ? this.controller?.startProcurementPackageImport
          : this.controller?.startProcurementPlanImport;
        await start?.call(this.controller, {
          session: importSession,
          controller: sequential,
          currentDraft,
          client: this.importClient,
          importWorkspaceLease: originLease,
          importWorkspaceStorage: originStorage,
          importFlowIdentity: Object.freeze({}),
        });
        this.setStatus(
          status,
          `Đã mở phiên bản ${currentDraft.revisionNumber}. Dữ liệu chưa được lưu.`,
          "success",
        );
        return { applied: true, revisionNumber: currentDraft.revisionNumber };
      }
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
        || currentWorkspaceToken(this.controller?.model) !== workspaceLease
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
      if (generation === this.requestGeneration) {
        setButtonLoading(button, false);
        setLookupLoading(loadingScreen, form, false);
      }
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

export function originatePackageImportFlow(controller, flow) {
  return {
    ...flow,
    importWorkspaceLease: captureWorkspaceLease(controller?.model),
    importWorkspaceStorage: controller?.model?.workspaceStorage,
    importFlowIdentity: Object.freeze({}),
  };
}

function assertPackageImportCapabilityCurrent(controller, flow) {
  if (
    !flow?.importWorkspaceLease
    || !flow?.importFlowIdentity
    || !Object.hasOwn(flow, "importWorkspaceStorage")
    || !isWorkspaceLeaseCurrent(controller?.model, flow.importWorkspaceLease)
    || controller?.model?.workspaceStorage !== flow.importWorkspaceStorage
    || controller?.procurementPackageImport !== flow
  ) {
    throw workspaceChangedError();
  }
  return flow;
}

function packageImportFlowChangedError() {
  const error = new Error("Procurement package import flow changed");
  error.name = "AbortError";
  error.code = "FLOW_CHANGED";
  return error;
}

export async function startProcurementPackageImport(flow) {
  const packageDraft = flow?.currentDraft?.packageDrafts?.[0];
  if (!flow?.controller || !packageDraft) {
    throw new TypeError("PROCUREMENT_SESSION_INVALID");
  }
  if (
    !flow.importWorkspaceLease
    || !flow.importFlowIdentity
    || !Object.hasOwn(flow, "importWorkspaceStorage")
    || !isWorkspaceLeaseCurrent(this.model, flow.importWorkspaceLease)
    || this.model?.workspaceStorage !== flow.importWorkspaceStorage
  ) {
    throw workspaceChangedError();
  }
  const activeFlow = this.procurementPackageImport;
  if (activeFlow && activeFlow.importFlowIdentity !== flow.importFlowIdentity) {
    throw packageImportFlowChangedError();
  }
  const nextFlow = {
    ...flow,
    currentDraft: flow.currentDraft,
    sourcePackageDraft: packageDraft,
  };
  this.procurementPackageImport = nextFlow;
  assertPackageImportCapabilityCurrent(this, nextFlow);
  rememberProcurementImportSession(this, nextFlow);
  assertPackageImportCapabilityCurrent(this, nextFlow);
  fillPackageFormFromProcurementDraft(globalThis.document, packageDraft, this);
  return packageDraft;
}

export async function completeProcurementPackageImportRevision(savedPackageId) {
  const currentFlow = this.procurementPackageImport;
  if (!currentFlow?.controller) return false;
  const flow = assertPackageImportCapabilityCurrent(this, currentFlow);
  await flow.controller.saveCurrent(savedPackageId);
  assertPackageImportCapabilityCurrent(this, flow);
  const savedRevision = flow.currentDraft.revisionNumber;
  if (!flow.controller.hasNext()) {
    await this.view.customAlert(
      "Hoàn tất nhập gói thầu",
      `Đã lưu phiên bản ${savedRevision}. Đã hoàn tất toàn bộ phiên bản của Gói thầu.`,
      "check-circle",
    );
    assertPackageImportCapabilityCurrent(this, flow);
    this.procurementPackageImport = null;
    forgetProcurementImportSession(this, { storage: flow.importWorkspaceStorage });
    return true;
  }
  const nextRevision = flow.controller.revisions[flow.controller.currentIndex + 1];
  const shouldContinue = await this.view.customConfirm(
    `Đã lưu phiên bản ${savedRevision}`,
    `Gói thầu trên Mua Sắm Công còn phiên bản ${nextRevision.revisionNumber}. Bạn có muốn tiếp tục nhập phiên bản này không?`,
    "help-circle",
  );
  assertPackageImportCapabilityCurrent(this, flow);
  if (!shouldContinue) {
    await (flow.client || new ProcurementImportClient()).cancelImportSession(
      flow.session.sessionId,
      {
        workspaceLease: flow.importWorkspaceLease.token || null,
        kind: "notice",
      },
    );
    assertPackageImportCapabilityCurrent(this, flow);
    flow.controller.cancel();
    this.procurementPackageImport = null;
    forgetProcurementImportSession(this, { storage: flow.importWorkspaceStorage });
    return true;
  }
  const nextDraft = await flow.controller.next();
  assertPackageImportCapabilityCurrent(this, flow);
  const packageDraft = nextDraft.packageDrafts?.[0];
  const nextFlow = {
    ...flow,
    currentDraft: nextDraft,
    sourcePackageDraft: packageDraft,
  };
  this.procurementPackageImport = nextFlow;
  assertPackageImportCapabilityCurrent(this, nextFlow);
  rememberProcurementImportSession(this, nextFlow);
  await this.packages.edit(savedPackageId);
  assertPackageImportCapabilityCurrent(this, nextFlow);
  fillPackageFormFromProcurementDraft(globalThis.document, packageDraft, this);
  return true;
}
