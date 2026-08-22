import { makeSearchableSelect } from "../shared/PartnerHelpers.js";
import { appendExportSnapshotVersion } from "../shared/exportSnapshot.js";
import { loadStyleOnce } from "../shared/externalAssets.js";
import { authFetchDownload } from "../shared/view_helpers.js";
import {
  getAvailableWordPublicationTypes,
} from "./WordPublicationPolicy.js";
import {
  buildWordPublicationExportRequest,
  createWordPublicationState,
  getWordPublicationPackages,
  getWordPublicationPlans,
  selectWordPublicationPackage,
  selectWordPublicationPlan,
} from "./WordPublicationState.js";
import {
  loadWordPublicationTemplateConfig,
  resolvedWordPublicationTemplates,
} from "./WordPublicationTemplateConfig.js";

const WORD_PUBLICATION_STYLESHEET_URL = new URL(
  "./WordPublication.css?no-inline", import.meta.url,
).pathname;

export {
  getAvailableWordPublicationTypes,
  isDirectOrSpecialWordPublicationPackage,
  WORD_PUBLICATION_DOCUMENTS,
  WORD_PUBLICATION_PROCUREMENT_FORM,
  WORD_PUBLICATION_SELECTION_METHOD,
} from "./WordPublicationPolicy.js";

export {
  buildWordPublicationExportRequest,
  createWordPublicationState,
  getWordPublicationPackages,
  getWordPublicationPlans,
  selectWordPublicationPackage,
  selectWordPublicationPlan,
} from "./WordPublicationState.js";

function selectedRecord(records, id) {
  return records.find((record) => String(record?.id || "") === String(id || "")) || null;
}

function optionLabel(record, codeField, nameField, fallback) {
  const code = String(record?.[codeField] || "").trim();
  const name = String(record?.[nameField] || "").trim();
  return [code, name].filter(Boolean).join(" — ") || fallback;
}

function replaceOptions(select, records, {
  emptyLabel,
  codeField,
  nameField,
  fallback,
} = {}) {
  const fragment = document.createDocumentFragment();
  const empty = document.createElement("option");
  empty.value = "";
  empty.textContent = emptyLabel;
  fragment.appendChild(empty);
  records.forEach((record) => {
    const option = document.createElement("option");
    option.value = String(record.id || "");
    option.textContent = optionLabel(record, codeField, nameField, fallback);
    option.dataset.search = `${record?.[codeField] || ""} ${record?.[nameField] || ""}`;
    fragment.appendChild(option);
  });
  select.replaceChildren(fragment);
}

function setText(root, id, value) {
  const element = root.querySelector(`#${id}`);
  if (element) element.textContent = String(value || "—");
}

function setLiveStatus(root, message) {
  const status = root.querySelector("#word-publication-live-status");
  if (status) status.textContent = String(message || "");
}

function describeExportState(
  documentType,
  wordExportEnabled,
  templateResolutions,
  { loading = false, error = "" } = {},
) {
  if (!documentType.exportTarget) {
    return {
      label: "Chưa cấu hình mẫu",
      title: "Document đã có định danh ổn định nhưng chưa có mapping mẫu Word tương ứng.",
      enabled: false,
    };
  }
  if (!wordExportEnabled) {
    return {
      label: "Cần quyền xuất Word",
      title: "Phạm vi đang làm việc chưa có quyền xuất Word.",
      enabled: false,
    };
  }
  if (loading) {
    return {
      label: "Đang tải cấu hình",
      title: "Đang tải biểu mẫu Word được gán cho chức năng này.",
      enabled: false,
    };
  }
  if (error) {
    return {
      label: "Lỗi cấu hình mẫu",
      title: `Không tải được cấu hình biểu mẫu Word: ${error}`,
      enabled: false,
    };
  }
  if (!templateResolutions.length) {
    return {
      label: "Chưa chọn biểu mẫu",
      title: "Hãy chọn biểu mẫu phù hợp cho chức năng này trong màn hình Biểu mẫu Word.",
      enabled: false,
    };
  }
  return {
    label: `${templateResolutions.length} biểu mẫu sẵn sàng`,
    title: `Xuất ${templateResolutions.length} biểu mẫu Word đã được gán`,
    enabled: true,
  };
}

