import { postJson } from "../shared/apiClient.js";
import { trustedHTML } from "../shared/trustedTypes.js";
import { escapeHtml, safeAttr } from "../shared/view_helpers.js";
import {
  activateDialogAccessibility,
  deactivateDialogAccessibility,
} from "../shared/dialogAccessibility.js";
import { renderAccessibleTabs } from "../shared/AccessibleTabs.js";
import { renderVersionSelector } from "../shared/VersionSelector.js";

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

function summaryMarkup(summary = {}) {
  return `<div class="version-comparison-summary" role="status" aria-live="polite">
    <span><strong>${Number(summary.added || 0)}</strong> được thêm</span>
    <span><strong>${Number(summary.removed || 0)}</strong> bị xóa</span>
    <span><strong>${Number(summary.modified || 0)}</strong> bị sửa</span>
    <span><strong>${Number(summary.unchanged || 0)}</strong> không đổi</span>
  </div>`;
}

function matchesChangeFilter(item, changeFilter) {
  return changeFilter === "ALL" || item?.change === changeFilter;
}

function fieldsMarkup(fields = [], changeFilter = "ALL") {
  const visibleFields = fields.filter((field) => matchesChangeFilter(field, changeFilter));
  if (!visibleFields.length) return '<p class="version-comparison-empty">Không có thay đổi field trong bộ lọc hiện tại.</p>';
  return `<div class="version-comparison-table-wrap"><table class="version-comparison-table">
    <thead><tr><th scope="col">Trường</th><th scope="col">Phân loại</th><th scope="col">Phiên bản trái</th><th scope="col">Phiên bản phải</th></tr></thead>
    <tbody>${visibleFields.map((field) => `<tr>
      <th scope="row"><code>${escapeHtml(field.path || "")}</code></th>
      <td><span class="version-comparison-change" data-change="${safeAttr(field.change || "")}">${escapeHtml(CHANGE_LABELS[field.change] || field.change || "")}</span></td>
      <td><pre>${escapeHtml(displayValue(field.oldValue))}</pre></td>
      <td><pre>${escapeHtml(displayValue(field.newValue))}</pre></td>
    </tr>`).join("")}</tbody>
  </table></div>`;
}

function ambiguousValuesMarkup(match) {
  const oldValues = Array.isArray(match?.oldValues) ? match.oldValues : [];
  const newValues = Array.isArray(match?.newValues) ? match.newValues : [];
  return `<details><summary>Xem giá trị chưa thể ghép</summary>
    <div class="version-comparison-relation-values"><pre>${escapeHtml(displayValue(oldValues))}</pre><span aria-hidden="true">→</span><pre>${escapeHtml(displayValue(newValues))}</pre></div>
  </details>`;
}

function relationsMarkup(relations = [], changeFilter = "ALL") {
  if (!relations.length) return '<p class="version-comparison-empty">Không có relation để so sánh.</p>';
  return relations.map((relation) => {
    const visibleChanges = (relation.changes || []).filter(
      (change) => matchesChangeFilter(change, changeFilter),
    );
    return `<article class="version-comparison-relation">
    <h4>${escapeHtml(relation.path || "Relation")}</h4>
    ${summaryMarkup(relation.summary)}
    ${relation.ambiguousMatches?.length ? `<div class="version-comparison-warning"><p>${relation.ambiguousMatches.length} identity mơ hồ; hệ thống không tự đoán ghép.</p>${relation.ambiguousMatches.map(ambiguousValuesMarkup).join("")}</div>` : ""}
    ${visibleChanges.length ? `<ul class="version-comparison-relation-changes">${visibleChanges.map((change) => `<li>
      <span class="version-comparison-change" data-change="${safeAttr(change.change || "")}">${escapeHtml(CHANGE_LABELS[change.change] || change.change || "")}</span>
      <code>${escapeHtml(displayValue(change.identity))}</code>
      <details><summary>Xem giá trị</summary><div class="version-comparison-relation-values"><pre>${escapeHtml(displayValue(change.oldValue))}</pre><span aria-hidden="true">→</span><pre>${escapeHtml(displayValue(change.newValue))}</pre></div></details>
    </li>`).join("")}</ul>` : '<p class="version-comparison-empty">Không có thay đổi relation trong trang này.</p>'}
    ${relation.nextCursor ? `<button type="button" class="btn btn-outline" data-load-relation-path="${safeAttr(relation.path || "")}" data-load-relation-cursor="${safeAttr(relation.nextCursor)}">Tải trang tiếp theo</button>` : ""}
  </article>`;
  }).join("");
}

function impactsMarkup(impacts = []) {
  return `<div class="version-comparison-impact-grid">${impacts.map((impact) => `<article class="version-comparison-impact" data-assessment="${safeAttr(impact.assessment || "")}">
    <h4>${escapeHtml(impact.category || "")}</h4>
    <p><strong>${escapeHtml(IMPACT_LABELS[impact.assessment] || impact.assessment || "")}</strong></p>
    <code>${escapeHtml(impact.reasonCode || "")}</code>
    ${impact.references?.length ? `<details><summary>Provenance chính xác</summary><pre>${escapeHtml(displayValue(impact.references))}</pre></details>` : ""}
  </article>`).join("")}</div>`;
}

