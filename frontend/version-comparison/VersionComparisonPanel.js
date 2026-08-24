import { postJson } from "../shared/apiClient.js";
import { loadStyleOnce } from "../shared/externalAssets.js";
import { trustedHTML } from "../shared/trustedTypes.js";
import { escapeHtml, safeAttr } from "../shared/view_helpers.js";
import {
  activateDialogAccessibility,
  deactivateDialogAccessibility,
} from "../shared/dialogAccessibility.js";
import { renderAccessibleTabs } from "../shared/AccessibleTabs.js";
import { renderVersionSelector } from "../shared/VersionSelector.js";

const CSS_URL = new URL("./VersionComparisonPanel.css", import.meta.url).pathname;

const CHANGE_LABELS = Object.freeze({
  ADDED: "Được thêm",
  REMOVED: "Bị xóa",
  MODIFIED: "Bị sửa",
  UNCHANGED: "Không thay đổi",
});

const IMPACT_LABELS = Object.freeze({
  CONFIRMED: "Đã xác nhận ảnh hưởng",
  POTENTIAL: "Có thể bị ảnh hưởng",
  NOT_EVALUATED: "Chưa đủ dữ liệu để đánh giá",
});

const FIELD_LABELS = Object.freeze({
  "package.bidClosingTime": "Thời gian đóng thầu",
  "package.price": "Giá gói thầu",
  "package.status": "Trạng thái gói thầu",
  "package.code": "Mã gói thầu",
  "package.name": "Tên gói thầu",
  "plan.code": "Mã kế hoạch",
  "plan.name": "Tên kế hoạch",
  thoiGianDongThau: "Thời gian đóng thầu",
  giaGoiThau: "Giá gói thầu",
  trangThai: "Trạng thái gói thầu",
  maGoiThau: "Mã gói thầu",
  tenGoiThau: "Tên gói thầu",
  maKeHoach: "Mã kế hoạch",
  tenKeHoach: "Tên kế hoạch",
  thoiGianDangMa: "Thời gian đăng mã",
  thoiGianDangTai: "Thời gian đăng tải",
  thoiGianMoThau: "Thời gian mở thầu",
  ngayPheDuyet: "Ngày phê duyệt",
  quyetDinhPheDuyet: "Quyết định phê duyệt",
  nguonVon: "Nguồn vốn",
  empId: "Nhân sự",
  type: "Loại đối tượng",
  targetId: "Đối tượng được phân công",
  soTaiKhoan: "Số tài khoản",
});

const RELATION_LABELS = Object.freeze({
  assignments: "Phân công nhân sự",
  packages: "Các gói thầu",
  timelineItems: "Các mốc tiến độ",
  yeuCauLamRoList: "Yêu cầu làm rõ",
  traLoiLamRoList: "Phản hồi làm rõ",
  giaHanList: "Các lần gia hạn",
  toChuyenGia: "Tổ chuyên gia",
  toThamDinh: "Tổ thẩm định",
});

const IMPACT_CATEGORY_LABELS = Object.freeze({
  TIMELINE: "Tiến độ",
  ASSIGNMENT: "Phân công nhân sự",
  LEGAL_RULES: "Quy định pháp lý",
  GENERATED_WORD: "Tài liệu Word đã tạo",
  PROGRESS: "Tiến trình thực hiện",
  WORKFLOW: "Quy trình xử lý",
  DOCUMENT: "Tài liệu",
  EVALUATION: "Đánh giá hồ sơ dự thầu",
  CONTRACT: "Hợp đồng",
  NOTIFICATION: "Thông báo",
  COMPLIANCE: "Tuân thủ",
});