function createDocumentCard(documentType, {
  wordExportEnabled,
  pendingDocumentId,
  templateResolutions,
  templateConfigLoading,
  templateConfigError,
}) {
  const card = document.createElement("article");
  card.className = "word-publication-document-card";
  card.dataset.documentId = documentType.id;

  const icon = document.createElement("div");
  icon.className = "word-publication-document-icon";
  icon.setAttribute("aria-hidden", "true");
  const iconElement = document.createElement("i");
  iconElement.dataset.lucide = documentType.icon;
  icon.appendChild(iconElement);

  const content = document.createElement("div");
  content.className = "word-publication-document-content";
  const title = document.createElement("h4");
  title.textContent = documentType.label;
  const description = document.createElement("p");
  description.textContent = documentType.description;
  content.append(title, description);

  const actions = document.createElement("div");
  actions.className = "word-publication-document-actions";
  const exportState = describeExportState(
    documentType,
    wordExportEnabled,
    templateResolutions,
    { loading: templateConfigLoading, error: templateConfigError },
  );
  const status = document.createElement("span");
  status.className = `word-publication-document-status${exportState.enabled ? " is-ready" : ""}`;
  status.textContent = exportState.label;

  const button = document.createElement("button");
  button.type = "button";
  button.className = "btn btn-primary";
  button.dataset.wordPublicationExport = documentType.id;
  const isPending = pendingDocumentId === documentType.id;
  button.disabled = Boolean(pendingDocumentId) || !exportState.enabled;
  button.title = exportState.title;
  button.setAttribute("aria-label", `Xuất Word: ${documentType.label}`);
  const buttonIcon = document.createElement("i");
  buttonIcon.dataset.lucide = isPending ? "loader-2" : "download";
  if (isPending) buttonIcon.classList.add("animate-spin");
  const buttonText = document.createElement("span");
  buttonText.textContent = isPending
    ? "Đang xuất..."
    : "Xuất Word";
  button.append(buttonIcon, buttonText);
  actions.append(status, button);
  card.append(icon, content, actions);
  return card;
}

