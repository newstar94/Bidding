import { trustedHTML } from "../../shared/trustedTypes.js";
import { setRuntimeStyle } from "../../shared/runtimeStyles.js";
import { escapeHtml, initCustomSelect } from "../../shared/view_helpers.js";
import { selectPackageDetailTab } from "./PackageDetailState.js";
import { renderWorkflowActions } from "./WorkflowActions.js";
import { getAppController } from "../../app/controllerRef.js";
import { clearDetailedEvaluationNavigation } from "../detailedEvaluationNavigation.js";

export function renderPackageTabHeaders(container, tabs, activeTab, onSelect) {
  if (!container) return;
  setRuntimeStyle(container, "display", "flex");
  container.innerHTML = trustedHTML((tabs || []).map((tab) => {
    const active = activeTab === tab.id;
    return `<button type="button" role="tab" aria-selected="${active ? "true" : "false"}" class="btn package-workflow-tab ${active ? "active" : ""}" data-workflow-tab="${escapeHtml(tab.id)}"><i data-lucide="${escapeHtml(tab.icon || "circle-dot")}" aria-hidden="true"></i><span>${escapeHtml(tab.label)}</span></button>`;
  }).join(""));
  container.querySelectorAll("[data-workflow-tab]").forEach((button) => {
    button.addEventListener("click", () => onSelect?.(button.getAttribute("data-workflow-tab")));
  });
}

function renderVersionSelector(view, detail) {
  const verSelect = document.getElementById("detail-workflow-version-select");
  if (!verSelect) return;

  verSelect.parentElement
    ?.querySelector('.custom-select-container[data-target="detail-workflow-version-select"]')
    ?.remove();
  document.body
    ?.querySelector('.custom-select-dropdown[data-target="detail-workflow-version-select"]')
    ?.remove();

  setRuntimeStyle(verSelect, "display", "none");
  verSelect.innerHTML = trustedHTML(detail.versions.map((version) => (
    `<option value="${escapeHtml(version.id)}" ${version.selected ? "selected" : ""}>${escapeHtml(version.label)}</option>`
  )).join(""));

  const separator = document.getElementById("detail-workflow-version-separator");
  if (separator) setRuntimeStyle(separator, "display", "inline-block");
  setRuntimeStyle(verSelect, "display", "inline-block");
  verSelect.disabled = detail.versions.length < 2;
  verSelect.onchange = verSelect.disabled
    ? null
    : (event) => view.showPackageDetails(event.target.value, true);
  initCustomSelect("detail-workflow-version-select");
}

export function bindPackageDetailChrome(view, detail) {
  const code = document.getElementById("detail-workflow-code");
  const badge = document.getElementById("detail-workflow-status-badge");
  const title = document.getElementById("detail-workflow-title");
  if (code) code.innerText = detail.pkg.maGoiThau || "Gói thầu";
  if (badge) badge.innerHTML = trustedHTML(view.getStatusBadge(detail.effectiveStatus));
  if (title) title.innerText = detail.pkg.tenGoiThau || "Chưa nhập tên";

  const actions = document.getElementById("detail-workflow-actions");
  renderWorkflowActions(actions, {
    canCancel: detail.canCancel,
    onCancel: () => {
      view._currentWorkflowTab = "cancel";
      view.showPackageDetails(detail.packageId);
    },
  });
  renderVersionSelector(view, detail);

  renderPackageTabHeaders(
    document.getElementById("detail-workflow-tabs-header"),
    detail.tabs,
    detail.activeTab,
    async (tabId) => {
      const appController = getAppController();
      if (appController?.currentEvaluationView === "contractor-detail") {
        appController.currentEvaluationView = "summary";
        appController._detailedEvaluationDirty = false;
        clearDetailedEvaluationNavigation();
      }
      view._inPlaceEditMode = false;
      view._biddingInfoEditMode = false;
      const packageId = selectPackageDetailTab(view, tabId, detail.pkg, view.model);
      await view.showPackageDetails(packageId);
    },
  );
}