const IMPACT_REASON_LABELS = Object.freeze({
  SOURCE_FIELD_CHANGED: "Dữ liệu nguồn đã thay đổi",
  AUTHORITATIVE_PROVIDER_NOT_AVAILABLE: "Chưa có nguồn dữ liệu thẩm quyền",
  TIMELINE_PROJECTION_CHANGED: "Các mốc tiến độ đã thay đổi",
  NO_TIMELINE_CHANGE: "Không phát hiện thay đổi tiến độ",
  ASSIGNMENT_MEMBERSHIP_CHANGED: "Thành viên được phân công đã thay đổi",
  NO_ASSIGNMENT_CHANGE: "Không phát hiện thay đổi phân công",
  LEGAL_VERSIONING_DISABLED: "Chức năng phiên bản pháp lý đang tắt",
  LEGAL_BINDING_UNAVAILABLE: "Chưa có căn cứ pháp lý để đối chiếu",
  LEGAL_BINDING_NOT_RESOLVED: "Căn cứ pháp lý chưa được xác định đầy đủ",
  EXACT_LEGAL_BINDING_CHANGED: "Căn cứ pháp lý áp dụng đã thay đổi",
  NO_LEGAL_BINDING_CHANGE: "Không phát hiện thay đổi căn cứ pháp lý",
  NO_GENERATED_DOCUMENT_PROVENANCE: "Chưa có nguồn gốc tài liệu đã tạo",
  NO_BUSINESS_CHANGE: "Không phát hiện thay đổi dữ liệu nghiệp vụ",
  GENERATED_DOCUMENT_SOURCE_VERSION_CHANGED: "Phiên bản nguồn của tài liệu đã thay đổi",
  UNREGISTERED_RELATION_POLICY: "Chưa có quy tắc ghép bản ghi liên quan",
  MISSING_BUSINESS_IDENTITY: "Bản ghi liên quan thiếu định danh nghiệp vụ",
  DUPLICATE_BUSINESS_IDENTITY: "Có nhiều bản ghi cùng định danh nghiệp vụ",
});

const VALUE_LABELS = Object.freeze({
  goithau: "Gói thầu",
  kehoach: "Kế hoạch lựa chọn nhà thầu",
  hopdong: "Hợp đồng",
  LEFT: "Phiên bản trái",
  RIGHT: "Phiên bản phải",
});

export function isVersionComparisonEnabled(root = globalThis.document) {
  return root?.querySelector?.('meta[name="bf-version-comparison-enabled"]')?.content === "true";
}

export function buildVersionComparisonRequest({
  entityType,
  leftVersionId,
  rightVersionId,
  includeUnchanged = false,
  relationPage = null,
} = {}) {
  const payload = {
    entityType: String(entityType || ""),
    leftVersionId: String(leftVersionId || ""),
    rightVersionId: String(rightVersionId || ""),
    includeUnchanged: includeUnchanged === true,
  };
  if (relationPage?.path && relationPage?.cursor) {
    payload.relationPage = {
      path: String(relationPage.path),
      cursor: String(relationPage.cursor),
      limit: Math.min(500, Math.max(1, Number(relationPage.limit) || 100)),
    };
  }
  return payload;
}

function displayValue(value) {
  if (value === null || value === undefined || value === "") return "—";
  if (typeof value === "object") return JSON.stringify(value, null, 2);
  return String(value);
}

function humanizeCode(value) {
  return String(value || "")
    .replace(/([a-zà-ỹ])([A-Z])/gu, "$1 $2")
    .replace(/[._-]+/gu, " ")
    .replace(/\s+/gu, " ")
    .trim()
    .toLocaleLowerCase("vi");
}

function fieldLabel(path, labelKey = "") {
  const leaf = String(path || "").split(".").at(-1);
  return FIELD_LABELS[labelKey] || FIELD_LABELS[path] || FIELD_LABELS[leaf] || "";
}

function displayScalar(value) {
  if (value === null || value === undefined || value === "") return "—";
  if (typeof value === "boolean") return value ? "Có" : "Không";
  return VALUE_LABELS[value] || String(value);
}

function structuredValueMarkup(value) {
  if (Array.isArray(value)) {
    if (!value.length) return '<span class="version-comparison-value-empty">—</span>';
    return `<ol class="version-comparison-value-list">${value.map(
      (item) => `<li>${structuredValueMarkup(item)}</li>`,
    ).join("")}</ol>`;
  }
  if (value && typeof value === "object") {
    return `<dl class="version-comparison-value-fields">${Object.entries(value).map(
      ([key, item]) => `<div><dt>${escapeHtml(FIELD_LABELS[key] || humanizeCode(key))}</dt><dd>${structuredValueMarkup(item)}</dd></div>`,
    ).join("")}</dl>`;
  }
  return `<span>${escapeHtml(displayScalar(value))}</span>`;
}