function renderWordPublicationPage(controller, root) {
  const state = controller._wordPublicationState;
  const planSelect = root.querySelector("#word-publication-plan-select");
  const packageSelect = root.querySelector("#word-publication-package-select");
  if (!planSelect || !packageSelect) return;

  const plans = getWordPublicationPlans(controller.model);
  if (!selectedRecord(plans, state.planId)) selectWordPublicationPlan(state, "");
  replaceOptions(planSelect, plans, {
    emptyLabel: plans.length ? "Tìm và chọn Kế hoạch..." : "Không có Kế hoạch phù hợp",
    codeField: "maKeHoach",
    nameField: "tenKeHoach",
    fallback: "Kế hoạch chưa có tên",
  });
  planSelect.value = state.planId;
  planSelect.disabled = Boolean(state.pendingDocumentId) || plans.length === 0;
  planSelect.removeAttribute("aria-busy");

  const packages = getWordPublicationPackages(controller.model, state.planId);
  if (!selectedRecord(packages, state.packageId)) selectWordPublicationPackage(state, "");
  const packageEmptyLabel = !state.planId
    ? "Vui lòng chọn Kế hoạch trước"
    : packages.length ? "Tìm và chọn Gói thầu..." : "Kế hoạch chưa có Gói thầu phù hợp";
  replaceOptions(packageSelect, packages, {
    emptyLabel: packageEmptyLabel,
    codeField: "maGoiThau",
    nameField: "tenGoiThau",
    fallback: "Gói thầu chưa có tên",
  });
  packageSelect.value = state.packageId;
  packageSelect.disabled = Boolean(state.pendingDocumentId) || !state.planId || packages.length === 0;
  packageSelect.removeAttribute("aria-busy");
  planSelect.__bfAccessibleCombobox?.refresh();
  packageSelect.__bfAccessibleCombobox?.refresh();

  const packageRecord = selectedRecord(packages, state.packageId);
  const emptyState = root.querySelector("#word-publication-empty");
  const summary = root.querySelector("#word-publication-summary");
  const documents = root.querySelector("#word-publication-documents");
  if (!packageRecord) {
    emptyState.hidden = false;
    const emptyTitle = emptyState.querySelector("h3");
    const emptyDescription = emptyState.querySelector("p");
    if (state.planId) {
      emptyTitle.textContent = "Chọn Gói thầu để xem văn bản";
      emptyDescription.textContent = packages.length
        ? "Danh sách Gói thầu đã được giới hạn theo Kế hoạch đang chọn."
        : "Kế hoạch này chưa có Gói thầu phù hợp với phạm vi được phép xem.";
    } else {
      emptyTitle.textContent = "Chọn Kế hoạch và Gói thầu để bắt đầu";
      emptyDescription.textContent = "Hệ thống sẽ tự xác định phương thức, hình thức lựa chọn và danh sách văn bản có thể xuất.";
    }
    summary.hidden = true;
    documents.hidden = true;
    root.querySelector("#word-publication-document-grid").replaceChildren();
    setLiveStatus(root, state.planId ? "Đã tải danh sách Gói thầu theo Kế hoạch." : "");
    controller.view?.createIconsScoped?.(root);
    return;
  }

  const availableDocuments = getAvailableWordPublicationTypes({
    plan: selectedRecord(plans, state.planId),
    packageRecord,
  });
  emptyState.hidden = true;
  summary.hidden = false;
  documents.hidden = false;
  setText(root, "word-publication-package-code", packageRecord.maGoiThau);
  setText(root, "word-publication-package-name", packageRecord.tenGoiThau);
  setText(root, "word-publication-selection-method", packageRecord.phuongThucLuaChon);
  setText(root, "word-publication-procurement-form", packageRecord.hinhThucLuaChon);
  setText(root, "word-publication-document-count", `${availableDocuments.length} loại văn bản`);
  const documentGrid = root.querySelector("#word-publication-document-grid");
  const templateConfig = controller._wordPublicationTemplateConfig;
  documentGrid.replaceChildren(...availableDocuments.map((documentType) => (
    createDocumentCard(documentType, {
      wordExportEnabled: Boolean(controller.model?.state?.activeuser?.wordExportEnabled),
      pendingDocumentId: state.pendingDocumentId,
      templateResolutions: resolvedWordPublicationTemplates(templateConfig, documentType.id),
      templateConfigLoading: Boolean(controller._wordPublicationTemplateConfigLoading),
      templateConfigError: String(controller._wordPublicationTemplateConfigError || ""),
    })
  )));
  setLiveStatus(root, `Đã xác định ${availableDocuments.length} loại văn bản phù hợp.`);
  controller.view?.createIconsScoped?.(root);
}

function selectionIdentity(value) {
  return String(value || "").trim().toLocaleLowerCase("vi");
}

function appendSelectedTemplateFilenames(url, filenames) {
  const separator = String(url).includes("?") ? "&" : "?";
  const query = filenames.map((filename) => (
    `templateFilename=${encodeURIComponent(filename)}`
  )).join("&");
  return `${url}${query ? separator + query : ""}`;
}

function selectedTemplateFilenames(dialog) {
  return [...dialog.querySelectorAll('[name="word-publication-template"]:checked')]
    .map((checkbox) => String(checkbox.value || "").trim())
    .filter(Boolean);
}

function updateWordPublicationSelectionDialog(dialog) {
  const checkboxes = [...dialog.querySelectorAll('[name="word-publication-template"]')];
  const selectedCount = checkboxes.filter((checkbox) => checkbox.checked).length;
  const selectAll = dialog.querySelector("[data-word-publication-select-all]");
  const confirm = dialog.querySelector("[data-word-publication-confirm]");
  const status = dialog.querySelector("#word-publication-export-selection-status");
  if (selectAll) {
    selectAll.checked = checkboxes.length > 0 && selectedCount === checkboxes.length;
    selectAll.indeterminate = selectedCount > 0 && selectedCount < checkboxes.length;
  }
  if (confirm) {
    confirm.disabled = selectedCount === 0;
    const label = confirm.querySelector("span");
    if (label) label.textContent = `Xuất ${selectedCount} file`;
  }
  if (status) status.textContent = `Đã chọn ${selectedCount}/${checkboxes.length} file`;
}

