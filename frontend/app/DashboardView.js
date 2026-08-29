import { trustedHTML } from "../shared/trustedTypes.js";
import { loadStyleOnce } from "../shared/externalAssets.js";
import { setRuntimeStyle } from "../shared/runtimeStyles.js";
import { escapeHtml, safeAttr, renderEmptyRow } from "../shared/view_helpers.js";
import { normalizeOrganizations } from "../auth/accessContext.js";
import { apiFetch } from "../shared/apiClient.js";
import { isTrialFullAccess } from "../commercial-policy/trialMode.js";
import { getHolidays } from "../shared/runtimeState.js";
import { resolvePackageResultStatus } from "../packages/lotEvaluationScope.js";
import {
  paginateOwnedTable,
  renderTablePagination,
  setTablePage,
} from "../shared/TablePagination.js";
import {
  CONTRACT_STATUS_COLORS,
  PACKAGE_STATUS_COLORS,
  PLAN_STATUS_COLORS,
  STATUS_COLORS,
  resolveContractStatusColor,
} from "../shared/statusPresentation.js";

export const DASHBOARD_STATUS_COLORS = STATUS_COLORS;
const DASHBOARD_STYLESHEET_URL = new URL(
  "./DashboardView.css?no-inline",
  import.meta.url,
).pathname;

export function ensureDashboardStyles() {
  return loadStyleOnce(DASHBOARD_STYLESHEET_URL);
}
export { CONTRACT_STATUS_COLORS, PACKAGE_STATUS_COLORS, PLAN_STATUS_COLORS };
const PACKAGE_STATUS_ORDER = Object.keys(PACKAGE_STATUS_COLORS);
const PLAN_STATUS_ORDER = ["Chưa triển khai", "Đang thực hiện", "Hoàn thành"];
const CONTRACT_STATUS_ORDER = Object.keys(CONTRACT_STATUS_COLORS);
const CONTRACT_EXPIRY_WARNING_DAYS = 10;
export const ALERT_META = {
  closingToday: { label: "Đóng thầu hôm nay", detail: "Chưa chuyển sang đã mở thầu", icon: "calendar-clock", tone: "blue" },
  closingSoon: { label: "Sắp đóng thầu", detail: "Trong 7 ngày tới", icon: "clock-3", tone: "amber" },
  overdueOpening: { label: "Quá hạn mở thầu", detail: "Đã qua ngày đóng thầu", icon: "circle-alert", tone: "red" },
  delayedEvaluation: { label: "Chậm báo cáo đánh giá", detail: "Quá 7 ngày sau mở thầu", icon: "file-warning", tone: "violet" },
  contractExpired: { label: "Hợp đồng đã hết hạn", detail: "Chưa hoàn tất nghĩa vụ hợp đồng", icon: "file-warning", tone: "red" },
  contractExpiring: { label: "Hợp đồng sắp hết hạn", detail: `Trong ${CONTRACT_EXPIRY_WARNING_DAYS} ngày tới`, icon: "file-clock", tone: "amber" },
  planPublishingWarning: { label: "Cần đăng tải kế hoạch", detail: "Đã qua 3 ngày làm việc", icon: "megaphone", tone: "amber" },
  planPublishingOverdue: { label: "Quá hạn đăng kế hoạch", detail: "Đã quá 5 ngày làm việc", icon: "circle-alert", tone: "red" }
};
const ALERT_PRIORITY = ["overdueOpening", "contractExpired", "planPublishingOverdue", "closingToday", "delayedEvaluation", "contractExpiring", "planPublishingWarning", "closingSoon"];
const DASHBOARD_ROLE_CONTEXT = Object.freeze({
  manager: Object.freeze({
    alertsKicker: "Cần xử lý hôm nay",
    alertsTitle: "Cảnh báo toàn đơn vị",
    priorityTitle: "Việc cần điều phối",
    recentTitle: "Gói thầu của đơn vị mới cập nhật",
    overviewKicker: "Toàn đơn vị",
    overviewTitle: "Quy mô và trạng thái nghiệp vụ",
    overviewDescription: "Trạng thái kế hoạch được tổng hợp từ tiến độ các gói thầu thuộc phạm vi đơn vị."
  }),
  employee: Object.freeze({
    alertsKicker: "Cần xử lý hôm nay",
    alertsTitle: "Cảnh báo công việc của tôi",
    priorityTitle: "Việc của tôi cần xử lý",
    recentTitle: "Gói thầu được giao mới cập nhật",
    overviewKicker: "Phạm vi được phân công",
    overviewTitle: "Tiến độ công việc của tôi",
    overviewDescription: "Chỉ hiển thị dữ liệu thuộc phạm vi công việc bạn được phép truy cập."
  })
});

export function getDashboardRoleContext(role) {
  return DASHBOARD_ROLE_CONTEXT[role] || DASHBOARD_ROLE_CONTEXT.employee;
}