function relationIdentityMarkup(identity) {
  if (!identity || typeof identity !== "object") return structuredValueMarkup(identity);
  return `<div class="version-comparison-identity">${Object.entries(identity).map(
    ([key, value]) => `<span><strong>${escapeHtml(FIELD_LABELS[key] || humanizeCode(key))}:</strong> ${escapeHtml(displayScalar(value))}</span>`,
  ).join("")}</div>`;
}

function summaryMarkup(summary = {}) {
  return `<div class="version-comparison-summary" role="status" aria-live="polite">
    <span><strong>${Number(summary.added || 0)}</strong> được thêm</span>
    <span><strong>${Number(summary.removed || 0)}</strong> bị xóa</span>
    <span><strong>${Number(summary.modified || 0)}</strong> bị sửa</span>
    <span><strong>${Number(summary.unchanged || 0)}</strong> không đổi</span>
  </div>`;
}

function fieldChangeCount(fields = [], changeFilter = "ALL") {
  return fields.filter((field) => (
    changeFilter === "ALL"
      ? field?.change !== "UNCHANGED"
      : field?.change === changeFilter
  )).length;
}

function relationChangeCount(relations = [], changeFilter = "ALL") {
  const keys = changeFilter === "ALL"
    ? ["added", "removed", "modified"]
    : [String(changeFilter || "").toLocaleLowerCase("en")];
  return relations.reduce((total, relation) => (
    total + keys.reduce(
      (relationTotal, key) => relationTotal + Number(relation?.summary?.[key] || 0),
      0,
    )
  ), 0);
}

function scopeBreakdownMarkup(result = {}) {
  const fields = fieldChangeCount(result.fields);
  const relations = relationChangeCount(result.relations);
  return `<div class="version-comparison-scope-summary">
    <p>Tổng hợp trường dữ liệu và dữ liệu liên quan.</p>
    <span><strong>${fields}</strong> thay đổi trường dữ liệu</span>
    <span aria-hidden="true">·</span>
    <span><strong>${relations}</strong> thay đổi dữ liệu liên quan</span>
  </div>`;
}

function matchesChangeFilter(item, changeFilter) {
  return changeFilter === "ALL" || item?.change === changeFilter;
}

function fieldsMarkup(fields = [], changeFilter = "ALL") {
  const visibleFields = fields.filter((field) => matchesChangeFilter(field, changeFilter));
  if (!visibleFields.length) return '<p class="version-comparison-empty">Không có thay đổi trường dữ liệu trong bộ lọc hiện tại.</p>';
  return `<div class="version-comparison-table-wrap"><table class="version-comparison-table">
    <thead><tr><th scope="col">Trường</th><th scope="col">Phân loại</th><th scope="col">Phiên bản trước</th><th scope="col">Phiên bản sau</th></tr></thead>
    <tbody>${visibleFields.map((field) => `<tr>
      <th scope="row">${fieldLabel(field.path, field.labelKey)
    ? `<span>${escapeHtml(fieldLabel(field.path, field.labelKey))}</span>`
    : `<span>${escapeHtml(humanizeCode(field.path) || "Trường dữ liệu")}</span>`}</th>
      <td><span class="version-comparison-change" data-change="${safeAttr(field.change || "")}">${escapeHtml(CHANGE_LABELS[field.change] || field.change || "")}</span></td>
      <td data-version-side="before"><pre>${escapeHtml(displayValue(field.oldValue))}</pre></td>
      <td data-version-side="after"><pre>${escapeHtml(displayValue(field.newValue))}</pre></td>
    </tr>`).join("")}</tbody>
  </table></div>`;
}

function ambiguousValuesMarkup(match) {
  const oldValues = Array.isArray(match?.oldValues) ? match.oldValues : [];
  const newValues = Array.isArray(match?.newValues) ? match.newValues : [];
  return `<details><summary>Xem giá trị chưa thể ghép</summary>
    <div class="version-comparison-relation-values"><div>${structuredValueMarkup(oldValues)}</div><span aria-hidden="true">→</span><div>${structuredValueMarkup(newValues)}</div></div>
  </details>`;
}