async function openWordPublicationSelectionDialog(controller, root, documentId, trigger) {
  const state = controller._wordPublicationState;
  if (state.pendingDocumentId) return false;
  const plans = getWordPublicationPlans(controller.model);
  const plan = selectedRecord(plans, state.planId);
  const packages = getWordPublicationPackages(controller.model, state.planId);
  const packageRecord = selectedRecord(packages, state.packageId);
  const documentType = getAvailableWordPublicationTypes({ plan, packageRecord })
    .find((item) => item.id === documentId);
  if (!plan || !packageRecord || !documentType) {
    selectWordPublicationPackage(state, "");
    renderWordPublicationPage(controller, root);
    await controller.view?.customAlert?.(
      "Dữ liệu đã thay đổi",
      "Kế hoạch, Gói thầu hoặc loại văn bản không còn hợp lệ. Vui lòng chọn lại.",
      "alert-triangle",
    );
    return false;
  }
  const templateResolutions = resolvedWordPublicationTemplates(
    controller._wordPublicationTemplateConfig,
    documentType.id,
  );
  if (!templateResolutions.length) {
    await controller.view?.customAlert?.(
      "Chưa chọn biểu mẫu Word",
      "Hãy gán biểu mẫu phù hợp cho chức năng này trong màn hình Biểu mẫu Word.",
      "file-warning",
    );
    return false;
  }
  if (!controller.model?.state?.activeuser?.wordExportEnabled) {
    await controller.view?.customAlert?.(
      "Chức năng cần quyền xuất Word",
      "Phạm vi đang làm việc chưa có quyền tạo hoặc tải tài liệu Word.",
      "lock-keyhole",
    );
    return false;
  }

  const dialog = root.querySelector("#word-publication-export-dialog");
  const tableBody = root.querySelector("#word-publication-export-table-body");
  if (!dialog || !tableBody || typeof dialog.showModal !== "function") return false;
  const rows = templateResolutions.map((template, index) => {
    const filename = String(template?.filename || "").trim();
    const row = document.createElement("tr");
    row.dataset.wordPublicationTemplateRow = "";
    row.dataset.filename = filename;
    const checkboxCell = document.createElement("td");
    checkboxCell.className = "word-publication-export-check-column";
    const checkbox = document.createElement("input");
    checkbox.type = "checkbox";
    checkbox.name = "word-publication-template";
    checkbox.value = filename;
    checkbox.id = `word-publication-template-${index}`;
    checkbox.checked = true;
    checkbox.setAttribute("aria-label", `Chọn ${filename}`);
    checkboxCell.appendChild(checkbox);
    const filenameCell = document.createElement("td");
    filenameCell.className = "word-publication-export-filename";
    const filenameLabel = document.createElement("label");
    filenameLabel.htmlFor = checkbox.id;
    filenameLabel.textContent = filename;
    filenameCell.appendChild(filenameLabel);
    const readyCell = document.createElement("td");
    readyCell.className = "word-publication-export-status-column";
    const ready = document.createElement("span");
    ready.className = "word-publication-export-ready";
    ready.textContent = "Sẵn sàng";
    readyCell.appendChild(ready);
    row.append(checkboxCell, filenameCell, readyCell);
    return row;
  });
  tableBody.replaceChildren(...rows);
  dialog.__bfWordPublicationSelection = { documentId, trigger };
  updateWordPublicationSelectionDialog(dialog);
  dialog.showModal();
  controller.view?.createIconsScoped?.(dialog);
  dialog.querySelector("[data-word-publication-select-all]")?.focus();
  return true;
}

