import { setRuntimeStyle } from "../shared/runtimeStyles.js";
import { trustedHTML } from "../shared/trustedTypes.js";
import { escapeHtml } from "../shared/view_helpers.js";
import {
  EVALUATION_LOT_SCOPE_MODE,
  getEvaluationLotScopeDetails,
  getPackageEvaluationLots,
  isPartialEvaluationLotScope,
  updateEvaluationLotScope,
} from "./lotEvaluationScope.js";

export function renderBidEvaluationLotScope({
  view,
  pkg,
  scope,
  isLocked = false,
  onChange = () => {},
} = {}) {
  if (!view?.getActiveElement || !pkg) {
    throw new TypeError("Bid evaluation lot scope received an invalid context.");
  }
  const container = view.getActiveElement("danhgiahsdt-scope-container");
  const options = view.getActiveElement("danhgiahsdt-lot-options");
  const feedback = view.getActiveElement("danhgiahsdt-scope-feedback");
  const badge = view.getActiveElement("danhgiahsdt-scope-badge");
  const title = view.getActiveElement("danhgiahsdt-table-title");
  const allLots = getPackageEvaluationLots(pkg);
  const availableSet = new Set(scope?.availableLotIds || []);
  const lots = availableSet.size
    ? allLots.filter((lot) => availableSet.has(lot.id))
    : allLots;
  if (!container || lots.length === 0 || !scope) {
    if (container) {
      container.classList.add("is-hidden");
      setRuntimeStyle(container, "display", "none");
    }
    return null;
  }

  container.classList.remove("is-hidden");
  setRuntimeStyle(container, "display", "block");
  const allRadio = container.querySelector(
    'input[name="danhgiahsdt-scope-mode"][value="all"]',
  );
  const selectedRadio = container.querySelector(
    'input[name="danhgiahsdt-scope-mode"][value="selected"]',
  );
  if (allRadio) {
    allRadio.checked = scope.mode !== EVALUATION_LOT_SCOPE_MODE.SELECTED;
    allRadio.disabled = isLocked;
  }
  if (selectedRadio) {
    selectedRadio.checked = scope.mode === EVALUATION_LOT_SCOPE_MODE.SELECTED;
    selectedRadio.disabled = isLocked;
  }

  const selectedSet = new Set(scope.selectedLotIds || []);
  if (options) {
    options.innerHTML = trustedHTML(lots.map((lot) => {
      const disabled = scope.mode !== EVALUATION_LOT_SCOPE_MODE.SELECTED || isLocked;
      return `
        <label class="evaluation-lot-option ${disabled ? "is-disabled" : ""}">
          <input type="checkbox" data-evaluation-lot-id="${escapeHtml(lot.id)}"
            ${selectedSet.has(lot.id) ? "checked" : ""} ${disabled ? "disabled" : ""}>
          <span><strong>${escapeHtml(lot.code)}</strong><small title="${escapeHtml(lot.name)}">${escapeHtml(lot.name || "Chưa có tên phần lô")}</small></span>
        </label>`;
    }).join(""));
  }

  const details = getEvaluationLotScopeDetails(pkg, scope);
  const isPartialScope = isPartialEvaluationLotScope(details);
  const selectedLabel = details?.lotCodes?.join(", ") || "chưa chọn phần lô";
  if (badge) {
    badge.textContent = scope.batchId
      ? `Đợt ${selectedLabel}`
      : `Phạm vi: ${selectedLabel}`;
  }
  if (feedback) {
    const hasSelection = Boolean(details?.lotIds?.length);
    feedback.textContent = hasSelection
      ? `${details.lotIds.length}/${lots.length} phần lô còn lại sẽ được đưa vào báo cáo chính thức của đợt này.${isPartialScope ? " Nhập/xuất Excel sẽ được mở sau khi có tệp phạm vi theo đợt." : ""}`
      : "Vui lòng chọn ít nhất một phần lô trước khi lưu đánh giá.";
    feedback.classList.toggle("is-error", !hasSelection);
  }
  if (title) {
    title.textContent = `Đánh giá E-HSDT — ${selectedLabel}`;
  }
  [
    view.getActiveElement("btn-danhgiahsdt-download-excel"),
    view.getActiveElement("btn-danhgiahsdt-import-excel"),
  ].filter(Boolean).forEach((button) => {
    button.disabled = isPartialScope;
    button.setAttribute("aria-disabled", isPartialScope ? "true" : "false");
    button.title = isPartialScope
      ? "Chưa hỗ trợ Excel cho phạm vi một phần lô vì tệp hiện tại không có dấu phạm vi đợt."
      : "";
  });

  const applyMode = (mode) => {
    onChange(updateEvaluationLotScope(scope, lots, { mode }));
  };
  if (allRadio) allRadio.onchange = () => applyMode(EVALUATION_LOT_SCOPE_MODE.ALL);
  if (selectedRadio) {
    selectedRadio.onchange = () => applyMode(EVALUATION_LOT_SCOPE_MODE.SELECTED);
  }
  options?.querySelectorAll("[data-evaluation-lot-id]").forEach((checkbox) => {
    checkbox.onchange = () => {
      const selectedLotIds = Array.from(
        options.querySelectorAll("[data-evaluation-lot-id]:checked"),
      ).map((item) => item.getAttribute("data-evaluation-lot-id"));
      onChange(updateEvaluationLotScope(scope, lots, {
        mode: EVALUATION_LOT_SCOPE_MODE.SELECTED,
        selectedLotIds,
      }));
    };
  });
  return { lots, details, isPartialScope };
}