function relationsMarkup(relations = [], changeFilter = "ALL") {
  if (!relations.length) return '<p class="version-comparison-empty">Không có dữ liệu liên quan để so sánh.</p>';
  return relations.map((relation) => {
    const visibleChanges = (relation.changes || []).filter(
      (change) => matchesChangeFilter(change, changeFilter),
    );
    return `<article class="version-comparison-relation">
    <h4>${escapeHtml(RELATION_LABELS[relation.path] || humanizeCode(relation.path) || "Dữ liệu liên quan")}</h4>
    ${summaryMarkup(relation.summary)}
    ${relation.ambiguousMatches?.length ? `<div class="version-comparison-warning"><p>${relation.ambiguousMatches.length} bản ghi chưa xác định được quan hệ; hệ thống không tự đoán ghép.</p>${relation.ambiguousMatches.map(ambiguousValuesMarkup).join("")}</div>` : ""}
    ${visibleChanges.length ? `<ul class="version-comparison-relation-changes">${visibleChanges.map((change) => `<li>
      <span class="version-comparison-change" data-change="${safeAttr(change.change || "")}">${escapeHtml(CHANGE_LABELS[change.change] || change.change || "")}</span>
      ${relationIdentityMarkup(change.identity)}
      <details><summary>Xem chi tiết thay đổi</summary><div class="version-comparison-relation-values"><div>${structuredValueMarkup(change.oldValue)}</div><span aria-hidden="true">→</span><div>${structuredValueMarkup(change.newValue)}</div></div></details>
    </li>`).join("")}</ul>` : '<p class="version-comparison-empty">Không có thay đổi dữ liệu liên quan trong trang này.</p>'}
    ${relation.nextCursor ? `<button type="button" class="btn btn-outline" data-load-relation-path="${safeAttr(relation.path || "")}" data-load-relation-cursor="${safeAttr(relation.nextCursor)}">Tải trang tiếp theo</button>` : ""}
  </article>`;
  }).join("");
}

function impactsMarkup(impacts = []) {
  return `<div class="version-comparison-impact-grid">${impacts.map((impact) => `<article class="version-comparison-impact" data-assessment="${safeAttr(impact.assessment || "")}">
    <h4>${escapeHtml(IMPACT_CATEGORY_LABELS[impact.category] || humanizeCode(impact.category))}</h4>
    <p><strong>${escapeHtml(IMPACT_LABELS[impact.assessment] || impact.assessment || "")}</strong></p>
    <p class="version-comparison-impact-reason">${escapeHtml(IMPACT_REASON_LABELS[impact.reasonCode] || humanizeCode(impact.reasonCode))}</p>
    ${impact.references?.length ? `<details><summary>Nguồn đối chiếu</summary>${structuredValueMarkup(impact.references)}</details>` : ""}
  </article>`).join("")}</div>`;
}

export function renderVersionComparisonResult(result = {}, changeFilter = "ALL") {
  const fields = fieldChangeCount(result.fields, changeFilter);
  const relations = relationChangeCount(result.relations, changeFilter);
  return `<div class="version-comparison-tabs"></div>
    <section data-comparison-panel="overview" aria-labelledby="version-comparison-overview-heading">
      <h3 id="version-comparison-overview-heading">Tổng quan</h3>
      ${summaryMarkup(result.summary)}
      ${scopeBreakdownMarkup(result)}
    </section>
    <section data-comparison-panel="fields" aria-labelledby="version-comparison-fields-heading" hidden>
      <h3 id="version-comparison-fields-heading">Chi tiết trường dữ liệu (${fields})</h3>
      ${fieldsMarkup(result.fields, changeFilter)}
    </section>
    <section data-comparison-panel="relations" aria-labelledby="version-comparison-relations-heading" hidden>
      <h3 id="version-comparison-relations-heading">Dữ liệu liên quan (${relations})</h3>
      ${relationsMarkup(result.relations, changeFilter)}
    </section>
    <section data-comparison-panel="impacts" aria-labelledby="version-comparison-impacts-heading" hidden>
      <h3 id="version-comparison-impacts-heading">Phân tích tác động</h3>
      ${impactsMarkup(result.impacts)}
    </section>`;
}

