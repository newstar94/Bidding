import { resolvePackageResultStatus } from "../lotEvaluationScope.js";
import { resolvePackageDetailState } from "./PackageDetailState.js";
import { buildPackageTabs } from "./PackageTabs.js";
import { getVersionLabel } from "../../shared/formatters.js";

function numericVersion(value) {
  const version = Number.parseInt(value, 10);
  return Number.isFinite(version) ? version : 0;
}

function findPackage(model, packageId) {
  return (model?.state?.goithau || []).find(
    (pkg) => String(pkg?.id || "") === String(packageId || ""),
  ) || null;
}

function resolveRequestedPackage(model, packageId, switchingVersion) {
  const requested = findPackage(model, packageId);
  if (switchingVersion) return requested;
  const latest = typeof model?.getLatestPackage === "function"
    ? model.getLatestPackage(packageId)
    : null;
  return latest || requested;
}

function planVersion(model, pkg) {
  const plan = (model?.state?.kehoach || []).find(
    (candidate) => String(candidate?.id || "") === String(pkg?.keHoachId || ""),
  ) || (typeof model?.getLatestPlan === "function"
    ? model.getLatestPlan(pkg?.keHoachId)
    : null);
  return numericVersion(plan?.phienBan);
}

function buildVersionOptions(model, pkg, planSnapshotId = "") {
  const rootId = String(pkg?.rootId || pkg?.id || "");
  const selectedVersion = String(pkg?.phienBan || "00");
  const selectedByVersion = new Map();

  (model?.state?.goithau || [])
    .filter((candidate) => (
      String(candidate?.rootId || candidate?.id || "") === rootId
      && (
        !planSnapshotId
        || String(candidate?.keHoachId || "") === String(planSnapshotId)
      )
    ))
    .forEach((candidate) => {
      const version = String(candidate?.phienBan || "00");
      const current = selectedByVersion.get(version);
      if (!current || planVersion(model, candidate) > planVersion(model, current)) {
        selectedByVersion.set(version, candidate);
      }
    });

  return [...selectedByVersion.values()]
    .sort((left, right) => (
      numericVersion(left?.phienBan) - numericVersion(right?.phienBan)
      || String(left?.phienBan || "").localeCompare(String(right?.phienBan || ""))
    ))
    .map((candidate) => ({
      id: candidate.id,
      label: getVersionLabel(candidate.phienBan),
      selected: String(candidate.phienBan || "00") === selectedVersion,
    }));
}

export function buildPackageDetailViewModel({
  model,
  packageId,
  switchingVersion = false,
  planSnapshotId = "",
  currentPackageId = "",
  currentTab = "",
  editingBatchId = "",
  editingWholePackage = false,
  editingWholePackageId = "",
} = {}) {
  const pkg = resolveRequestedPackage(model, packageId, switchingVersion);
  if (!pkg) return null;

  const bids = (model?.state?.thongtinmothau || []).filter(
    (bid) => String(bid?.goiThauId || "") === String(pkg.id),
  );
  const workflow = buildPackageTabs(pkg, bids, { currentTab });
  const detailState = resolvePackageDetailState({
    tabs: workflow.tabs,
    currentTab,
    currentPackageId,
    packageId: pkg.id,
  });
  const isTwoEnvelope = pkg.phuongThucLuaChon === "Một giai đoạn hai túi hồ sơ";
  const latestPlan = typeof model?.getLatestPlan === "function"
    ? model.getLatestPlan(pkg.keHoachId)
    : null;
  const latestPackage = typeof model?.getLatestPackage === "function"
    ? model.getLatestPackage(pkg.id)
    : pkg;
  const effectiveStatus = resolvePackageResultStatus(pkg, {
    editingBatchId,
    editingWholePackage: editingWholePackage === true
      && (!editingWholePackageId || String(editingWholePackageId) === String(pkg.id)),
  });

  return {
    packageId: pkg.id,
    pkg,
    bids,
    workflow,
    tabs: workflow.tabs,
    activeTab: detailState.activeTab,
    effectiveStatus,
    isTwoEnvelope,
    isPlanLatest: Boolean(latestPlan && String(latestPlan.id) === String(pkg.keHoachId)),
    isPackageLatest: Boolean(latestPackage && String(latestPackage.id) === String(pkg.id)),
    isEditable: Boolean(
      latestPackage
      && String(latestPackage.id) === String(pkg.id)
      && pkg.trangThai !== "Hủy thầu"
    ),
    planSnapshotId: String(planSnapshotId || ""),
    canCancel: !["Chuẩn bị", "Đang mời thầu", "Đã mở thầu", "Hủy thầu"].includes(effectiveStatus),
    inviteComparisonLabel: isTwoEnvelope
      ? "Ngày mời đối chiếu tài liệu/Thương thảo"
      : "Ngày mời đối chiếu tài liệu",
    comparisonLabel: isTwoEnvelope
      ? "Ngày đối chiếu tài liệu/Thương thảo"
      : "Ngày đối chiếu tài liệu",
    versions: buildVersionOptions(model, pkg, planSnapshotId),
  };
}
