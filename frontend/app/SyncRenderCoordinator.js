import { packageWorkspaceFor } from "../packages/detail/PackageWorkspaceState.js";
import {
  captureWorkspace,
  workspaceIsCurrent,
} from "./SyncWorkspaceContext.js";

const DASHBOARD_SUMMARY_KEYS = new Set([
  "kehoach", "goithau", "chudautu", "nhathau", "chuyengia", "hopdong", "assignments"
]);

const DELETE_ENTITY_LABELS = Object.freeze({
  kehoach: "kế hoạch",
  goithau: "gói thầu",
  goithauhanghoa: "danh mục hàng hóa",
  hanghoaduthaunhathau: "hàng hóa dự thầu",
  chudautu: "chủ đầu tư",
  nhathau: "nhà thầu",
  chuyengia: "chuyên gia",
  hopdong: "hợp đồng",
  assignments: "phân công",
  thongtinmothau: "thông tin mở thầu",
  customcontractstatuses: "trạng thái hợp đồng"
});

export function collectCommittedMutationKeys(payload = {}) {
  const mutationKeys = Object.keys(payload).filter((key) => ![
    "clientMutationId",
    "baseSyncVersion",
    "deletions",
    "includeDashboardSummary"
  ].includes(key));
  return new Set([
    ...mutationKeys,
    ...(payload.deletions || []).map((item) => item?.table).filter(Boolean)
  ]);
}

export function mutationAffectsDashboard(payload = {}) {
  return [...collectCommittedMutationKeys(payload)]
    .some((key) => DASHBOARD_SUMMARY_KEYS.has(key));
}

export function applyDashboardSummaryAfterMutation(model, payload = {}, responseData = {}) {
  if (!model || !mutationAffectsDashboard(payload)) return false;
  model.dashboardSummary = responseData.dashboardSummary && responseData.dashboardSummary.counts
    ? responseData.dashboardSummary
    : null;
  return true;
}

export function selectPostCommitRenderKeys(committedKeys, {
  hasDeletions = false,
  serverStateChanged = false
} = {}) {
  if (hasDeletions || serverStateChanged) return new Set(committedKeys || []);
  return new Set(
    [...(committedKeys || [])].filter((key) => key === "dashboardSummary")
  );
}

export function shouldRefreshRouteAfterBackgroundSync(
  root = globalThis.document,
  controller = null,
) {
  if (root?.querySelector?.(".modal-overlay.active:not(#modal-custom-dialog)")) return false;
  if (controller?.view && packageWorkspaceFor(controller.view).isDirty()) return false;
  return true;
}

export function renderChangedState(controller, changedKeys, { isBackground = false } = {}) {
  if (!changedKeys || changedKeys.size === 0 || !controller.view) return Promise.resolve();
  const renderPromises = [];
  const activeTab = String(controller.model?.state?.activetab || "");
  controller._dirtyRouteProjections ||= new Set();
  const renderIfChanged = (keys, renderFn, routeNames, requiredElementId = null) => {
    if (!keys.some((key) => changedKeys.has(key)) || typeof renderFn !== "function") return;
    const routes = Array.isArray(routeNames) ? routeNames : [routeNames];
    if (!routes.includes(activeTab)) {
      routes.filter(Boolean).forEach((route) => controller._dirtyRouteProjections.add(route));
      return;
    }
    if (!requiredElementId || document.getElementById(requiredElementId)) {
      const renderPromise = Promise.resolve(renderFn.call(controller.view)).catch((err) => {
        console.error(`Failed to render changed state${requiredElementId ? ` for ${requiredElementId}` : ""}:`, err);
      });
      renderPromises.push(renderPromise);
      routes.forEach((route) => controller._dirtyRouteProjections.delete(route));
    }
  };
  renderIfChanged(["dashboardSummary", "kehoach", "goithau", "chudautu", "nhathau", "chuyengia", "hopdong", "assignments", "thongtinmothau"], controller.view.renderDashboard, ["dashboard", "superadmin-dashboard"], "tab-dashboard");
  renderIfChanged(["kehoach", "chudautu", "goithau"], controller.view.renderKeHoachTable, "kehoach", "tab-kehoach");
  renderIfChanged(["goithau", "goithauhanghoa", "hanghoaduthaunhathau", "kehoach", "chudautu", "nhathau", "thongtinmothau", "assignments"], controller.view.renderGoiThauTable, "goithau", "tab-goithau");
  renderIfChanged(["goithau", "kehoach", "hopdong", "thongtinmothau"], controller.view.renderPackageTimeline, "goithau-timeline", "tab-goithau-timeline");
  renderIfChanged(["chudautu", "kehoach"], controller.view.renderChuDauTuTable, "chudautu", "tab-chudautu");
  renderIfChanged(["nhathau", "goithau", "hopdong", "thongtinmothau"], controller.view.renderNhaThauTable, "nhathau", "tab-nhathau");
  renderIfChanged(["chuyengia", "assignments"], controller.view.renderChuyenGiaTable, "chuyengia", "tab-chuyengia");
  renderIfChanged(["hopdong", "goithau", "nhathau", "chudautu"], controller.view.renderHopDongTable, "hopdong", "tab-hopdong");
  if (isBackground) {
    const workspace = captureWorkspace(controller);
    const hasWorkspaceCapability = Boolean(workspace.token || workspace.organizationId);
    requestAnimationFrame(() => {
      if (hasWorkspaceCapability && !workspaceIsCurrent(controller, workspace)) return;
      if (!shouldRefreshRouteAfterBackgroundSync(document, controller)) return;
      const detailTabs = new Set([
        "kehoach-detail",
        "goithau-detail",
        "hopdong-detail",
        "chudautu-detail",
        "nhathau-detail",
        "mothau",
        "danhgiahsdt"
      ]);
      const currentActiveTab = controller.model?.state?.activetab;
      if (!detailTabs.has(currentActiveTab)) return;
      controller.renderTabData?.(
        currentActiveTab,
        controller.model?.state?.activeaction || null,
        { isBackground: true },
      );
    });
  }
  return Promise.all(renderPromises);
}

export function deleteSuccessMessage(payload = {}, deleteImpacts = []) {
  const deletionKeys = [
    ...(Array.isArray(payload.deletions) ? payload.deletions.map((item) => item?.table) : []),
    ...(Array.isArray(deleteImpacts) ? deleteImpacts.map((item) => item?.table) : [])
  ].filter((key) => DELETE_ENTITY_LABELS[key]);
  const labels = [...new Set(deletionKeys.map((key) => DELETE_ENTITY_LABELS[key]))];
  if (labels.length === 0) return "Xóa thành công.";
  return `Xóa ${labels[0]} thành công.`;
}
