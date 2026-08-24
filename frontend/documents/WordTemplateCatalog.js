import { ApiError, apiFetch, requestJson } from "../shared/apiClient.js";
import { canManageWorkspaceWordVariables } from "../auth/accessContext.js";
import {
  captureWorkspaceLease,
  isWorkspaceLeaseCurrent,
} from "../app/workspaceLease.js";

const CATALOG_URL = "/api/word-template-catalog";
const LIFECYCLE_LABELS = Object.freeze({
  DRAFT: "Bản nháp",
  PUBLISHED: "Đã phát hành",
  RETIRED: "Đã thay thế",
});
const DOCUMENT_TYPE_LABELS = Object.freeze({
  unknown: "Chưa nhận diện",
  cong_van: "Công văn",
  nghi_quyet_ca_biet: "Nghị quyết cá biệt",
  quyet_dinh_truc_tiep: "Quyết định trực tiếp",
  quyet_dinh_gian_tiep: "Quyết định gián tiếp",
  cong_dien: "Công điện",
  giay_moi: "Giấy mời",
  giay_gioi_thieu: "Giấy giới thiệu",
  bien_ban: "Biên bản",
  giay_nghi_phep: "Giấy nghỉ phép",
  phu_luc: "Phụ lục",
  ban_sao: "Bản sao",
  hop_dong: "Hợp đồng",
  thong_bao: "Thông báo",
  bao_cao: "Báo cáo",
  ke_hoach: "Kế hoạch",
});

function text(value) {
  return String(value ?? "");
}

function createElement(tag, className = "", content = "") {
  const element = document.createElement(tag);
  if (className) element.className = className;
  if (content !== "") element.textContent = text(content);
  return element;
}

function formatDateTime(value) {
  const parsed = new Date(value);
  if (!value || Number.isNaN(parsed.getTime())) return "Không rõ thời điểm";
  return new Intl.DateTimeFormat("vi-VN", {
    dateStyle: "short",
    timeStyle: "short",
  }).format(parsed);
}

function formatBytes(value) {
  const size = Number(value);
  if (!Number.isFinite(size) || size < 0) return "—";
  if (size < 1024) return `${size} B`;
  if (size < 1024 ** 2) return `${(size / 1024).toFixed(1)} KB`;
  return `${(size / (1024 ** 2)).toFixed(1)} MB`;
}

function errorMessage(error) {
  if (error instanceof ApiError && error.status === 403) {
    return "Bạn không có quyền thực hiện thao tác này.";
  }
  return error instanceof Error ? error.message : String(error);
}

function lifecycleBadge(lifecycle) {
  const normalized = Object.hasOwn(LIFECYCLE_LABELS, lifecycle) ? lifecycle : "RETIRED";
  const badge = createElement(
    "span",
    `word-template-lifecycle-badge is-${normalized.toLowerCase()}`,
    LIFECYCLE_LABELS[normalized],
  );
  badge.dataset.lifecycle = normalized;
  return badge;
}

function stateFor(controller) {
  controller._wordTemplateCatalogState ||= {
    templates: [],
    selectedTemplateId: "",
    versionPayload: null,
    preflights: new Map(),
    preflightSequence: 0,
    standardizationRequests: new Map(),
    requestSequence: 0,
  };
  return controller._wordTemplateCatalogState;
}

function roots() {
  return {
    card: document.getElementById("word-template-catalog-card"),
    list: document.getElementById("word-template-catalog-list"),
    timeline: document.getElementById("word-template-version-timeline"),
    status: document.getElementById("word-template-catalog-status"),
    refresh: document.getElementById("word-template-catalog-refresh"),
    create: document.getElementById("word-template-catalog-create"),
    draft: document.getElementById("word-template-catalog-new-draft"),
    standardizationProfile: document.getElementById(
      "word-template-standardization-profile",
    ),
  };
}

function setBusy(element, busy) {
  if (!element) return;
  element.setAttribute("aria-busy", String(Boolean(busy)));
}

function setStatus(message) {
  const { status } = roots();
  if (status) status.textContent = message;
}

export class WordTemplateCatalogClient {
  constructor(request = requestJson) {
    this.request = request;
  }

  listTemplates({ includeRetired = false, signal } = {}) {
    const query = includeRetired ? "?includeRetired=true" : "";
    return this.request(`${CATALOG_URL}${query}`, { method: "GET", signal });
  }

  listVersions(templateId, { signal } = {}) {
    return this.request(
      `${CATALOG_URL}/${encodeURIComponent(templateId)}/versions`,
      { method: "GET", signal },
    );
  }