function setText(id, value) {
  const element = document.getElementById(id);
  if (element) element.textContent = String(value ?? "");
}

function renderDashboardRoleContext(view) {
  const context = getDashboardRoleContext(view?.model?.state?.activerole);
  setText("dashboard-alerts-kicker", context.alertsKicker);
  setText("dashboard-alerts-title", context.alertsTitle);
  setText("dashboard-priority-title", context.priorityTitle);
  setText("dashboard-recent-title", context.recentTitle);
  setText("dashboard-overview-kicker", context.overviewKicker);
  setText("dashboard-overview-title", context.overviewTitle);
  setText("dashboard-overview-description", context.overviewDescription);
}

function normalizeOrderedCounts(incoming, order) {
  const counts = Object.fromEntries(order.map((status) => [status, 0]));
  Object.entries(incoming || {}).forEach(([status, count]) => {
    if (Object.hasOwn(counts, status)) counts[status] = Number(count || 0);
  });
  return counts;
}

export function normalizeDashboardStatusCounts(incoming = {}) {
  const counts = normalizeOrderedCounts({}, PACKAGE_STATUS_ORDER);
  Object.entries(incoming || {}).forEach(([rawStatus, rawCount]) => {
    const status = rawStatus === "Huỷ thầu" ? "Hủy thầu" : rawStatus;
    counts[status] = Number(rawCount || 0);
  });
  return counts;
}

export function derivePackageStatusCounts(packages = []) {
  const counts = normalizeDashboardStatusCounts();
  packages.forEach((pkg) => {
    const resolvedStatus = resolvePackageResultStatus(pkg);
    const status = resolvedStatus === "Huỷ thầu" ? "Hủy thầu" : resolvedStatus;
    if (Object.hasOwn(counts, status)) counts[status]++;
  });
  return counts;
}

export function normalizeContractStatusCounts(incoming = {}, order = CONTRACT_STATUS_ORDER) {
  const normalized = normalizeOrderedCounts({}, order);
  Object.entries(incoming || {}).forEach(([rawStatus, rawCount]) => {
    const status = rawStatus;
    normalized[status] = Number(rawCount || 0);
  });
  return normalized;
}

export function getContractStatusCatalog(model) {
  const configured = Array.isArray(model?.state?.customcontractstatuses)
    ? model.state.customcontractstatuses
    : [];
  const withFallbackColor = (status) => {
    const name = String(status?.name || "").trim();
    return {
      ...status,
      name,
      color: resolveContractStatusColor(name, configured),
    };
  };
  if (configured.length) return configured.map(withFallbackColor);
  return CONTRACT_STATUS_ORDER.map((name) => withFallbackColor({ name }));
}

export function derivePlanStatusCounts(plans = [], packages = []) {
  const result = normalizeOrderedCounts({}, PLAN_STATUS_ORDER);
  const packagesByPlan = new Map();
  packages.forEach((pkg) => {
    const planId = String(pkg.keHoachId || pkg.ke_hoach_id || "");
    if (!packagesByPlan.has(planId)) packagesByPlan.set(planId, []);
    packagesByPlan.get(planId).push(pkg);
  });
  plans.forEach((plan) => {
    const planPackages = packagesByPlan.get(String(plan.id || "")) || [];
    const statuses = planPackages.map((pkg) => resolvePackageResultStatus(pkg) || "Chuẩn bị");
    if (!statuses.length || statuses.every((status) => status === "Chuẩn bị")) {
      result["Chưa triển khai"]++;
    } else if (statuses.some((status) => !["Đã có kết quả", "Hủy thầu", "Huỷ thầu"].includes(status))) {
      result["Đang thực hiện"]++;
    } else {
      result["Hoàn thành"]++;
    }
  });
  return result;
}

function parseDashboardDate(value) {
  const text = String(value || "").trim();
  if (!text) return null;
  const dmy = text.match(/^(\d{2})\/(\d{2})\/(\d{4})(?:\s+(\d{2}):(\d{2}))?/);
  const parsed = dmy
    ? new Date(Number(dmy[3]), Number(dmy[2]) - 1, Number(dmy[1]), Number(dmy[4] || 0), Number(dmy[5] || 0))
    : new Date(text.includes("T") ? text : text.replace(" ", "T"));
  return Number.isNaN(parsed.getTime()) ? null : parsed;
}

function packageHasEvaluationReport(pkg) {
  const metadata = pkg.danhGiaHsdtMetadata || pkg.danh_gia_hsdt_metadata || {};
  return Object.values(metadata || {}).some((round) => round && (
    round.soBaoCao || round.ngayBaoCao || round.saved || round.trangThai === "completed" || round.trangThai === "approved"
  ));
}