async function exportWordPublicationDocument(
  controller,
  root,
  documentId,
  requestedTemplateFilenames,
) {
  const state = controller._wordPublicationState;
  if (state.pendingDocumentId) return false;
  const plans = getWordPublicationPlans(controller.model);
  const plan = selectedRecord(plans, state.planId);
  const packages = getWordPublicationPackages(controller.model, state.planId);
  const packageRecord = selectedRecord(packages, state.packageId);
  const documentType = getAvailableWordPublicationTypes({ plan, packageRecord })
    .find((item) => item.id === documentId);
  if (!plan || !packageRecord || !documentType) {
    selectWordPublicationPackage(state, "");
    renderWordPublicationPage(controller, root);
    await controller.view?.customAlert?.(
      "Dữ liệu đã thay đổi",
      "Kế hoạch, Gói thầu hoặc loại văn bản không còn hợp lệ. Vui lòng chọn lại.",
      "alert-triangle",
    );
    return false;
  }
  const templateResolutions = resolvedWordPublicationTemplates(
    controller._wordPublicationTemplateConfig,
    documentType.id,
  );
  if (!templateResolutions.length) {
    await controller.view?.customAlert?.(
      "Chưa chọn biểu mẫu Word",
      "Hãy gán biểu mẫu phù hợp cho chức năng này trong màn hình Biểu mẫu Word.",
      "file-warning",
    );
    return false;
  }
  if (!controller.model?.state?.activeuser?.wordExportEnabled) {
    await controller.view?.customAlert?.(
      "Chức năng cần quyền xuất Word",
      "Phạm vi đang làm việc chưa có quyền tạo hoặc tải tài liệu Word.",
      "lock-keyhole",
    );
    return false;
  }

  const requestedIdentities = new Set(
    (requestedTemplateFilenames || []).map(selectionIdentity).filter(Boolean),
  );
  const assignedIdentities = new Set(
    templateResolutions.map((template) => selectionIdentity(template?.filename)),
  );
  if (
    requestedIdentities.size === 0
    || [...requestedIdentities].some((identity) => !assignedIdentities.has(identity))
  ) {
    await controller.view?.customAlert?.(
      "Lựa chọn biểu mẫu đã thay đổi",
      "Danh sách file đã được cập nhật. Vui lòng mở lại bảng chọn và thử lại.",
      "file-warning",
    );
    return false;
  }
  const selectedTemplates = templateResolutions.filter((template) => (
    requestedIdentities.has(selectionIdentity(template?.filename))
  ));
  const selectedFilenames = selectedTemplates.map((template) => template.filename);

  let request;
  try {
    request = buildWordPublicationExportRequest({ documentType, plan, packageRecord });
    request.url = appendSelectedTemplateFilenames(request.url, selectedFilenames);
    if (selectedTemplates.length > 1) {
      request.filename = request.filename.replace(/\.docx$/iu, ".zip");
    }
  } catch (error) {
    await controller.view?.customAlert?.(
      "Chưa thể xuất Word",
      error instanceof Error ? error.message : String(error),
      "file-warning",
    );
    return false;
  }

  state.selectedDocumentId = documentId;
  state.pendingDocumentId = documentId;
  renderWordPublicationPage(controller, root);
  try {
    const snapshotVersion = await controller.prepareExportSnapshot();
    const currentPackages = getWordPublicationPackages(controller.model, state.planId);
    const currentPackage = selectedRecord(currentPackages, state.packageId);
    if (
      String(state.planId) !== String(plan.id)
      || String(state.packageId) !== String(packageRecord.id)
      || String(currentPackage?.keHoachId || "") !== String(plan.id)
    ) {
      throw new Error("Lựa chọn Kế hoạch hoặc Gói thầu đã thay đổi. Vui lòng xuất lại.");
    }
    await authFetchDownload(
      appendExportSnapshotVersion(request.url, snapshotVersion),
      request.filename,
    );
    controller.view?.showToast?.(
      "Đã xuất Word",
      selectedTemplates.length > 1
        ? `${selectedTemplates.length} tài liệu “${documentType.label}” đã được tạo từ dữ liệu mới nhất.`
        : `Tài liệu “${documentType.label}” đã được tạo từ dữ liệu mới nhất.`,
      "success",
    );
    return true;
  } catch (error) {
    await controller.view?.customAlert?.(
      "Không thể xuất Word",
      error instanceof Error ? error.message : String(error || "Lỗi xuất tài liệu"),
      "x-circle",
    );
    return false;
  } finally {
    if (state.pendingDocumentId === documentId) state.pendingDocumentId = "";
    renderWordPublicationPage(controller, root);
    root.querySelector(`[data-word-publication-export="${documentId}"]`)?.focus();
  }
}