  runPreflight(versionId, documentTypes = [], standardizationProfile = "sector_template") {
    return this.request(
      `${CATALOG_URL}/versions/${encodeURIComponent(versionId)}/preflight`,
      { method: "POST", body: { documentTypes, standardizationProfile } },
    );
  }

  publish(templateId, payload) {
    return this.request(`${CATALOG_URL}/${encodeURIComponent(templateId)}/publish`, {
      method: "POST",
      body: payload,
    });
  }

  restore(templateId, payload) {
    return this.request(`${CATALOG_URL}/${encodeURIComponent(templateId)}/restore`, {
      method: "POST",
      body: payload,
    });
  }

  async preview(versionId, payload) {
    const response = await apiFetch(
      `${CATALOG_URL}/versions/${encodeURIComponent(versionId)}/preview`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      },
    );
    if (!response.ok) {
      const data = await response.json().catch(() => null);
      throw new ApiError(
        data?.error || `Không thể tạo bản xem trước (${response.status}).`,
        { status: response.status, code: data?.code || "", data, response },
      );
    }
    const disposition = response.headers.get("content-disposition") || "";
    const filename = disposition.match(/filename="([^"]+)"/iu)?.[1]
      || `word-template-preview-${versionId}.docx`;
    return { blob: await response.blob(), filename };
  }

  async previewStandardized(versionId, payload) {
    const response = await apiFetch(
      `${CATALOG_URL}/versions/${encodeURIComponent(versionId)}/standardized-preview`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      },
    );
    if (!response.ok) {
      const data = await response.json().catch(() => null);
      throw new ApiError(
        data?.error || `Không thể tạo bản chuẩn hóa (${response.status}).`,
        { status: response.status, code: data?.code || "", data, response },
      );
    }
    const disposition = response.headers.get("content-disposition") || "";
    const filename = disposition.match(/filename="([^"]+)"/iu)?.[1]
      || `word-template-standardized-${versionId}.docx`;
    return { blob: await response.blob(), filename };
  }

  createStandardizedDraft(templateId, payload, idempotencyKey) {
    return this.request(
      `${CATALOG_URL}/${encodeURIComponent(templateId)}/standardized-drafts`,
      {
        method: "POST",
        headers: { "Idempotency-Key": idempotencyKey },
        body: payload,
      },
    );
  }

  async createTemplate(file) {
    const form = new FormData();
    form.append("file", file);
    form.append("displayName", file.name.replace(/\.docx$/iu, ""));
    form.append("stableCode", file.name.replace(/\.docx$/iu, ""));
    form.append("legacyAlias", file.name);
    return this.request(CATALOG_URL, { method: "POST", body: form });
  }

  async createDraft(templateId, expectedRowVersion, file) {
    const form = new FormData();
    form.append("file", file);
    form.append("expectedRowVersion", String(expectedRowVersion));
    return this.request(
      `${CATALOG_URL}/${encodeURIComponent(templateId)}/drafts`,
      { method: "POST", body: form },
    );
  }
}

export function loadWordTemplateCatalogStyles() {
  if (document.querySelector('link[data-word-template-catalog-styles="true"]')) {
    return Promise.resolve();
  }
  return new Promise((resolve) => {
    const link = document.createElement("link");
    link.rel = "stylesheet";
    link.href = "/frontend/documents/WordTemplateCatalog.css";
    link.dataset.wordTemplateCatalogStyles = "true";
    link.addEventListener("load", resolve, { once: true });
    link.addEventListener("error", resolve, { once: true });
    document.head.appendChild(link);
  });
}

function canManage(controller) {
  return canManageWorkspaceWordVariables(
    controller.model?.state?.activeuser || {},
    controller.model?.state?.activerole,
  );
}

function renderTemplateList(controller) {
  const { list } = roots();
  if (!list) return;
  const state = stateFor(controller);
  list.replaceChildren();
  setBusy(list, false);
  if (state.templates.length === 0) {
    list.appendChild(createElement(
      "p",
      "word-template-catalog-empty",
      "Chưa có biểu mẫu nào trong danh mục vòng đời.",
    ));
    return;
  }
  state.templates.forEach((template) => {
    const button = createElement("button", "word-template-catalog-item");
    button.type = "button";
    button.dataset.templateId = template.id;
    button.classList.toggle("is-selected", template.id === state.selectedTemplateId);
    button.setAttribute("aria-pressed", String(template.id === state.selectedTemplateId));
    const heading = createElement("span", "word-template-catalog-item-heading");
    heading.append(
      createElement("strong", "", template.displayName),
      createElement("code", "", template.stableCode),
    );
    const summary = createElement("span", "word-template-catalog-item-summary");
    if (template.publishedVersionId) summary.append(lifecycleBadge("PUBLISHED"));
    if (template.draftVersionId) summary.append(lifecycleBadge("DRAFT"));
    if (!template.publishedVersionId && !template.draftVersionId) {
      summary.append(lifecycleBadge("RETIRED"));
    }
    summary.append(createElement("span", "", `Revision ${template.rowVersion}`));
    button.append(heading, summary);
    button.addEventListener("click", () => selectTemplate(controller, template.id));
    list.appendChild(button);
  });
}