export function deriveDashboardAlerts(packages = [], now = new Date(), delayDays = 7) {
  const counts = Object.fromEntries(Object.keys(ALERT_META).map((key) => [key, 0]));
  const items = [];
  const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  const tomorrow = new Date(today); tomorrow.setDate(tomorrow.getDate() + 1);
  const soonLimit = new Date(now); soonLimit.setDate(soonLimit.getDate() + 7);
  const evaluationLimit = new Date(now); evaluationLimit.setDate(evaluationLimit.getDate() - delayDays);
  packages.forEach((pkg) => {
    const status = resolvePackageResultStatus(pkg) || "Chuẩn bị";
    const closing = parseDashboardDate(pkg.thoiGianDongThau);
    const opening = parseDashboardDate(pkg.thoiGianMoThau || pkg.thoiGianDongThau);
    let alertKey = "";
    if (status === "Đang mời thầu" && closing) {
      if (closing >= today && closing < tomorrow) alertKey = "closingToday";
      else if (closing < today) alertKey = "overdueOpening";
      else if (closing <= soonLimit) alertKey = "closingSoon";
    }
    if (["Đã mở thầu", "Đang chấm thầu"].includes(status) && opening && opening <= evaluationLimit && !packageHasEvaluationReport(pkg)) {
      alertKey = "delayedEvaluation";
    }
    if (!alertKey) return;
    counts[alertKey]++;
    items.push({ ...pkg, alertKey, deadline: alertKey === "delayedEvaluation" ? pkg.thoiGianMoThau : pkg.thoiGianDongThau });
  });
  items.sort((a, b) => ALERT_PRIORITY.indexOf(a.alertKey) - ALERT_PRIORITY.indexOf(b.alertKey));
  return { counts, items };
}

function dashboardIsoDate(date) {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

function isDashboardWorkingDay(date, holidaysData) {
  const iso = dashboardIsoDate(date);
  const yearConfig = holidaysData?.[String(date.getFullYear())] || {};
  if ((yearConfig.working_weekends || []).includes(iso)) return true;
  if (date.getDay() === 0 || date.getDay() === 6) return false;
  return !(yearConfig.holidays || []).includes(iso);
}

function businessDaysElapsed(startDate, endDate, holidaysData) {
  if (!startDate || !endDate || endDate <= startDate) return 0;
  const current = new Date(startDate.getFullYear(), startDate.getMonth(), startDate.getDate() + 1);
  const limit = new Date(endDate.getFullYear(), endDate.getMonth(), endDate.getDate());
  let total = 0;
  while (current <= limit) {
    if (isDashboardWorkingDay(current, holidaysData)) total++;
    current.setDate(current.getDate() + 1);
  }
  return total;
}

function addBusinessDays(startDate, days, holidaysData) {
  const current = new Date(startDate);
  let added = 0;
  while (added < days) {
    current.setDate(current.getDate() + 1);
    if (isDashboardWorkingDay(current, holidaysData)) added++;
  }
  return current;
}

export function derivePlanPublishingAlerts(plans = [], now = new Date(), holidaysData = getHolidays()) {
  const counts = { planPublishingWarning: 0, planPublishingOverdue: 0 };
  const items = [];
  plans.forEach((plan) => {
    if (String(plan.thoiGianDangMa || plan.thoiGianDangTai || "").trim()) return;
    const approval = parseDashboardDate(plan.ngayPheDuyet);
    if (!approval) return;
    const elapsed = businessDaysElapsed(approval, now, holidaysData);
    if (elapsed < 3) return;
    const alertKey = elapsed > 5 ? "planPublishingOverdue" : "planPublishingWarning";
    counts[alertKey]++;
    items.push({
      targetType: "plan",
      id: plan.id,
      maKeHoach: plan.maKeHoach || plan.maKehoach || "",
      tenKeHoach: plan.tenKeHoach || "Kế hoạch LCNT",
      ngayPheDuyet: plan.ngayPheDuyet,
      deadline: addBusinessDays(approval, 5, holidaysData).toISOString(),
      workdaysElapsed: elapsed,
      alertKey
    });
  });
  return { counts, items };
}

function normalizedDashboardSearchText(value) {
  return String(value || "")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/đ/g, "d")
    .replace(/Đ/g, "D")
    .toLowerCase();
}

function addContractDuration(startDate, rawDuration) {
  const normalized = normalizedDashboardSearchText(rawDuration);
  const amountMatch = normalized.match(/\d+(?:[.,]\d+)?/);
  const amount = Math.trunc(Number(String(amountMatch?.[0] || "").replace(",", ".")));
  if (!Number.isFinite(amount) || amount <= 0) return null;
  const result = new Date(startDate);
  if (normalized.includes("thang")) {
    const originalDay = result.getDate();
    result.setDate(1);
    result.setMonth(result.getMonth() + amount);
    const lastDay = new Date(result.getFullYear(), result.getMonth() + 1, 0).getDate();
    result.setDate(Math.min(originalDay, lastDay));
  } else if (normalized.includes("nam")) {
    const originalMonth = result.getMonth();
    result.setFullYear(result.getFullYear() + amount);
    if (result.getMonth() !== originalMonth) result.setDate(0);
  } else {
    const days = normalized.includes("tuan") ? amount * 7 : amount;
    result.setDate(result.getDate() + days);
  }
  return result;
}