function bindWordPublicationEvents(root) {
  if (root.__bfWordPublicationEventsBound) return;
  root.__bfWordPublicationEventsBound = true;
  const planSelect = root.querySelector("#word-publication-plan-select");
  const packageSelect = root.querySelector("#word-publication-package-select");
  planSelect.addEventListener("change", () => {
    const controller = root.__bfWordPublicationController;
    selectWordPublicationPlan(controller._wordPublicationState, planSelect.value);
    renderWordPublicationPage(controller, root);
  });
  packageSelect.addEventListener("change", () => {
    const controller = root.__bfWordPublicationController;
    selectWordPublicationPackage(controller._wordPublicationState, packageSelect.value);
    renderWordPublicationPage(controller, root);
  });
  const dialog = root.querySelector("#word-publication-export-dialog");
  dialog?.addEventListener("close", () => {
    const trigger = dialog.__bfWordPublicationSelection?.trigger;
    dialog.__bfWordPublicationSelection = null;
    trigger?.focus?.();
  });
  dialog?.addEventListener("submit", (event) => {
    event.preventDefault();
    const selection = dialog.__bfWordPublicationSelection;
    const filenames = selectedTemplateFilenames(dialog);
    if (!selection || !filenames.length) return;
    dialog.close("confirm");
    void exportWordPublicationDocument(
      root.__bfWordPublicationController,
      root,
      selection.documentId,
      filenames,
    );
  });
  dialog?.addEventListener("change", (event) => {
    if (event.target.matches?.("[data-word-publication-select-all]")) {
      dialog.querySelectorAll('[name="word-publication-template"]')
        .forEach((checkbox) => { checkbox.checked = event.target.checked; });
    }
    if (
      event.target.matches?.("[data-word-publication-select-all]")
      || event.target.matches?.('[name="word-publication-template"]')
    ) {
      updateWordPublicationSelectionDialog(dialog);
    }
  });
  root.addEventListener("click", (event) => {
    const cancel = event.target.closest?.("[data-word-publication-cancel]");
    if (cancel) {
      event.preventDefault();
      dialog?.close("cancel");
      return;
    }
    const button = event.target.closest?.("[data-word-publication-export]");
    if (!button || button.disabled) return;
    event.preventDefault();
    void openWordPublicationSelectionDialog(
      root.__bfWordPublicationController,
      root,
      button.dataset.wordPublicationExport,
      button,
    );
  });
}

export async function setupWordPublicationPage() {
  const controller = this;
  const root = document.getElementById("tab-xuatban-word");
  if (!root) return;
  await loadStyleOnce(WORD_PUBLICATION_STYLESHEET_URL);
  controller._wordPublicationState ||= createWordPublicationState();
  root.__bfWordPublicationController = controller;
  const planSelect = root.querySelector("#word-publication-plan-select");
  const packageSelect = root.querySelector("#word-publication-package-select");
  planSelect.setAttribute("aria-busy", "true");
  packageSelect.setAttribute("aria-busy", "true");
  bindWordPublicationEvents(root);
  makeSearchableSelect(planSelect, "Tìm và chọn Kế hoạch...");
  makeSearchableSelect(packageSelect, "Tìm và chọn Gói thầu...");
  await Promise.resolve();
  controller._wordPublicationTemplateConfigLoading = true;
  controller._wordPublicationTemplateConfigError = "";
  renderWordPublicationPage(controller, root);
  try {
    await loadWordPublicationTemplateConfig(controller);
  } catch {
    // Record data remains visible; export actions explain the configuration error.
  } finally {
    controller._wordPublicationTemplateConfigLoading = false;
    renderWordPublicationPage(controller, root);
  }
}
