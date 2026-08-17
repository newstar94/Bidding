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
  const lotActions = view.getActiveElement("danhgiahsdt-lot-actions");
  const selectAllLotsButton = view.getActiveElement("danhgiahsdt-select-all-lots");
  const clearAllLotsButton = view.getActiveElement("danhgiahsdt-clear-all-lots");
  const options = view.getActiveElement("danhgiahsdt-lot-options");
  const feedback = view.getActiveElement("danhgiahsdt-scope-feedback");
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
  const isSelectedMode = scope.mode === EVALUATION_LOT_SCOPE_MODE.SELECTED;
  if (options) {
    options.classList.toggle("is-hidden", !isSelectedMode);
    setRuntimeStyle(options, "display", isSelectedMode ? "grid" : "none");
    if (isSelectedMode) {
      options.innerHTML = trustedHTML(lots.map((lot) => {
        const disabled = isLocked;
        return `
          <label class="evaluation-lot-option ${disabled ? "is-disabled" : ""}">
            <input type="checkbox" data-evaluation-lot-id="${escapeHtml(lot.id)}"
              ${selectedSet.has(lot.id) ? "checked" : ""} ${disabled ? "disabled" : ""}>
            <span><strong>${escapeHtml(lot.code)}</strong><small title="${escapeHtml(lot.name)}">${escapeHtml(lot.name || "Chưa có tên phần lô")}</small></span>
          </label>`;
      }).join(""));
    } else {
      options.replaceChildren();
    }
  }

  const details = getEvaluationLotScopeDetails(pkg, scope);
  const isPartialScope = isPartialEvaluationLotScope(details);
  if (lotActions) {
    lotActions.classList.toggle("is-hidden", !isSelectedMode);
    setRuntimeStyle(lotActions, "display", isSelectedMode ? "flex" : "none");
  }
  if (selectAllLotsButton) {
    selectAllLotsButton.disabled = !isSelectedMode || isLocked || details?.lotIds?.length === lots.length;
    selectAllLotsButton.setAttribute("aria-disabled", selectAllLotsButton.disabled ? "true" : "false");
  }
  if (clearAllLotsButton) {
    clearAllLotsButton.disabled = !isSelectedMode || isLocked || !details?.lotIds?.length;
    clearAllLotsButton.setAttribute("aria-disabled", clearAllLotsButton.disabled ? "true" : "false");
  }
  if (feedback) {
    const hasSelection = Boolean(details?.lotIds?.length);
    feedback.classList.toggle("is-hidden", !isSelectedMode);
    setRuntimeStyle(feedback, "display", isSelectedMode ? "block" : "none");
    feedback.textContent = !isSelectedMode ? "" : hasSelection
      ? `${details.lotIds.length}/${lots.length} phần lô còn lại sẽ được đưa vào báo cáo chính thức của đợt này.${isPartialScope ? " Nhập/xuất Excel chỉ áp dụng cho các phần lô đang chọn." : ""}`
      : "Vui lòng chọn ít nhất một phần lô trước khi lưu đánh giá.";
    feedback.classList.toggle("is-error", isSelectedMode && !hasSelection);
  }
  if (title) {
    title.textContent = "Đánh giá E-HSDT";
  }
  [
    view.getActiveElement("btn-danhgiahsdt-download-excel"),
    view.getActiveElement("btn-danhgiahsdt-import-excel"),
  ].filter(Boolean).forEach((button) => {
    const disabled = !details?.lotIds?.length;
    button.disabled = disabled;
    button.setAttribute("aria-disabled", disabled ? "true" : "false");
    button.title = disabled ? "Vui lòng chọn ít nhất một phần lô." : "";
  });

  const applyMode = (mode) => {
    onChange(updateEvaluationLotScope(scope, lots, { mode }));
  };
  if (allRadio) allRadio.onchange = () => applyMode(EVALUATION_LOT_SCOPE_MODE.ALL);
  if (selectedRadio) {
    selectedRadio.onchange = () => applyMode(EVALUATION_LOT_SCOPE_MODE.SELECTED);
  }
  if (selectAllLotsButton) {
    selectAllLotsButton.onclick = () => {
      if (!isSelectedMode || isLocked) return;
      onChange(updateEvaluationLotScope(scope, lots, {
        mode: EVALUATION_LOT_SCOPE_MODE.SELECTED,
        selectedLotIds: lots.map((lot) => lot.id),
      }));
    };
  }
  if (clearAllLotsButton) {
    clearAllLotsButton.onclick = () => {
      if (!isSelectedMode || isLocked) return;
      onChange(updateEvaluationLotScope(scope, lots, {
        mode: EVALUATION_LOT_SCOPE_MODE.SELECTED,
        selectedLotIds: [],
      }));
    };
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