function bindResultTabs(
  resultRoot,
  initialTab = "overview",
  result = {},
  changeFilter = "ALL",
) {
  const tabsRoot = resultRoot?.querySelector?.(".version-comparison-tabs");
  if (!tabsRoot) return () => {};
  const panels = [...resultRoot.querySelectorAll("[data-comparison-panel]")];
  const select = (tabId) => {
    panels.forEach((panel) => {
      panel.hidden = panel.getAttribute("data-comparison-panel") !== tabId;
    });
    tabsRoot.querySelectorAll('[role="tab"]').forEach((tab) => {
      const active = tab.getAttribute("data-workflow-tab") === tabId;
      tab.setAttribute("aria-selected", active ? "true" : "false");
      tab.setAttribute("tabindex", active ? "0" : "-1");
      tab.classList.toggle("active", active);
    });
  };
  const cleanup = renderAccessibleTabs(
    tabsRoot,
    [
      { id: "overview", label: "Tổng quan", icon: "layout-dashboard" },
      {
        id: "fields",
        label: `Trường dữ liệu (${fieldChangeCount(result.fields, changeFilter)})`,
        icon: "list-tree",
      },
      {
        id: "relations",
        label: `Dữ liệu liên quan (${relationChangeCount(result.relations, changeFilter)})`,
        icon: "git-compare",
      },
      { id: "impacts", label: "Tác động", icon: "circle-alert" },
    ],
    initialTab,
    select,
    { groupId: "version-comparison", ariaLabel: "Các phần kết quả so sánh" },
  );
  panels.forEach((panel) => {
    const panelId = panel.getAttribute("data-comparison-panel");
    panel.id = `version-comparison-panel-${panelId}`;
    panel.setAttribute("role", "tabpanel");
    panel.setAttribute("aria-labelledby", `version-comparison-tab-${panelId}`);
  });
  select(initialTab);
  return cleanup;
}

function normalizedVersions(versions) {
  return [...versions]
    .map((version, index) => {
      const parsedVersion = Number.parseInt(
        version.phienBan ?? version.label ?? index + 1,
        10,
      );
      return {
        ...version,
        phienBan: Number.isFinite(parsedVersion) ? parsedVersion : index + 1,
      };
    })
    .sort((left, right) => Number(right.phienBan) - Number(left.phienBan));
}

function initialVersionPair(versions, selectedId) {
  const normalized = normalizedVersions(versions);
  const selectedIndex = Math.max(
    0,
    normalized.findIndex((item) => String(item.id) === String(selectedId)),
  );
  const right = normalized[selectedIndex] || normalized[0];
  const left = normalized[selectedIndex + 1]
    || normalized[selectedIndex - 1]
    || normalized.find((item) => String(item.id) !== String(right?.id));
  return { left, normalized, right };
}