function renderPreflight(report) {
  const panel = createElement("div", "word-template-preflight-result");
  if (!report) {
    panel.appendChild(createElement(
      "p",
      "word-template-preflight-empty",
      "Chưa chạy kiểm tra trong phiên làm việc này.",
    ));
    return panel;
  }
  const summary = report.report?.summary || {};
  const result = createElement(
    "p",
    `word-template-preflight-summary is-${text(report.result).toLowerCase()}`,
    report.result === "PASS"
      ? `Đạt · ${Number(summary.warnings || 0)} cảnh báo`
      : `Chưa đạt · ${Number(summary.blockers || 0)} lỗi chặn`,
  );
  const issues = createElement("ul", "word-template-preflight-issues");
  (report.report?.issues || []).forEach((issue) => {
    const item = createElement("li");
    const severity = text(issue.severity || issue.level || "WARNING").toUpperCase();
    item.append(
      createElement("strong", "", severity === "BLOCKER" ? "Lỗi chặn: " : "Cảnh báo: "),
      document.createTextNode(text(issue.message || issue.code || "Kiểm tra chưa xác định")),
    );
    issues.appendChild(item);
  });
  panel.appendChild(result);
  if (issues.childElementCount) panel.appendChild(issues);
  const standardization = report.report?.standardization;
  const unavailable = report.report?.standardizationUnavailable;
  if (unavailable) {
    const unavailablePanel = createElement(
      "div",
      "word-template-standardization-result",
    );
    unavailablePanel.append(
      createElement(
        "p",
        "word-template-standardization-heading",
        "Kiểm tra thể thức tạm thời chưa khả dụng",
      ),
      createElement(
        "p",
        "word-template-standardization-summary",
        "Kiểm tra tương thích vẫn hoàn tất. Hãy thử lại kiểm tra thể thức trước khi chuẩn hóa.",
      ),
    );
    panel.appendChild(unavailablePanel);
  }
  if (standardization) {
    const formatPanel = createElement("div", "word-template-standardization-result");
    const documentType = standardization.documentType || {};
    const typeCode = text(documentType.value || "unknown");
    const typeLabel = DOCUMENT_TYPE_LABELS[typeCode] || typeCode;
    const confidence = Math.round(Number(documentType.confidence || 0) * 100);
    const formatSummary = standardization.summary || {};
    formatPanel.appendChild(createElement(
      "p",
      "word-template-standardization-heading",
      `Kiểm tra thể thức · ${typeLabel} (${confidence}%)`,
    ));
    const metrics = createElement("p", "word-template-standardization-summary");
    [
      ["Đạt", Number(formatSummary.compliant || 0)],
      ["Có thể sửa an toàn", Number(formatSummary.safeFixes || 0)],
      ["Chỉ xem trước", Number(formatSummary.previewOnly || 0)],
      ["Cần kiểm tra", Number(formatSummary.manualReview || 0)],
    ].forEach(([label, value]) => {
      const metric = createElement("span");
      metric.append(
        createElement("strong", "", String(value)),
        document.createTextNode(` ${label.toLocaleLowerCase("vi-VN")}`),
      );
      metrics.appendChild(metric);
    });
    formatPanel.appendChild(metrics);
    const issueSamples = standardization.issues || [];
    const totalIssues = Number(
      standardization.issueInventory?.totalCount ?? issueSamples.length,
    );
    const formatIssues = createElement("ul", "word-template-standardization-issues");
    issueSamples.slice(0, 6).forEach((issue) => {
      const policy = text(issue.fixPolicy || "MANUAL_REVIEW");
      const policyLabel = policy === "SAFE_AUTO_FIX"
        ? "Sửa an toàn"
        : policy === "PREVIEW_ONLY" ? "Xem trước" : "Kiểm tra thủ công";
      const item = createElement("li");
      item.append(
        createElement("strong", "", `${policyLabel}: `),
        document.createTextNode(text(issue.message || issue.ruleId || "Kiểm tra thể thức")),
      );
      formatIssues.appendChild(item);
    });
    if (totalIssues > Math.min(6, issueSamples.length)) {
      formatIssues.appendChild(createElement(
        "li",
        "",
        `Còn ${totalIssues - Math.min(6, issueSamples.length)} mục; danh sách đang hiển thị mẫu đã giới hạn.`,
      ));
    }
    if (formatIssues.childElementCount) formatPanel.appendChild(formatIssues);
    panel.appendChild(formatPanel);
  }
  return panel;
}