export function renderVersionComparisonResult(result = {}, changeFilter = "ALL") {
  return `<div class="version-comparison-tabs"></div>
    <section data-comparison-panel="overview" aria-labelledby="version-comparison-overview-heading">
      <h3 id="version-comparison-overview-heading">Tổng quan</h3>
      ${summaryMarkup(result.summary)}
    </section>
    <section data-comparison-panel="fields" aria-labelledby="version-comparison-fields-heading" hidden>
      <h3 id="version-comparison-fields-heading">Chi tiết field</h3>
      ${fieldsMarkup(result.fields, changeFilter)}
    </section>
    <section data-comparison-panel="relations" aria-labelledby="version-comparison-relations-heading" hidden>
      <h3 id="version-comparison-relations-heading">Relation</h3>
      ${relationsMarkup(result.relations, changeFilter)}
    </section>
    <section data-comparison-panel="impacts" aria-labelledby="version-comparison-impacts-heading" hidden>
      <h3 id="version-comparison-impacts-heading">Phân tích tác động</h3>
      ${impactsMarkup(result.impacts)}
    </section>`;
}

function bindResultTabs(resultRoot, initialTab = "overview") {
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
      { id: "fields", label: "Chi tiết field", icon: "list-tree" },
      { id: "relations", label: "Relation", icon: "git-compare" },
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
    .map((version, index) => ({
      ...version,
      phienBan: Number.parseInt(version.phienBan ?? version.label ?? index + 1, 10) || index + 1,
    }))
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
  root.getElementById?.("version-comparison-modal")?.remove?.();
  const { left, normalized, right } = initialVersionPair(versions, selectedId);
  const leftSelector = renderVersionSelector({
    versions: normalized,
    selectedId: left.id,
    rootId: "comparison-left",
    changeAction: "version-comparison-left",
    ariaLabel: "Chọn phiên bản trái",
    name: "leftVersionId",
  });
  const rightSelector = renderVersionSelector({
    versions: normalized,
    selectedId: right.id,
    rootId: "comparison-right",
    changeAction: "version-comparison-right",
    ariaLabel: "Chọn phiên bản phải",
    name: "rightVersionId",
  });
  const modal = root.createElement("div");
  modal.id = "version-comparison-modal";
  modal.className = "modal-overlay active version-comparison-modal";
  modal.innerHTML = trustedHTML(`<div class="modal-card version-comparison-card" role="dialog" aria-modal="true" aria-labelledby="version-comparison-title">
    <header class="version-comparison-header">
      <div><p class="version-comparison-eyebrow">DÒNG PHIÊN BẢN</p><h2 id="version-comparison-title">So sánh phiên bản</h2></div>
      <button type="button" class="btn btn-outline" data-close aria-label="Đóng so sánh phiên bản">Đóng</button>
    </header>
    <form class="version-comparison-controls">
      <label>Phiên bản trái${leftSelector}</label>
      <span aria-hidden="true">→</span>
      <label>Phiên bản phải${rightSelector}</label>
      <label class="version-comparison-checkbox"><input type="checkbox" name="includeUnchanged"> Hiện field không đổi</label>
      <label>Loại thay đổi<select name="changeFilter">
        <option value="ALL">Tất cả</option>
        <option value="ADDED">Được thêm</option>
        <option value="REMOVED">Bị xóa</option>
        <option value="MODIFIED">Bị sửa</option>
        <option value="UNCHANGED">Không thay đổi</option>
      </select></label>
      <button type="submit" class="btn btn-primary">So sánh</button>
    </form>
    <p class="version-comparison-live" role="status" aria-live="polite"></p>
    <div class="version-comparison-result"></div>
  </div>`);
  root.body.append(modal);
  activateDialogAccessibility(modal, trigger);
  const form = modal.querySelector("form");
  const live = modal.querySelector(".version-comparison-live");
  const resultRoot = modal.querySelector(".version-comparison-result");
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
    tabsCleanup = bindResultTabs(resultRoot, tabId);
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
    live.textContent = `Đang tải trang tiếp theo của ${path}…`;
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
      if (!nextRelation || !existingRelation) throw new Error("Trang relation không hợp lệ.");
      existingRelation.changes = [
        ...(existingRelation.changes || []),
        ...(nextRelation.changes || []),
      ];
      existingRelation.nextCursor = nextRelation.nextCursor || null;
      renderCurrent("relations");
      live.textContent = `Đã tải thêm dữ liệu ${path}.`;
    } catch (error) {
      if (error?.name === "AbortError" || generation !== requestGeneration) return;
      button.disabled = false;
      live.textContent = error?.message || "Không thể tải trang relation tiếp theo.";
      live.setAttribute("role", "alert");
    }
  };
  form.addEventListener("submit", (event) => {
    event.preventDefault();
    run();
  });
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