export function openVersionComparisonPanel({
  versions = [],
  selectedId = "",
  entityType = "goithau",
  trigger = null,
  request = postJson,
  root = globalThis.document,
} = {}) {
  if (!root?.body || versions.length < 2) return () => {};
  loadStyleOnce(CSS_URL);
  root.getElementById?.("version-comparison-modal")?.remove?.();
  const { left, normalized, right } = initialVersionPair(versions, selectedId);
  const leftSelector = renderVersionSelector({
    versions: normalized,
    selectedId: left.id,
    rootId: "comparison-left",
    changeAction: "version-comparison-left",
    className: "version-comparison-native-select",
    ariaLabel: "Chọn phiên bản trước",
    name: "leftVersionId",
  });
  const rightSelector = renderVersionSelector({
    versions: normalized,
    selectedId: right.id,
    rootId: "comparison-right",
    changeAction: "version-comparison-right",
    className: "version-comparison-native-select",
    ariaLabel: "Chọn phiên bản sau",
    name: "rightVersionId",
  });
  const modal = root.createElement("div");
  modal.id = "version-comparison-modal";
  modal.className = "modal-overlay active version-comparison-modal";
  modal.innerHTML = trustedHTML(`<div class="modal-card version-comparison-card" role="dialog" aria-modal="true" aria-labelledby="version-comparison-title">
    <header class="version-comparison-header">
      <div class="version-comparison-header-copy">
        <p class="version-comparison-eyebrow">DÒNG PHIÊN BẢN</p>
        <h2 id="version-comparison-title">So sánh phiên bản</h2>
        <p class="version-comparison-description">Đối chiếu dữ liệu nghiệp vụ và phạm vi tác động giữa hai snapshot.</p>
      </div>
      <button type="button" class="btn btn-outline" data-close aria-label="Đóng so sánh phiên bản">Đóng</button>
    </header>
    <form class="version-comparison-controls">
      <fieldset class="version-comparison-pair">
        <legend>Chọn mốc so sánh</legend>
        <div class="version-comparison-pair-grid">
          <label class="version-comparison-version-choice">
            <span class="version-comparison-control-label">Phiên bản trước</span>
            <span class="version-comparison-select-shell">${leftSelector}<span class="version-comparison-select-chevron" aria-hidden="true"></span></span>
            <small>Mốc gốc</small>
          </label>
          <span class="version-comparison-direction" aria-hidden="true"><span>so với</span><b>→</b></span>
          <label class="version-comparison-version-choice">
            <span class="version-comparison-control-label">Phiên bản sau</span>
            <span class="version-comparison-select-shell">${rightSelector}<span class="version-comparison-select-chevron" aria-hidden="true"></span></span>
            <small>Mốc đối chiếu</small>
          </label>
        </div>
      </fieldset>
      <div class="version-comparison-settings">
        <label class="version-comparison-filter">
          <span class="version-comparison-control-label">Loại thay đổi</span>
          <span class="version-comparison-select-shell"><select class="version-comparison-native-select" name="changeFilter">
            <option value="ALL">Tất cả thay đổi</option>
            <option value="ADDED">Được thêm</option>
            <option value="REMOVED">Bị xóa</option>
            <option value="MODIFIED">Bị sửa</option>
            <option value="UNCHANGED">Không thay đổi</option>
          </select><span class="version-comparison-select-chevron" aria-hidden="true"></span></span>
        </label>
        <label class="version-comparison-checkbox"><input type="checkbox" name="includeUnchanged"><span>Hiện trường không đổi</span></label>
        <button type="submit" class="btn btn-primary version-comparison-submit">So sánh</button>
      </div>
    </form>
    <p class="version-comparison-live" role="status" aria-live="polite"></p>
    <div class="version-comparison-result"></div>
  </div>`);
  modal.querySelectorAll(".version-comparison-controls select").forEach((select) => {
    select.setAttribute("data-no-custom", "true");
  });
  root.body.append(modal);
  activateDialogAccessibility(modal, trigger);
  const form = modal.querySelector("form");
  const live = modal.querySelector(".version-comparison-live");
  const resultRoot = modal.querySelector(".version-comparison-result");
  const leftVersion = form.elements.leftVersionId;
  const rightVersion = form.elements.rightVersionId;
  let previousPair = { left: leftVersion.value, right: rightVersion.value };
  let controller = null;
  let currentQuery = null;
  let currentResult = null;
  let requestGeneration = 0;
  let tabsCleanup = () => {};
  const activeTab = () => (
    resultRoot.querySelector?.('[role="tab"][aria-selected="true"]')
      ?.getAttribute("data-workflow-tab") || "overview"
  );
  const renderCurrent = (tabId = activeTab()) => {
    tabsCleanup();
    resultRoot.innerHTML = trustedHTML(renderVersionComparisonResult(
      currentResult,
      form.elements.changeFilter.value,
    ));
    tabsCleanup = bindResultTabs(
      resultRoot,
      tabId,
      currentResult,
      form.elements.changeFilter.value,
    );
  };
  const close = () => {
    requestGeneration += 1;
    controller?.abort?.();
    tabsCleanup();
    deactivateDialogAccessibility(modal);
    modal.remove();
  };
  modal.querySelector("[data-close]").addEventListener("click", close);
  modal.addEventListener("click", (event) => {
    if (event.target === modal) close();
  });
  const run = async () => {
    if (leftVersion.value === rightVersion.value) {
      live.textContent = "Hãy chọn hai phiên bản khác nhau để so sánh.";
      live.setAttribute("role", "alert");
      return;
    }
    controller?.abort?.();
    controller = new AbortController();
    const generation = ++requestGeneration;
    live.textContent = "Đang so sánh hai snapshot…";
    live.setAttribute("role", "status");
    resultRoot.replaceChildren();
    const payload = buildVersionComparisonRequest({
      entityType,
      leftVersionId: form.elements.leftVersionId.value,
      rightVersionId: form.elements.rightVersionId.value,
      includeUnchanged: form.elements.includeUnchanged.checked,
    });
    currentQuery = payload;
    try {
      const result = await request(
        "/api/version-comparisons/query",
        payload,
        { signal: controller.signal, retries: 0 },
      );
      if (generation !== requestGeneration) return;
      live.textContent = "Đã cập nhật kết quả so sánh.";
      currentResult = result;
      renderCurrent("overview");
    } catch (error) {
      if (error?.name === "AbortError" || generation !== requestGeneration) return;
      live.textContent = error?.message || "Không thể so sánh phiên bản.";
      live.setAttribute("role", "alert");
    }
  };
  const loadNextRelationPage = async (button) => {
    if (!currentResult || !currentQuery) return;
    const path = button.getAttribute("data-load-relation-path");
    const cursor = button.getAttribute("data-load-relation-cursor");
    if (!path || !cursor) return;
    controller?.abort?.();
    controller = new AbortController();
    const generation = ++requestGeneration;
    button.disabled = true;
    const relationLabel = RELATION_LABELS[path] || humanizeCode(path) || "dữ liệu liên quan";
    live.textContent = `Đang tải trang tiếp theo của ${relationLabel}…`;
    live.setAttribute("role", "status");
    try {
      const pageResult = await request(
        "/api/version-comparisons/query",
        buildVersionComparisonRequest({
          ...currentQuery,
          relationPage: { path, cursor, limit: 100 },
        }),
        { signal: controller.signal, retries: 0 },
      );
      if (generation !== requestGeneration) return;
      const nextRelation = (pageResult.relations || []).find(
        (relation) => relation.path === path,
      );
      const existingRelation = (currentResult.relations || []).find(
        (relation) => relation.path === path,
      );
      if (!nextRelation || !existingRelation) throw new Error("Trang dữ liệu liên quan không hợp lệ.");
      existingRelation.changes = [
        ...(existingRelation.changes || []),
        ...(nextRelation.changes || []),
      ];
      existingRelation.nextCursor = nextRelation.nextCursor || null;
      renderCurrent("relations");
      live.textContent = `Đã tải thêm ${relationLabel}.`;
    } catch (error) {
      if (error?.name === "AbortError" || generation !== requestGeneration) return;
      button.disabled = false;
      live.textContent = error?.message || "Không thể tải trang dữ liệu liên quan tiếp theo.";
      live.setAttribute("role", "alert");
    }
  };
  form.addEventListener("submit", (event) => {
    event.preventDefault();
    run();
  });
  const keepVersionsDistinct = (changedSide) => {
    if (leftVersion.value === rightVersion.value) {
      const counterpart = changedSide === "left" ? rightVersion : leftVersion;
      counterpart.value = changedSide === "left" ? previousPair.left : previousPair.right;
      counterpart.__bfAccessibleCombobox?.refresh?.();
    }
    previousPair = { left: leftVersion.value, right: rightVersion.value };
  };
  leftVersion.addEventListener("change", () => keepVersionsDistinct("left"));
  rightVersion.addEventListener("change", () => keepVersionsDistinct("right"));
  form.elements.changeFilter.addEventListener("change", () => {
    if (currentResult) renderCurrent();
  });
  resultRoot.addEventListener("click", (event) => {
    const button = event.target.closest?.("[data-load-relation-cursor]");
    if (button) loadNextRelationPage(button);
  });
  run();
  return close;
}

export function bindVersionComparisonAction(container, detail, root = globalThis.document) {
  if (!container || !isVersionComparisonEnabled(root) || detail?.versions?.length < 2) return () => {};
  loadStyleOnce(CSS_URL);
  const button = root.createElement("button");
  button.type = "button";
  button.id = "btn-version-comparison";
  button.className = "btn btn-outline";
  button.textContent = "So sánh phiên bản";
  button.addEventListener("click", () => openVersionComparisonPanel({
    versions: detail.versions,
    selectedId: detail.selectedId || detail.packageId,
    entityType: detail.entityType || "goithau",
    trigger: button,
    root,
  }));
  container.append(button);
  return () => button.remove();
}