async function requestReason(controller, action, version) {
  const title = action === "publish"
    ? "Phát hành biểu mẫu"
    : action === "standardize" ? "Tạo bản nháp đã chuẩn hóa" : "Khôi phục thành bản nháp";
  const message = action === "publish"
    ? `Xác nhận phát hành phiên bản ${version.versionNo}. Hãy ghi lý do để lưu cùng lịch sử kiểm toán.`
    : action === "standardize"
      ? `Phiên bản ${version.versionNo} sẽ được chuẩn hóa định dạng an toàn thành một bản nháp bất biến mới. Bản nguồn không thay đổi.`
      : `Phiên bản ${version.versionNo} sẽ được sao chép thành một bản nháp bất biến mới. Hãy ghi lý do.`;
  const reason = await controller.view?.customPrompt?.(
    title,
    message,
    "",
    "Nhập lý do",
    false,
    (value) => Boolean(String(value || "").trim()),
    "text",
    { inputLabel: "Lý do bắt buộc" },
  );
  return typeof reason === "string" ? reason.trim() : "";
}

async function recoverStale(controller, error) {
  if (!(error instanceof ApiError) || error.status !== 409) return false;
  setStatus("Dữ liệu đã thay đổi ở nơi khác. Đang tải lại trạng thái mới nhất…");
  await loadAndRenderWordTemplateCatalog(controller, { preserveSelection: true });
  setStatus("Đã tải lại trạng thái mới nhất. Vui lòng kiểm tra và thực hiện lại thao tác.");
  return true;
}

async function runPreflight(controller, version, button) {
  const state = stateFor(controller);
  const profile = roots().standardizationProfile?.value || "sector_template";
  const sequence = ++state.preflightSequence;
  button.disabled = true;
  button.setAttribute("aria-busy", "true");
  setStatus(`Đang kiểm tra phiên bản ${version.versionNo}…`);
  try {
    const report = await new WordTemplateCatalogClient().runPreflight(
      version.id,
      [],
      profile,
    );
    if (
      sequence !== state.preflightSequence
      || roots().standardizationProfile?.value !== profile
      || !state.versionPayload?.versions?.some((item) => item.id === version.id)
    ) {
      return;
    }
    state.preflights.set(version.id, report);
    renderVersionTimeline(controller);
    const safeFixes = Number(
      report.report?.standardization?.summary?.safeFixes || 0,
    );
    setStatus(report.result === "PASS"
      ? safeFixes > 0
        ? `Phiên bản ${version.versionNo} đạt kiểm tra tương thích và có ${safeFixes} nhóm định dạng có thể sửa an toàn.`
        : `Phiên bản ${version.versionNo} đã đạt kiểm tra trước phát hành.`
      : `Phiên bản ${version.versionNo} còn lỗi chặn cần xử lý.`);
  } catch (error) {
    setStatus(`Không thể kiểm tra phiên bản: ${errorMessage(error)}`);
  } finally {
    button.removeAttribute("aria-busy");
    if (button.isConnected) button.disabled = false;
  }
}

async function publishVersion(controller, version, button) {
  const state = stateFor(controller);
  const preflight = state.preflights.get(version.id);
  if (!preflight || preflight.result !== "PASS") {
    setStatus("Cần một kết quả kiểm tra đạt trước khi phát hành phiên bản này.");
    return;
  }
  const reason = await requestReason(controller, "publish", version);
  if (!reason) return;
  button.disabled = true;
  setStatus(`Đang phát hành phiên bản ${version.versionNo}…`);
  try {
    await new WordTemplateCatalogClient().publish(state.selectedTemplateId, {
      versionId: version.id,
      acceptedPreflightRunId: preflight.id,
      expectedRowVersion: state.versionPayload.template.rowVersion,
      reason,
    });
    await loadAndRenderWordTemplateCatalog(controller, { preserveSelection: true });
    setStatus(`Đã phát hành phiên bản ${version.versionNo}.`);
    controller.view?.showToast?.(
      "Đã phát hành biểu mẫu",
      `Phiên bản ${version.versionNo} đã trở thành phiên bản phát hành.`,
      "success",
    );
  } catch (error) {
    if (!await recoverStale(controller, error)) {
      setStatus(`Không thể phát hành: ${errorMessage(error)}`);
    }
  } finally {
    if (button.isConnected) button.disabled = false;
  }
}