export function deriveContractExpiryAlerts(contracts = [], now = new Date(), warningDays = CONTRACT_EXPIRY_WARNING_DAYS) {
  const counts = { contractExpired: 0, contractExpiring: 0 };
  const items = [];
  const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  const warningLimit = new Date(today);
  warningLimit.setDate(warningLimit.getDate() + warningDays);
  contracts.forEach((contract) => {
    if (String(contract.ngayThanhLy || "").trim()) return;
    const signedAt = parseDashboardDate(contract.ngayKy);
    const signedDate = signedAt ? new Date(signedAt.getFullYear(), signedAt.getMonth(), signedAt.getDate()) : null;
    const deadline = signedDate ? addContractDuration(signedDate, contract.soNgayThucHien || contract.thoiGianThucHien) : null;
    if (!deadline || deadline > warningLimit) return;
    const alertKey = deadline < today ? "contractExpired" : "contractExpiring";
    const missingSteps = ["Chưa thanh lý"];
    counts[alertKey]++;
    items.push({
      ...contract,
      targetType: "contract",
      alertKey,
      deadline: deadline.toISOString(),
      alertDetail: missingSteps.join(" · ")
    });
  });
  return { counts, items };
}

function dashboardAlertRank(item) {
  const index = ALERT_PRIORITY.indexOf(item?.alertKey);
  return index < 0 ? ALERT_PRIORITY.length : index;
}

export function selectDashboardActionItems(items = [], limit = Number.POSITIVE_INFINITY) {
  const sorted = [...items].sort((a, b) => dashboardAlertRank(a) - dashboardAlertRank(b)
    || String(a.deadline || "").localeCompare(String(b.deadline || "")));
  const selected = [];
  ["contract", "plan", "package"].forEach((targetType) => {
    const item = sorted.find((candidate) => candidate.targetType === targetType);
    if (item) selected.push(item);
  });
  sorted.forEach((item) => {
    if (selected.length < limit && !selected.includes(item)) selected.push(item);
  });
  return selected.sort((a, b) => dashboardAlertRank(a) - dashboardAlertRank(b)
    || String(a.deadline || "").localeCompare(String(b.deadline || "")));
}

function compactCurrency(value) {
  const numericValue = Number(value || 0);
  if (!Number.isFinite(numericValue)) return "0 ₫";
  return new Intl.NumberFormat("vi-VN", { notation: "compact", maximumFractionDigits: 1 }).format(numericValue) + " ₫";
}

function formatDashboardDate(value) {
  const date = parseDashboardDate(value);
  if (!date) return "Chưa xác định";
  return new Intl.DateTimeFormat("vi-VN", { day: "2-digit", month: "2-digit", year: "numeric", hour: "2-digit", minute: "2-digit" }).format(date);
}

function buildLocalDashboardData(view) {
  const model = view.model;
  const packages = model.getFilteredGoiThau();
  const plans = model.getFilteredKeHoach();
  const contracts = model.getFilteredHopDong();
  const contractStatusCatalog = getContractStatusCatalog(model);
  const contractStatusOrder = contractStatusCatalog.map((status) => status.name);
  const packageStatusCounts = derivePackageStatusCounts(packages);
  const contractStatusCounts = normalizeContractStatusCounts({}, contractStatusOrder);
  const contractValues = Object.fromEntries(contractStatusOrder.map((status) => [status, 0]));
  contracts.forEach((contract) => {
    const status = contract.trangThaiHopDong || "Đang thực hiện";
    contractStatusCounts[status] = Number(contractStatusCounts[status] || 0) + 1;
    contractValues[status] = model.sumVND([contractValues[status] || 0, contract.giaTri || 0]);
  });
  const assignedContracts = model.getLatestContracts().filter(
    (contract) => model.isAssigned(model.state.activeuser?.id, contract.id, "hopdong")
  );
  const packageAlerts = deriveDashboardAlerts(packages);
  const planAlerts = derivePlanPublishingAlerts(plans);
  const contractAlerts = deriveContractExpiryAlerts(contracts);
  const alertItems = selectDashboardActionItems([...packageAlerts.items, ...planAlerts.items, ...contractAlerts.items]);
  return {
    counts: {
      kehoach: plans.length,
      goithau: packages.length,
      contractTotal: contracts.length,
      chudautu: model.getLatestChuDauTu().length,
      nhathau: model.getLatestNhaThau().length,
      chuyengia: model.state.chuyengia.length,
      assignedHopdong: assignedContracts.length,
      activeAssignedHopdong: assignedContracts.filter((contract) => (contract.trangThaiHopDong || "Đang thực hiện") === "Đang thực hiện").length
    },
    planStatusCounts: derivePlanStatusCounts(plans, packages),
    packageStatusCounts,
    contractStatusCounts,
    contractValues,
    contractStatusCatalog,
    totalContractValue: model.sumVND(contracts.map((contract) => contract.giaTri || 0)),
    recentPackages: [...packages].reverse().slice(0, 4),
    alerts: {
      counts: { ...packageAlerts.counts, ...planAlerts.counts, ...contractAlerts.counts },
      items: alertItems
    }
  };
}

