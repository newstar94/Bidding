import { trustedHTML } from "../shared/trustedTypes.js";
import { setRuntimeStyle } from "../shared/runtimeStyles.js";
import { escapeHtml, safeAttr, renderEmptyRow } from "../shared/view_helpers.js";
import { normalizeOrganizations } from "../auth/accessContext.js";
import { apiFetch } from "../shared/apiClient.js";
import { getHolidays } from "../shared/runtimeState.js";
const PACKAGE_STATUS_COLORS = {
  "Chuẩn bị": "var(--text-light)",
  "Đang mời thầu": "var(--primary)",
  "Đã mở thầu": "#f59e0b",
  "Đang chấm thầu": "#9333ea",
  "Đã có kết quả": "var(--success)",
  "Hủy thầu": "var(--danger)"
};
const PACKAGE_STATUS_ORDER = Object.keys(PACKAGE_STATUS_COLORS);
const PLAN_STATUS_ORDER = ["Chưa triển khai", "Đang thực hiện", "Hoàn thành"];
const CONTRACT_STATUS_ORDER = ["Chưa hiệu lực", "Đang thực hiện", "Tạm dừng", "Đã hoàn thành", "Đã thanh lý", "Đã hủy"];
const CONTRACT_STATUS_CODES = {
  NOT_EFFECTIVE: "Chưa hiệu lực",
  ACTIVE: "Đang thực hiện",
  SUSPENDED: "Tạm dừng",
  COMPLETED: "Đã hoàn thành",
  LIQUIDATED: "Đã thanh lý",
  CANCELLED: "Đã hủy"
};
const CONTRACT_EXPIRY_WARNING_DAYS = 10;
const ALERT_META = {
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

function setText(id, value) {
  const element = document.getElementById(id);
  if (element) element.textContent = String(value ?? "");
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

export function normalizeContractStatusCounts(incoming = {}) {
  const normalized = normalizeOrderedCounts({}, CONTRACT_STATUS_ORDER);
  Object.entries(incoming || {}).forEach(([rawStatus, rawCount]) => {
    const status = CONTRACT_STATUS_CODES[rawStatus] || rawStatus;
    if (Object.hasOwn(normalized, status)) normalized[status] = Number(rawCount || 0);
  });
  return normalized;
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
    const statuses = planPackages.map((pkg) => pkg.trangThai || "Chuẩn bị");
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
    const status = pkg.trangThai || "Chuẩn bị";
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

function contractHasInvoice(contract) {
  if ([true, 1, "1", "true", "yes"].includes(contract.daXuatHoaDon)) return true;
  if (String(contract.soHoaDon || contract.ngayXuatHoaDon || "").trim()) return true;
  const paperStatus = normalizedDashboardSearchText(contract.trangThaiHoSo);
  return ["da xuat hoa don", "hoa don da xuat", "da lap hoa don"].some((label) => paperStatus.includes(label));
}

export function deriveContractExpiryAlerts(contracts = [], now = new Date(), warningDays = CONTRACT_EXPIRY_WARNING_DAYS) {
  const counts = { contractExpired: 0, contractExpiring: 0 };
  const items = [];
  const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  const warningLimit = new Date(today);
  warningLimit.setDate(warningLimit.getDate() + warningDays);
  contracts.forEach((contract) => {
    const status = CONTRACT_STATUS_CODES[contract.trangThaiHopDong] || contract.trangThaiHopDong || "Đang thực hiện";
    if (["Chưa hiệu lực", "Đã thanh lý", "Đã hủy"].includes(status)) return;
    const signedAt = parseDashboardDate(contract.ngayKy);
    const signedDate = signedAt ? new Date(signedAt.getFullYear(), signedAt.getMonth(), signedAt.getDate()) : null;
    const deadline = signedDate ? addContractDuration(signedDate, contract.soNgayThucHien || contract.thoiGianThucHien) : null;
    if (!deadline || deadline > warningLimit) return;
    const alertKey = deadline < today ? "contractExpired" : "contractExpiring";
    const missingInvoice = !contractHasInvoice(contract);
    const missingLiquidation = status !== "Đã thanh lý" && !String(contract.ngayThanhLy || "").trim();
    if (!missingInvoice && !missingLiquidation) return;
    const missingSteps = [missingInvoice ? "Chưa xuất hóa đơn" : "", missingLiquidation ? "Chưa thanh lý" : ""].filter(Boolean);
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
  const packageStatusCounts = normalizeDashboardStatusCounts();
  const contractStatusCounts = normalizeContractStatusCounts();
  const contractValues = Object.fromEntries(CONTRACT_STATUS_ORDER.map((status) => [status, 0]));
  packages.forEach((pkg) => {
    const status = pkg.trangThai === "Huỷ thầu" ? "Hủy thầu" : pkg.trangThai;
    if (Object.hasOwn(packageStatusCounts, status)) packageStatusCounts[status]++;
  });
  contracts.forEach((contract) => {
    const status = CONTRACT_STATUS_CODES[contract.trangThaiHopDong] || contract.trangThaiHopDong || "Đang thực hiện";
    if (Object.hasOwn(contractStatusCounts, status)) {
      contractStatusCounts[status]++;
      contractValues[status] = model.sumVND([contractValues[status], contract.giaTri || 0]);
    }
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
    totalContractValue: model.sumVND(contracts.map((contract) => contract.giaTri || 0)),
    recentPackages: [...packages].reverse().slice(0, 4),
    alerts: {
      counts: { ...packageAlerts.counts, ...planAlerts.counts, ...contractAlerts.counts },
      items: alertItems
    }
  };
}

function buildServerDashboardData(summary) {
  const counts = summary.counts || {};
  return {
    counts: {
      ...counts,
      contractTotal: Number(summary.contractTotalCount ?? counts.hopdong ?? 0)
    },
    planStatusCounts: normalizeOrderedCounts(summary.planStatusCounts, PLAN_STATUS_ORDER),
    packageStatusCounts: normalizeDashboardStatusCounts(summary.statusCounts),
    contractStatusCounts: normalizeContractStatusCounts(summary.contractStatusCounts),
    contractValues: normalizeOrderedCounts(summary.contractValueByStatus, CONTRACT_STATUS_ORDER),
    totalContractValue: summary.totalContractValueAll ?? summary.totalContractValue ?? 0,
    recentPackages: Array.isArray(summary.recentPackages) ? summary.recentPackages : [],
    alerts: {
      counts: { ...Object.fromEntries(Object.keys(ALERT_META).map((key) => [key, 0])), ...(summary.alertCounts || {}) },
      items: Array.isArray(summary.alertItems) ? summary.alertItems : []
    },
    evaluationDelayDays: Number(summary.evaluationDelayDays || 7)
  };
}

function renderMetricBreakdown(containerId, counts, formatter = (value) => String(value)) {
  const container = document.getElementById(containerId);
  if (!container) return;
  container.innerHTML = trustedHTML(Object.entries(counts || {}).map(([status, value], index) => `
    <div class="dashboard-metric-row">
      <span><i class="dashboard-status-dot status-tone-${index % 6}"></i>${escapeHtml(status)}</span>
      <strong>${escapeHtml(formatter(value))}</strong>
    </div>
  `).join(""));
}

function renderContractSummary(counts, values) {
  const container = document.getElementById("contract-summary-breakdown");
  if (!container) return;
  const statuses = [...new Set([...Object.keys(counts || {}), ...Object.keys(values || {})])];
  container.innerHTML = trustedHTML(statuses.map((status, index) => {
    const count = Number(counts?.[status] || 0);
    const formattedValue = compactCurrency(values?.[status] || 0);
    return `
      <div class="dashboard-contract-row" role="group" aria-label="${safeAttr(`${status}: ${count} hợp đồng, ${formattedValue}`)}">
        <span class="dashboard-contract-status"><i class="dashboard-status-dot status-tone-${index % 6}"></i>${escapeHtml(status)}</span>
        <span class="dashboard-contract-values"><strong>${count} HĐ</strong><em>${escapeHtml(formattedValue)}</em></span>
      </div>
    `;
  }).join(""));
}

function renderPackageDonut(statusCounts) {
  const total = Object.values(statusCounts).reduce((sum, count) => sum + Number(count || 0), 0);
  setText("donut-total-count", total);
  let accumulated = 0;
  const gradientParts = [];
  const legend = document.getElementById("status-legend-list");
  if (legend) {
    legend.innerHTML = trustedHTML(PACKAGE_STATUS_ORDER.map((status, index) => {
      const count = Number(statusCounts[status] || 0);
      const percent = total ? count / total * 100 : 0;
      if (count > 0) {
        gradientParts.push(`${PACKAGE_STATUS_COLORS[status]} ${accumulated}% ${accumulated + percent}%`);
        accumulated += percent;
      }
      return `<div class="legend-item"><div class="legend-info"><span class="legend-dot status-tone-${index % 6}"></span><span>${escapeHtml(status)}</span></div><span class="legend-val">${count} (${percent.toFixed(0)}%)</span></div>`;
    }).join(""));
  }
  const donut = document.querySelector("#tab-dashboard .status-donut-chart");
  if (donut) setRuntimeStyle(donut, "background", gradientParts.length ? `conic-gradient(${gradientParts.join(", ")})` : "var(--neutral-soft)");
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
    tbody.innerHTML = trustedHTML(renderEmptyRow(4, "Không có công việc khẩn cấp", "circle-check-big"));
    return;
  }
  tbody.innerHTML = trustedHTML(items.map((item) => {
    const meta = ALERT_META[item.alertKey] || ALERT_META.closingSoon;
    const targetType = item.targetType === "plan" ? "plan" : item.targetType === "contract" ? "contract" : "package";
    const targetMeta = {
      plan: { action: "show-plan", label: "Kế hoạch", code: item.maKeHoach, name: item.tenKeHoach || "Kế hoạch LCNT" },
      contract: { action: "show-contract", label: "Hợp đồng", code: item.soHopDong, name: item.tenHopDong || "Hợp đồng" },
      package: { action: "show-package", label: "Gói thầu", code: item.maGoiThau, name: item.tenGoiThau || "Gói thầu" }
    }[targetType];
    return `
      <tr>
        <td><a href="#" data-bf-action="${targetMeta.action}" data-id="${safeAttr(item.id)}" class="dashboard-package-cell"><span class="dashboard-object-type type-${targetType}">${escapeHtml(targetMeta.label)}</span><span class="detail-code">${escapeHtml(targetMeta.code || "Chưa có mã")}</span><small>${escapeHtml(targetMeta.name)}</small></a></td>
        <td><span class="dashboard-action-label action-${meta.tone}"><i data-lucide="${meta.icon}"></i>${escapeHtml(meta.label)}</span><small class="dashboard-action-detail">${escapeHtml(item.alertDetail || meta.detail)}</small></td>
        <td><span class="dashboard-deadline deadline-${meta.tone}">${escapeHtml(formatDashboardDate(item.deadline))}</span></td>
        <td><button type="button" class="btn btn-outline btn-sm" data-bf-action="${targetMeta.action}" data-id="${safeAttr(item.id)}" aria-label="Xử lý ${safeAttr(targetMeta.label)} ${safeAttr(targetMeta.code || targetMeta.name)}">Xử lý</button></td>
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
      <td><a href="#" data-bf-action="show-package" data-id="${safeAttr(pkg.id)}" class="text-blue fw-bold link-hover"><span class="detail-code">${escapeHtml(pkg.maGoiThau || "")}</span></a></td>
      <td><a href="#" data-bf-action="show-package" data-id="${safeAttr(pkg.id)}" class="view-package-link">${escapeHtml(pkg.tenGoiThau || "")}</a></td>
      <td>${view.model.formatCurrency(pkg.giaGoiThau || 0)}</td>
      <td>${view.getStatusBadge(pkg.trangThai)}</td>
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
  renderMetricBreakdown("plan-status-breakdown", data.planStatusCounts);
  renderContractSummary(data.contractStatusCounts, data.contractValues);
  renderDashboardAlerts(data.alerts);
  renderPackageDonut(data.packageStatusCounts);
  renderRecentPackages(view, data.recentPackages);
}

export function renderDashboard() {
  const serverSummary = this.model.useServerSidePagination ? this.model.dashboardSummary : null;
  const data = serverSummary?.counts ? buildServerDashboardData(serverSummary) : buildLocalDashboardData(this);
  renderDashboardSnapshot(this, data);
  this.createIconsScoped(document.getElementById("tab-dashboard"));
}
export function renderSuperAdminDashboard() {
  apiFetch("/api/auth/users").then((r) => r.ok ? r.json() : []).then((users) => {
    const summary = summarizeSuperAdminOrganizations(users, this.model.state.systempackages);
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
    const orgListContainer = document.getElementById("sa-org-list-tbody");
    if (orgListContainer) {
      const list = summary.organizations;
      if (list.length === 0) {
        orgListContainer.innerHTML = trustedHTML(`<tr><td colspan="7" class="text-center text-muted">Chưa có tổ chức nào đăng ký thầu</td></tr>`);
      } else {
        orgListContainer.innerHTML = trustedHTML(list.map((org) => {
          const pkgName = org.package_id === "diamond" ? "Gói Kim Cương" : org.package_id === "gold" ? "Gói Vàng" : org.package_id === "silver" ? "Gói Bạc" : "Chưa đăng ký";
          const pkgClass = org.package_id === "diamond" ? "badge-primary" : org.package_id === "gold" ? "badge-warning" : org.package_id === "silver" ? "badge-success" : "badge-neutral";
          return `
                            <tr>
                                <td class="bf-s-78e97210a5">${escapeHtml(org.name)}</td>
                                <td>${org.manager ? escapeHtml(org.manager) : '<span class="text-muted">Chưa cấu hình</span>'}</td>
                                <td>${org.email ? escapeHtml(org.email) : '<span class="text-muted">Chưa có</span>'}</td>
                                <td><span class="badge ${pkgClass}">${pkgName}</span></td>
                                <td class="bf-s-6e8bcfac8d">${org.end ? escapeHtml(org.end) : '<span class="text-muted">Vô thời hạn</span>'}</td>
                                <td class="bf-s-ef70dae7ee">${org.userCount}</td>
                                <td class="text-right">
                                    <div class="actions-group">
                                        <button class="btn btn-icon btn-neutral" data-bf-action="switch-tab" data-tab="superadmin" title="Quản lý chi tiết"><i data-lucide="edit"></i></button>
                                    </div>
                                </td>
                            </tr>
                        `;
        }).join(""));
      }
    }
    this.createIconsScoped(document.getElementById("tab-superadmin-dashboard"));
  });
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
          email: "",
          package_id: subscription.package_id || "none",
          start: subscription.start_date || "",
          end: subscription.end_date || "",
          status: organization.status,
          userIds: new Set()
        };
        existing.userIds.add(String(user.id || user.username || user.email || ""));
        if (["owner", "manager"].includes(organization.role) || !existing.manager) {
          existing.manager = organization.employee_name || user.name || user.username || "";
          existing.email = user.email || "";
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