async function restoreVersion(controller, version, button) {
  const state = stateFor(controller);
  const reason = await requestReason(controller, "restore", version);
  if (!reason) return;
  button.disabled = true;
  setStatus(`Đang khôi phục phiên bản ${version.versionNo} thành bản nháp mới…`);
  try {
    await new WordTemplateCatalogClient().restore(state.selectedTemplateId, {
      sourceVersionId: version.id,
      expectedRowVersion: state.versionPayload.template.rowVersion,
      reason,
    });
    await loadAndRenderWordTemplateCatalog(controller, { preserveSelection: true });
    setStatus(`Đã tạo bản nháp mới từ phiên bản ${version.versionNo}.`);
    controller.view?.showToast?.(
      "Đã khôi phục biểu mẫu",
      `Một bản nháp mới đã được tạo từ phiên bản ${version.versionNo}.`,
      "success",
    );
  } catch (error) {
    if (!await recoverStale(controller, error)) {
      setStatus(`Không thể khôi phục: ${errorMessage(error)}`);
    }
  } finally {
    if (button.isConnected) button.disabled = false;
  }
}

function downloadPreview({ blob, filename }) {
  const objectUrl = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href = objectUrl;
  anchor.download = filename;
  anchor.hidden = true;
  document.body.appendChild(anchor);
  anchor.click();
  anchor.remove();
  setTimeout(() => URL.revokeObjectURL(objectUrl), 1_000);
}

async function previewVersion(controller, version, mode, button) {
  const documentType = document.getElementById(
    "word-template-preview-document-type",
  )?.value || "plan";
  let recordId = null;
  if (mode === "RECORD") {
    const recordLabel = documentType === "plan" ? "Kế hoạch" : "Gói thầu";
    const entered = await controller.view?.customPrompt?.(
      `Xem trước theo ${recordLabel}`,
      `Nhập ID ${recordLabel.toLocaleLowerCase("vi-VN")} mà bạn được phép đọc. Dữ liệu đầy đủ của bản ghi sẽ được dùng để tạo Word.`,
      "",
      `ID ${recordLabel.toLocaleLowerCase("vi-VN")}`,
      false,
      (value) => Boolean(String(value || "").trim()),
      "text",
      { inputLabel: `ID ${recordLabel}` },
    );
    recordId = typeof entered === "string" ? entered.trim() : "";
    if (!recordId) return;
  }
  button.disabled = true;
  button.setAttribute("aria-busy", "true");
  setStatus(mode === "SAMPLE"
    ? `Đang tạo bản xem trước dữ liệu mẫu cho phiên bản ${version.versionNo}…`
    : `Đang tạo bản xem trước theo bản ghi cho phiên bản ${version.versionNo}…`);
  try {
    const preview = await new WordTemplateCatalogClient().preview(version.id, {
      mode,
      documentType,
      ...(recordId ? { recordId } : {}),
    });
    downloadPreview(preview);
    setStatus(`Đã tạo bản xem trước phiên bản ${version.versionNo}.`);
  } catch (error) {
    setStatus(`Không thể tạo bản xem trước: ${errorMessage(error)}`);
  } finally {
    button.removeAttribute("aria-busy");
    if (button.isConnected) button.disabled = false;
  }
}

async function previewStandardizedVersion(controller, version, preflight, button) {
  const standardization = preflight?.report?.standardization;
  if (!standardization) {
    setStatus("Cần chạy kiểm tra thể thức trước khi xem bản chuẩn hóa.");
    return;
  }
  button.disabled = true;
  button.setAttribute("aria-busy", "true");
  setStatus(`Đang tạo bản chuẩn hóa xem trước cho phiên bản ${version.versionNo}…`);
  try {
    const preview = await new WordTemplateCatalogClient().previewStandardized(
      version.id,
      {
        acceptedPreflightRunId: preflight.id,
        standardizationProfile: standardization.profile,
      },
    );
    downloadPreview(preview);
    setStatus(`Đã tạo bản chuẩn hóa xem trước cho phiên bản ${version.versionNo}.`);
  } catch (error) {
    setStatus(`Không thể tạo bản chuẩn hóa xem trước: ${errorMessage(error)}`);
  } finally {
    button.removeAttribute("aria-busy");
    if (button.isConnected) button.disabled = false;
  }
}