function buildServerDashboardData(view, summary) {
  const counts = summary.counts || {};
  const contractStatusCatalog = getContractStatusCatalog(view.model);
  const contractStatusOrder = contractStatusCatalog.map((status) => status.name);
  return {
    counts: {
      ...counts,
      contractTotal: Number(summary.contractTotalCount ?? counts.hopdong ?? 0)
    },
    planStatusCounts: normalizeOrderedCounts(summary.planStatusCounts, PLAN_STATUS_ORDER),
    packageStatusCounts: normalizeDashboardStatusCounts(summary.statusCounts),
    contractStatusCounts: normalizeContractStatusCounts(summary.contractStatusCounts, contractStatusOrder),
    contractValues: normalizeContractStatusCounts(summary.contractValueByStatus, contractStatusOrder),
    contractStatusCatalog,
    totalContractValue: summary.totalContractValueAll ?? summary.totalContractValue ?? 0,
    recentPackages: Array.isArray(summary.recentPackages) ? summary.recentPackages : [],
    alerts: {
      counts: { ...Object.fromEntries(Object.keys(ALERT_META).map((key) => [key, 0])), ...(summary.alertCounts || {}) },
      items: Array.isArray(summary.alertItems) ? summary.alertItems : []
    },
    evaluationDelayDays: Number(summary.evaluationDelayDays || 7)
  };
}

export function shouldUseServerDashboardSummary(summary, scopedPackages = []) {
  if (!summary?.counts) return false;
  if (!Array.isArray(scopedPackages) || scopedPackages.length === 0) return true;
  const declaredPackageCount = Number(summary.counts.goithau || 0);
  const statusPackageCount = Object.values(summary.statusCounts || {})
    .reduce((total, count) => total + Number(count || 0), 0);
  const recentPackageCount = Array.isArray(summary.recentPackages)
    ? summary.recentPackages.length
    : 0;
  return declaredPackageCount > 0
    && statusPackageCount > 0
    && recentPackageCount > 0;
}

function renderMetricBreakdown(containerId, counts, colors, formatter = (value) => String(value)) {
  const container = document.getElementById(containerId);
  if (!container) return;
  container.innerHTML = trustedHTML(Object.entries(counts || {}).map(([status, value]) => `
    <div class="dashboard-metric-row">
      <span><i class="dashboard-status-dot" style="background-color: ${colors?.[status] || DASHBOARD_STATUS_COLORS.neutral};"></i>${escapeHtml(status)}</span>
      <strong>${escapeHtml(formatter(value))}</strong>
    </div>
  `).join(""));
}

function renderContractSummary(counts, values, catalog = []) {
  const container = document.getElementById("contract-summary-breakdown");
  if (!container) return;
  const statuses = [...new Set([...Object.keys(counts || {}), ...Object.keys(values || {})])];
  container.innerHTML = trustedHTML(statuses.map((status) => {
    const count = Number(counts?.[status] || 0);
    const formattedValue = compactCurrency(values?.[status] || 0);
    const configuredColor = catalog.find((item) => item?.name === status)?.color;
    const color = /^#[0-9a-fA-F]{6}$/.test(String(configuredColor || "")) ? configuredColor : "#64748B";
    return `
      <div class="dashboard-contract-row" role="group" aria-label="${safeAttr(`${status}: ${count} hợp đồng, ${formattedValue}`)}">
        <span class="dashboard-contract-status"><i class="dashboard-status-dot" style="background-color: ${color};"></i>${escapeHtml(status)}</span>
        <span class="dashboard-contract-values"><strong>${count} HĐ</strong><em>${escapeHtml(formattedValue)}</em></span>
      </div>
    `;
  }).join(""));
}

export function buildPackageStatusChartModel(statusCounts = {}) {
  const total = Object.values(statusCounts).reduce((sum, count) => sum + Number(count || 0), 0);
  let accumulated = 0;
  const items = PACKAGE_STATUS_ORDER.map((status) => {
    const count = Number(statusCounts[status] || 0);
    const percent = total ? count / total * 100 : 0;
    const start = accumulated;
    const end = accumulated + percent;
    if (count > 0) accumulated = end;
    return {
      status,
      count,
      percent,
      color: PACKAGE_STATUS_COLORS[status],
      start,
      end,
    };
  });
  const gradientParts = items
    .filter((item) => item.count > 0)
    .map((item) => `${item.color} ${item.start}% ${item.end}%`);
  return {
    total,
    items,
    gradient: gradientParts.length ? `conic-gradient(${gradientParts.join(", ")})` : "var(--neutral-soft)",
  };
}

