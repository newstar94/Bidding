import { getHolidays } from "../shared/runtimeState.js";
import { resolvePackageResultStatus } from "../packages/lotEvaluationScope.js";
import { parseEvaluationMetadataForDisplay } from "../packages/evaluationMetadata.js";

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
const ALERT_DEADLINE_SOURCE = Object.freeze({
  closingToday: "Thời gian đóng thầu",
  closingSoon: "Thời gian đóng thầu",
  overdueOpening: "Thời gian đóng thầu",
  delayedEvaluation: "Thời gian mở thầu",
  contractExpired: "Ngày ký và thời hạn hợp đồng",
  contractExpiring: "Ngày ký và thời hạn hợp đồng",
  planPublishingWarning: "Ngày phê duyệt và lịch ngày làm việc",
  planPublishingOverdue: "Ngày phê duyệt và lịch ngày làm việc",
});
const ALERT_NEXT_STEP = Object.freeze({
  closingToday: "Kiểm tra mốc đóng thầu và mở hồ sơ gói thầu",
  closingSoon: "Rà soát hồ sơ trước mốc đóng thầu",
  overdueOpening: "Mở hồ sơ để xử lý mốc đã quá hạn",
  delayedEvaluation: "Tiếp tục rà soát và hoàn thiện đánh giá",
  contractExpired: "Mở hợp đồng để rà soát nghĩa vụ còn lại",
  contractExpiring: "Mở hợp đồng để rà soát thời hạn",
  planPublishingWarning: "Mở kế hoạch để kiểm tra việc đăng tải",
  planPublishingOverdue: "Mở kế hoạch để xử lý việc đăng tải quá hạn",
});
const ALERT_PRIORITY = ["overdueOpening", "contractExpired", "planPublishingOverdue", "closingToday", "delayedEvaluation", "contractExpiring", "planPublishingWarning", "closingSoon"];
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
  const rawMetadata = pkg.danhGiaHsdtMetadata || pkg.danh_gia_hsdt_metadata || {};
  const metadata = parseEvaluationMetadataForDisplay(rawMetadata).metadata;
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

export function dashboardAlertMatches(pkg, alertKey, now = new Date()) {
  return deriveDashboardAlerts([pkg], now).items.some(
    (item) => item.alertKey === String(alertKey || ""),
  );
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


export { parseDashboardDate, ALERT_DEADLINE_SOURCE, ALERT_NEXT_STEP };