async function createStandardizedDraft(controller, version, preflight, button) {
  const state = stateFor(controller);
  const standardization = preflight?.report?.standardization;
  if (!standardization || Number(standardization.summary?.safeFixes || 0) < 1) {
    setStatus("Phiên bản này chưa có thay đổi định dạng an toàn để áp dụng.");
    return;
  }
  const reason = await requestReason(controller, "standardize", version);
  if (!reason) return;
  button.disabled = true;
  button.setAttribute("aria-busy", "true");
  setStatus(`Đang tạo bản nháp chuẩn hóa từ phiên bản ${version.versionNo}…`);
  const requestPayload = {
    sourceVersionId: version.id,
    acceptedPreflightRunId: preflight.id,
    expectedRowVersion: state.versionPayload.template.rowVersion,
    standardizationProfile: standardization.profile,
    reason,
  };
  const operationKey = JSON.stringify(requestPayload);
  let idempotencyKey = state.standardizationRequests.get(operationKey);
  if (!idempotencyKey) {
    idempotencyKey = `wordstd-${crypto.randomUUID()}`;
    state.standardizationRequests.set(operationKey, idempotencyKey);
  }
  try {
    const result = await new WordTemplateCatalogClient().createStandardizedDraft(
      state.selectedTemplateId,
      requestPayload,
      idempotencyKey,
    );
    state.standardizationRequests.delete(operationKey);
    await loadAndRenderWordTemplateCatalog(controller, { preserveSelection: true });
    if (result.created === false) {
      setStatus("Biểu mẫu đã đúng các quy tắc sửa an toàn; không tạo phiên bản trùng lặp.");
      return;
    }
    setStatus(`Đã tạo bản nháp chuẩn hóa từ phiên bản ${version.versionNo}.`);
    controller.view?.showToast?.(
      "Đã tạo bản nháp chuẩn hóa",
      "Bản nguồn được giữ nguyên; hãy xem trước và chạy kiểm tra lại trước khi phát hành.",
      "success",
    );
  } catch (error) {
    const reusedKey = error instanceof ApiError
      && error.data?.fields?.["Idempotency-Key"] === "REUSED_WITH_DIFFERENT_REQUEST";
    if (reusedKey) {
      state.standardizationRequests.delete(operationKey);
      setStatus("Khóa chống lặp đã được dùng cho một yêu cầu khác. Hãy thử lại thao tác.");
    } else if (await recoverStale(controller, error)) {
      state.standardizationRequests.delete(operationKey);
    } else {
      setStatus(`Không thể tạo bản nháp chuẩn hóa: ${errorMessage(error)}`);
    }
  } finally {
    button.removeAttribute("aria-busy");
    if (button.isConnected) button.disabled = false;
  }
}