function renderPackageDonut(statusCounts) {
  const chartModel = buildPackageStatusChartModel(statusCounts);
  setText("donut-total-count", chartModel.total);
  const legend = document.getElementById("status-legend-list");
  if (legend) {
    legend.innerHTML = trustedHTML(chartModel.items.map((item) => {
      return `<div class="legend-item"><div class="legend-info"><span class="legend-dot" style="background-color: ${item.color};"></span><span>${escapeHtml(item.status)}</span></div><span class="legend-val">${item.count} (${item.percent.toFixed(0)}%)</span></div>`;
    }).join(""));
  }
  const donut = document.querySelector("#tab-dashboard .status-donut-chart");
  if (donut) setRuntimeStyle(donut, "background", chartModel.gradient);
}

function renderDashboardAlerts(alerts) {
  const counts = alerts?.counts || {};
  setText("alert-closing-today", counts.closingToday || 0);
  setText("alert-closing-soon", counts.closingSoon || 0);
  setText("alert-overdue-opening", counts.overdueOpening || 0);
  setText("alert-delayed-evaluation", counts.delayedEvaluation || 0);
  setText("alert-plan-publishing-warning", counts.planPublishingWarning || 0);
  setText("alert-plan-publishing-overdue", counts.planPublishingOverdue || 0);
  const items = alerts?.items || [];
  setText("dashboard-action-count", `${items.length} việc`);
  const tbody = document.getElementById("dashboard-action-items");
  if (!tbody) return;
  if (!items.length) {
    tbody.innerHTML = trustedHTML(renderEmptyRow(3, "Không có công việc khẩn cấp", "circle-check-big"));
    return;
  }
  tbody.innerHTML = trustedHTML(items.map((item) => {
    const meta = ALERT_META[item.alertKey] || ALERT_META.closingSoon;
    const targetType = item.targetType === "plan" ? "plan" : item.targetType === "contract" ? "contract" : "package";
    const targetMeta = {
      plan: { action: "show-plan", label: "Kế hoạch", code: item.maKeHoach, fallbackCode: "Chưa có mã kế hoạch", name: item.tenKeHoach || "Kế hoạch LCNT" },
      contract: { action: "show-contract", label: "Hợp đồng", code: item.soHopDong, fallbackCode: "Chưa có số hợp đồng", name: item.tenHopDong || "Hợp đồng" },
      package: { action: "show-package", label: "Gói thầu", code: item.maGoiThau, fallbackCode: "Chưa có mã gói thầu", name: item.tenGoiThau || "Gói thầu" }
    }[targetType];
    const targetIdentity = targetMeta.code || targetMeta.fallbackCode;
    return `
      <tr class="dashboard-task-row">
        <td class="dashboard-task-object-cell"><a href="#" data-bf-action="${targetMeta.action}" data-id="${safeAttr(item.id)}" class="dashboard-package-cell" aria-label="Mở ${safeAttr(targetMeta.label)} ${safeAttr(targetIdentity)}"><span class="dashboard-object-code">${escapeHtml(targetIdentity)}</span><small title="${safeAttr(targetMeta.name)}">${escapeHtml(targetMeta.name)}</small></a></td>
        <td class="dashboard-task-content-cell"><span class="dashboard-action-label action-${meta.tone}"><i data-lucide="${meta.icon}"></i>${escapeHtml(meta.label)}</span><small class="dashboard-action-detail">${escapeHtml(item.alertDetail || meta.detail)}</small></td>
        <td class="dashboard-task-deadline-cell"><span class="dashboard-deadline deadline-${meta.tone}">${escapeHtml(formatDashboardDate(item.deadline))}</span></td>
      </tr>
    `;
  }).join(""));
}

function renderRecentPackages(view, packages) {
  const tbody = document.querySelector("#recent-packages-table tbody");
  if (!tbody) return;
  if (!packages.length) {
    tbody.innerHTML = trustedHTML(renderEmptyRow(4, "Chưa có gói thầu nào", "inbox"));
    return;
  }
  tbody.innerHTML = trustedHTML(packages.map((pkg) => `
    <tr>
      <td class="dashboard-recent-code-cell"><a href="#" data-bf-action="show-package" data-id="${safeAttr(pkg.id)}" class="dashboard-recent-link dashboard-recent-code">${escapeHtml(pkg.maGoiThau || "")}</a></td>
      <td class="dashboard-recent-name-cell"><a href="#" data-bf-action="show-package" data-id="${safeAttr(pkg.id)}" class="dashboard-recent-link dashboard-recent-name" title="${safeAttr(pkg.tenGoiThau || "")}">${escapeHtml(pkg.tenGoiThau || "")}</a></td>
      <td class="dashboard-recent-price-cell">${view.model.formatCurrency(pkg.giaGoiThau || 0)}</td>
      <td class="dashboard-recent-status-cell">${view.getStatusBadge(resolvePackageResultStatus(pkg))}</td>
    </tr>
  `).join(""));
}