export function renderVersionTimeline(controller) {
  const { timeline } = roots();
  if (!timeline) return;
  const state = stateFor(controller);
  const payload = state.versionPayload;
  timeline.replaceChildren();
  setBusy(timeline, false);
  if (!payload || payload.template?.id !== state.selectedTemplateId) {
    timeline.appendChild(createElement(
      "p",
      "word-template-catalog-empty",
      "Chọn một biểu mẫu để xem lịch sử phiên bản.",
    ));
    return;
  }
  if (!payload.versions?.length) {
    timeline.appendChild(createElement("p", "word-template-catalog-empty", "Chưa có phiên bản."));
    return;
  }
  const editable = canManage(controller);
  payload.versions.forEach((version) => {
    const item = createElement("article", "word-template-version-item");
    item.dataset.versionId = version.id;
    const rail = createElement("div", "word-template-version-rail");
    rail.setAttribute("aria-hidden", "true");
    const content = createElement("div", "word-template-version-content");
    const header = createElement("div", "word-template-version-header");
    const title = createElement("h5", "", `Phiên bản ${version.versionNo}`);
    header.append(title, lifecycleBadge(version.lifecycle));
    const metadata = createElement("dl", "word-template-version-metadata");
    [
      ["Tệp nguồn", version.originalFilename],
      ["Người tạo", version.createdById],
      ["Thời điểm", formatDateTime(version.createdAt)],
      ["Dung lượng", formatBytes(version.byteSize)],
    ].forEach(([label, value]) => {
      metadata.append(createElement("dt", "", label), createElement("dd", "", value || "—"));
    });
    metadata.append(createElement("dt", "", "SHA-256"));
    const checksum = createElement("dd");
    const code = createElement("code", "word-template-version-checksum", version.sha256);
    code.title = version.sha256;
    checksum.appendChild(code);
    metadata.appendChild(checksum);
    const actions = createElement("div", "word-template-version-actions");
    const samplePreviewButton = createElement(
      "button", "btn btn-outline", "Xem trước dữ liệu mẫu",
    );
    samplePreviewButton.type = "button";
    samplePreviewButton.addEventListener("click", () => previewVersion(
      controller, version, "SAMPLE", samplePreviewButton,
    ));
    const recordPreviewButton = createElement(
      "button", "btn btn-outline", "Xem trước theo bản ghi",
    );
    recordPreviewButton.type = "button";
    recordPreviewButton.addEventListener("click", () => previewVersion(
      controller, version, "RECORD", recordPreviewButton,
    ));
    actions.append(samplePreviewButton, recordPreviewButton);
    const preflightButton = createElement("button", "btn btn-outline", "Chạy kiểm tra");
    preflightButton.type = "button";
    preflightButton.addEventListener("click", () => runPreflight(controller, version, preflightButton));
    actions.appendChild(preflightButton);
    const preflight = state.preflights.get(version.id);
    const standardization = preflight?.report?.standardization;
    const safeFixes = Number(standardization?.summary?.safeFixes || 0);
    if (standardization && safeFixes > 0) {
      const standardizedPreviewButton = createElement(
        "button", "btn btn-outline", "Xem bản chuẩn hóa",
      );
      standardizedPreviewButton.type = "button";
      standardizedPreviewButton.addEventListener("click", () => (
        previewStandardizedVersion(
          controller,
          version,
          preflight,
          standardizedPreviewButton,
        )
      ));
      actions.appendChild(standardizedPreviewButton);
      if (editable && standardization.profile !== "reference_only") {
        const standardizeButton = createElement(
          "button", "btn btn-outline", "Tạo bản nháp chuẩn hóa",
        );
        standardizeButton.type = "button";
        standardizeButton.addEventListener("click", () => createStandardizedDraft(
          controller,
          version,
          preflight,
          standardizeButton,
        ));
        actions.appendChild(standardizeButton);
      }
    }
    if (editable && version.lifecycle === "DRAFT") {
      const publishButton = createElement("button", "btn btn-primary", "Phát hành");
      publishButton.type = "button";
      publishButton.disabled = preflight?.result !== "PASS";
      publishButton.title = publishButton.disabled ? "Chạy kiểm tra đạt trước khi phát hành" : "";
      publishButton.addEventListener("click", () => publishVersion(controller, version, publishButton));
      actions.appendChild(publishButton);
    }
    if (editable && version.lifecycle !== "DRAFT") {
      const restoreButton = createElement("button", "btn btn-outline", "Khôi phục thành bản nháp");
      restoreButton.type = "button";
      restoreButton.addEventListener("click", () => restoreVersion(controller, version, restoreButton));
      actions.appendChild(restoreButton);
    }
    content.append(header, metadata, renderPreflight(state.preflights.get(version.id)), actions);
    item.append(rail, content);
    timeline.appendChild(item);
  });
  controller.view?.createIconsScoped?.(timeline);
}

async function selectTemplate(controller, templateId) {
  const state = stateFor(controller);
  state.preflightSequence += 1;
  state.selectedTemplateId = templateId;
  state.versionPayload = null;
  renderTemplateList(controller);
  const { timeline } = roots();
  setBusy(timeline, true);
  timeline?.replaceChildren(createElement("p", "word-template-catalog-empty", "Đang tải lịch sử phiên bản…"));
  const sequence = ++state.requestSequence;
  try {
    const payload = await new WordTemplateCatalogClient().listVersions(templateId);
    if (sequence !== state.requestSequence || state.selectedTemplateId !== templateId) return;
    state.versionPayload = payload;
    renderVersionTimeline(controller);
    setStatus(`Đã tải ${payload.versions?.length || 0} phiên bản.`);
  } catch (error) {
    if (sequence !== state.requestSequence) return;
    setBusy(timeline, false);
    timeline?.replaceChildren(createElement(
      "p",
      "word-template-catalog-empty is-error",
      `Không tải được lịch sử: ${errorMessage(error)}`,
    ));
    setStatus("Không tải được lịch sử phiên bản.");
  }
}

function bindRefresh(controller) {
  const {
    refresh, create, draft, standardizationProfile,
  } = roots();
  if (!refresh || refresh.dataset.bound === "true") return;
  refresh.dataset.bound = "true";
  refresh.addEventListener("click", async () => {
    refresh.disabled = true;
    refresh.setAttribute("aria-busy", "true");
    try {
      await loadAndRenderWordTemplateCatalog(controller, { preserveSelection: true });
      setStatus("Đã tải lại danh mục biểu mẫu.");
    } finally {
      refresh.disabled = false;
      refresh.removeAttribute("aria-busy");
    }
  });
  if (standardizationProfile && standardizationProfile.dataset.bound !== "true") {
    standardizationProfile.dataset.bound = "true";
    standardizationProfile.addEventListener("change", () => {
      const state = stateFor(controller);
      state.preflightSequence += 1;
      state.preflights.clear();
      renderVersionTimeline(controller);
      setStatus("Đã đổi chuẩn thể thức. Hãy chạy lại kiểm tra cho phiên bản cần xử lý.");
    });
  }
  const pickDocx = () => new Promise((resolve) => {
    const input = document.createElement("input");
    input.type = "file";
    input.accept = ".docx";
    input.addEventListener("change", () => resolve(input.files?.[0] || null), {
      once: true,
    });
    input.click();
  });
  const runUpload = async (mode, trigger) => {
    const file = await pickDocx();
    if (!file) return;
    trigger.disabled = true;
    setStatus(mode === "create" ? "Đang tạo biểu mẫu mới…" : "Đang tạo bản nháp mới…");
    try {
      const client = new WordTemplateCatalogClient();
      if (mode === "create") {
        const created = await client.createTemplate(file);
        stateFor(controller).selectedTemplateId = created.id;
      } else {
        const state = stateFor(controller);
        await client.createDraft(
          state.selectedTemplateId,
          state.versionPayload.template.rowVersion,
          file,
        );
      }
      await loadAndRenderWordTemplateCatalog(controller, { preserveSelection: true });
      setStatus(mode === "create" ? "Đã tạo biểu mẫu với bản nháp đầu tiên." : "Đã tạo bản nháp mới.");
    } catch (error) {
      if (!await recoverStale(controller, error)) {
        setStatus(`Không thể tải tệp: ${errorMessage(error)}`);
      }
    } finally {
      trigger.disabled = false;
    }
  };
  if (create) {
    create.hidden = !canManage(controller);
    create.addEventListener("click", () => runUpload("create", create));
  }
  if (draft) {
    draft.hidden = !canManage(controller) || !stateFor(controller).selectedTemplateId;
    draft.addEventListener("click", () => runUpload("draft", draft));
  }
}

export async function loadAndRenderWordTemplateCatalog(
  controller,
  { preserveSelection = false } = {},
) {
  const root = roots();
  if (!root.card || !root.list || !root.timeline) return null;
  await loadWordTemplateCatalogStyles();
  const lease = captureWorkspaceLease(controller.model);
  const state = stateFor(controller);
  const selectedBeforeLoad = preserveSelection ? state.selectedTemplateId : "";
  setBusy(root.list, true);
  root.list.replaceChildren(createElement("p", "word-template-catalog-empty", "Đang tải danh mục biểu mẫu…"));
  try {
    const templates = await new WordTemplateCatalogClient().listTemplates();
    if (!isWorkspaceLeaseCurrent(controller.model, lease)) return null;
    root.card.hidden = false;
    state.templates = Array.isArray(templates) ? templates : [];
    state.selectedTemplateId = state.templates.some((item) => item.id === selectedBeforeLoad)
      ? selectedBeforeLoad
      : state.templates[0]?.id || "";
    state.versionPayload = null;
    renderTemplateList(controller);
    bindRefresh(controller);
    controller.view?.createIconsScoped?.(root.card);
    if (state.selectedTemplateId) await selectTemplate(controller, state.selectedTemplateId);
    else renderVersionTimeline(controller);
    return state.templates;
  } catch (error) {
    if (!isWorkspaceLeaseCurrent(controller.model, lease)) return null;
    if (error instanceof ApiError && error.status === 404) {
      root.card.hidden = true;
      state.templates = [];
      state.selectedTemplateId = "";
      state.versionPayload = null;
      return null;
    }
    root.card.hidden = false;
    setBusy(root.list, false);
    root.list.replaceChildren(createElement(
      "p",
      "word-template-catalog-empty is-error",
      `Không tải được danh mục: ${errorMessage(error)}`,
    ));
    setStatus("Không tải được vòng đời biểu mẫu Word.");
    bindRefresh(controller);
    return null;
  }
}