function renderDashboardSnapshot(view, data) {
  const counts = data.counts || {};
  setText("stat-count-kehoach", counts.kehoach || 0);
  setText("stat-count-hopdong", counts.contractTotal || 0);
  setText("stat-total-budget", view.model.formatCurrency(data.totalContractValue || 0));
  setText("stat-count-chudautu", counts.chudautu || 0);
  setText("stat-count-nhathau", counts.nhathau || 0);
  setText("stat-count-chuyengia", counts.chuyengia || 0);
  setText("stat-savings-value", counts.assignedHopdong || 0);
  setText("stat-savings-percent", `${counts.activeAssignedHopdong || 0} đang thực hiện`);
  setText("stat-active-goithau", `${data.packageStatusCounts["Đang mời thầu"] || 0} gói đang mời thầu`);
  if (data.evaluationDelayDays) {
    setText("dashboard-evaluation-rule", `Báo cáo đánh giá được cảnh báo khi quá ${data.evaluationDelayDays} ngày sau mở thầu.`);
  }
  renderMetricBreakdown("plan-status-breakdown", data.planStatusCounts, PLAN_STATUS_COLORS);
  renderContractSummary(data.contractStatusCounts, data.contractValues, data.contractStatusCatalog);
  renderDashboardAlerts(data.alerts);
  renderPackageDonut(data.packageStatusCounts);
  renderRecentPackages(view, data.recentPackages);
}

export function renderDashboard() {
  renderDashboardRoleContext(this);
  const scopedPackages = this.model.useServerSidePagination
    ? this.model.getFilteredGoiThau()
    : [];
  const serverSummary = this.model.useServerSidePagination
    && shouldUseServerDashboardSummary(this.model.dashboardSummary, scopedPackages)
    ? this.model.dashboardSummary
    : null;
  const data = serverSummary?.counts ? buildServerDashboardData(this, serverSummary) : buildLocalDashboardData(this);
  renderDashboardSnapshot(this, data);
  this.createIconsScoped(document.getElementById("tab-dashboard"));
}
export async function renderSuperAdminDashboard() {
  const cachedPackages = Array.isArray(this.model.state.systempackages)
    ? this.model.state.systempackages
    : [];
  let usersResponse;
  let packagesResponse;
  try {
    [usersResponse, packagesResponse] = await Promise.all([
      apiFetch("/api/auth/users"),
      isTrialFullAccess(document)
        ? Promise.resolve({ ok: true, json: async () => cachedPackages })
        : apiFetch("/api/system-packages"),
    ]);
  } catch (error) {
    await this.customAlert?.(
      "Không thể tải bảng điều hành",
      error?.message || "Không thể kết nối máy chủ.",
      "x-circle",
    );
    return false;
  }
  if (!usersResponse?.ok || !packagesResponse?.ok) {
    await this.customAlert?.(
      "Không thể tải bảng điều hành",
      "Dữ liệu quản trị chưa tải đầy đủ. Vui lòng thử lại.",
      "x-circle",
    );
    return false;
  }
  const users = await usersResponse.json();
  let systemPackages = cachedPackages;
  systemPackages = await packagesResponse.json();
  this.model.replaceTableState("systempackages", systemPackages);
  await this.model.persistData?.("systempackages", { trackMutation: false });
  const legalCatalogContainer = document.getElementById("legal-catalog-admin-root");
  if (
    legalCatalogContainer
    && this.model.state.activerole === "super_admin"
    && document.querySelector('meta[name="bf-legal-versioning-enabled"]')?.content === "true"
  ) {
    const { mountLegalCatalogAdmin } = await import("../legal-versioning/LegalCatalogAdmin.js");
    await mountLegalCatalogAdmin(legalCatalogContainer);
  }
  const summary = summarizeSuperAdminOrganizations(users, systemPackages);
    const saStatOrgs = document.getElementById("sad-stat-orgs");
    if (saStatOrgs) saStatOrgs.textContent = `${summary.organizations.length} Đơn vị`;
    const saStatUsers = document.getElementById("sad-stat-users");
    if (saStatUsers) saStatUsers.textContent = `${users.length} Người dùng`;
    const saStatActiveOrgs = document.getElementById("sad-stat-active-orgs");
    if (saStatActiveOrgs) saStatActiveOrgs.textContent = `Đang hoạt động: ${summary.activeCount}`;
    const revenueElement = document.getElementById("sad-stat-revenue");
    if (revenueElement) revenueElement.textContent = this.model.formatCurrency(summary.revenue);
    const packageRate = document.getElementById("sad-stat-packages");
    if (packageRate) packageRate.textContent = `${summary.activationRate}%`;
    ["silver", "gold", "diamond"].forEach((packageId) => {
      const count = summary.packageCounts[packageId] || 0;
      const percent = summary.activeCount > 0 ? Math.round(count / summary.activeCount * 100) : 0;
      const label = document.getElementById(`sad-pkg-${packageId}-percent`);
      if (label) label.textContent = `${percent}% (${count} Đơn vị)`;
      const fill = document.getElementById(`sad-pkg-${packageId}-fill`);
      if (fill) setRuntimeStyle(fill, "width", `${percent}%`);
    });
    const orgListContainer = document.getElementById("sad-recent-orgs-tbody");
    if (orgListContainer) {
      const list = summary.organizations;
      const organizationPage = paginateOwnedTable(this, "superAdminOrganizations", list);
      if (list.length === 0) {
        orgListContainer.innerHTML = trustedHTML(`<tr><td colspan="7" class="text-center text-muted">Chưa có tổ chức nào đăng ký thầu</td></tr>`);
      } else {
        orgListContainer.innerHTML = trustedHTML(organizationPage.items.map((org) => {
          const pkgName = org.package_id === "diamond" ? "Gói Kim Cương" : org.package_id === "gold" ? "Gói Vàng" : org.package_id === "silver" ? "Gói Bạc" : "Chưa đăng ký";
          const pkgClass = org.package_id === "diamond" ? "badge-primary" : org.package_id === "gold" ? "badge-warning" : org.package_id === "silver" ? "badge-success" : "badge-neutral";
          const isActive = org.status === "active";
          const statusBadge = isActive
            ? '<span class="badge badge-success"><i data-lucide="check-circle"></i> Hoạt động</span>'
            : '<span class="badge badge-danger"><i data-lucide="lock"></i> Đã khóa</span>';
          return `
                            <tr>
                                <td class="bf-s-78e97210a5">${escapeHtml(org.name)}</td>
                                <td>${org.manager ? escapeHtml(org.manager) : '<span class="text-muted">Chưa cấu hình</span>'}</td>
                                <td>${org.phone ? escapeHtml(org.phone) : '<span class="text-muted">Chưa có</span>'}</td>
                                <td data-commercial-only><span class="badge ${pkgClass}">${pkgName}</span></td>
                                <td class="bf-s-6e8bcfac8d" data-commercial-only>${org.end ? escapeHtml(org.end) : '<span class="text-muted">Vô thời hạn</span>'}</td>
                                <td>${statusBadge}</td>
                            </tr>
                        `;
        }).join(""));
      }
      renderTablePagination(
        document.getElementById("sad-recent-orgs-pagination"),
        organizationPage,
        (page) => {
          setTablePage(this, "superAdminOrganizations", page);
          void this.renderSuperAdminDashboard();
        },
      );
    }
  this.createIconsScoped(document.getElementById("tab-superadmin-dashboard"));
  return true;
}

export function summarizeSuperAdminOrganizations(users = [], systemPackages = []) {
  const organizationMap = new Map();
  (users || []).forEach((user) => {
    normalizeOrganizations(user)
      .filter((organization) => organization.scope_type === "organization")
      .forEach((organization) => {
        const subscription = organization.subscription || {};
        const existing = organizationMap.get(organization.id) || {
          id: organization.id,
          name: organization.name,
          manager: "",
          phone: "",
          package_id: subscription.package_id || "none",
          start: subscription.start_date || "",
          end: subscription.end_date || "",
          status: organization.status,
          userIds: new Set()
        };
        existing.userIds.add(String(user.id || user.username || user.email || ""));
        if (["owner", "manager"].includes(organization.role) || !existing.manager) {
          existing.manager = organization.employee_name || user.name || user.username || "";
          existing.phone = organization.employee_phone || "";
        }
        organizationMap.set(organization.id, existing);
      });
  });
  const organizations = [...organizationMap.values()].map((organization) => ({
    ...organization,
    userCount: organization.userIds.size
  }));
  const activeOrganizations = organizations.filter((organization) => organization.status === "active");
  const prices = new Map((systemPackages || []).map((pkg) => [String(pkg.id), Number(pkg.price || 0)]));
  const packageCounts = { silver: 0, gold: 0, diamond: 0 };
  activeOrganizations.forEach((organization) => {
    if (Object.hasOwn(packageCounts, organization.package_id)) {
      packageCounts[organization.package_id] += 1;
    }
  });
  const subscribedCount = Object.values(packageCounts).reduce((total, count) => total + count, 0);
  return {
    organizations,
    activeCount: activeOrganizations.length,
    activationRate: activeOrganizations.length > 0
      ? Math.round(subscribedCount / activeOrganizations.length * 100)
      : 0,
    packageCounts,
    revenue: activeOrganizations.reduce(
      (total, organization) => total + (prices.get(String(organization.package_id)) || 0),
      0
    )
  };
}
