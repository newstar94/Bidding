import { trustedHTML } from "../shared/trustedTypes.js";
import { escapeHtml, safeAttr } from "../shared/view_helpers.js";
import { ALERT_META, parseDashboardDate } from "./dashboardAlertRules.js";

/*
 * Welcome banner and "next 7 days" card of the operations dashboard. Both are
 * read-only presentations of the alert items the dashboard already computed
 * for the current scope; they add no data source and no new alert rule.
 */

const UPCOMING_WINDOW_DAYS = 7;
const UPCOMING_LIMIT = 4;

export function dashboardGreeting(now = new Date()) {
  const hour = now.getHours();
  if (hour < 11) return "Chào buổi sáng";
  if (hour < 14) return "Chào buổi trưa";
  if (hour < 18) return "Chào buổi chiều";
  return "Chào buổi tối";
}

/** Vietnamese names are addressed by their last two parts ("Nguyễn Minh Anh" -> "Minh Anh"). */
export function dashboardShortName(fullName) {
  const words = String(fullName || "").trim().split(/\s+/u).filter(Boolean);
  if (words.length === 0) return "";
  return words.length >= 3 ? words.slice(-2).join(" ") : words.join(" ");
}

export function buildWelcomeSummary(alerts = {}) {
  const total = Array.isArray(alerts?.items) ? alerts.items.length : 0;
  const counts = alerts?.counts || {};
  if (!total) {
    return "Hiện không có việc khẩn cấp trong phạm vi được giao. Bạn có thể theo dõi tiến độ ở các mục bên dưới.";
  }
  const parts = [];
  const closingToday = Number(counts.closingToday || 0);
  const delayed = Number(counts.delayedEvaluation || 0);
  if (closingToday) parts.push(`<strong>${closingToday} gói thầu</strong> đóng thầu trong ngày`);
  if (delayed) parts.push(`<strong>${delayed} báo cáo đánh giá</strong> đã chậm`);
  const head = `Hôm nay có <strong>${total} việc</strong> cần bạn xử lý`;
  return parts.length ? `${head}: ${parts.join(" và ")}.` : `${head}.`;
}

function startOfDay(date) {
  return new Date(date.getFullYear(), date.getMonth(), date.getDate());
}

/** Alert items whose deadline falls today or within the next seven days, soonest first. */
export function selectUpcomingMilestones(alerts = {}, now = new Date(), limit = UPCOMING_LIMIT) {
  const from = startOfDay(now).getTime();
  const until = from + (UPCOMING_WINDOW_DAYS + 1) * 24 * 60 * 60 * 1000;
  return (Array.isArray(alerts?.items) ? alerts.items : [])
    .map((item) => ({ item, date: parseDashboardDate(item?.deadline) }))
    .filter(({ date }) => date && date.getTime() >= from && date.getTime() < until)
    .sort((left, right) => left.date - right.date)
    .slice(0, limit);
}

function targetOf(item) {
  if (item?.targetType === "plan") {
    return { action: "show-plan", code: item.maKeHoach, name: item.tenKeHoach || "Kế hoạch LCNT" };
  }
  if (item?.targetType === "contract") {
    return { action: "show-contract", code: item.soHopDong, name: item.tenHopDong || "Hợp đồng" };
  }
  return { action: "show-package", code: item?.maGoiThau, name: item?.tenGoiThau || "Gói thầu" };
}

const twoDigits = (value) => String(value).padStart(2, "0");

export function renderUpcomingMilestones(entries = [], now = new Date()) {
  if (!entries.length) {
    return '<li class="dashboard-upcoming-empty">Không có mốc nào trong 7 ngày tới.</li>';
  }
  const today = startOfDay(now).getTime();
  return entries.map(({ item, date }) => {
    const meta = ALERT_META[item.alertKey] || ALERT_META.closingSoon;
    const target = targetOf(item);
    const isToday = startOfDay(date).getTime() === today;
    const hasTime = date.getHours() !== 0 || date.getMinutes() !== 0;
    const time = hasTime ? `${twoDigits(date.getHours())}:${twoDigits(date.getMinutes())}` : "";
    const code = target.code || target.name;
    return `
      <li class="dashboard-upcoming-item">
        <span class="dashboard-upcoming-date${isToday ? " is-today" : ""}" aria-hidden="true">
          <small>Th${date.getMonth() + 1}</small><strong>${date.getDate()}</strong>
        </span>
        <span class="dashboard-upcoming-copy">
          <span class="dashboard-upcoming-top">
            <span class="dashboard-deadline deadline-${escapeHtml(meta.tone)}">${escapeHtml(meta.label)}</span>
            ${time ? `<span>${isToday ? "Hôm nay · " : ""}${escapeHtml(time)}</span>` : isToday ? "<span>Hôm nay</span>" : ""}
          </span>
          <a href="#" class="dashboard-upcoming-name" data-bf-action="${target.action}" data-id="${safeAttr(item.id)}" title="${safeAttr(`${meta.label} · ${code} — ${target.name}`)}">${escapeHtml(code)}</a>
          <small class="dashboard-upcoming-target">${escapeHtml(target.name)}</small>
        </span>
      </li>`;
  }).join("");
}

export function renderDashboardHero(alerts = {}, { now = new Date(), displayName = "" } = {}) {
  const shortName = dashboardShortName(displayName);
  const title = document.getElementById("dashboard-welcome-title");
  if (title) title.textContent = `${dashboardGreeting(now)}${shortName ? `, ${shortName}` : ""}!`;
  const summary = document.getElementById("dashboard-welcome-summary");
  if (summary) summary.innerHTML = trustedHTML(buildWelcomeSummary(alerts));
  const day = document.getElementById("dashboard-welcome-day");
  if (day) day.textContent = String(now.getDate());
  const list = document.getElementById("dashboard-upcoming-list");
  if (list) list.innerHTML = trustedHTML(renderUpcomingMilestones(selectUpcomingMilestones(alerts, now), now));
  const action = document.getElementById("btn-dashboard-welcome-action");
  if (action && !action.onclick) {
    action.onclick = () => {
      document.querySelector("#tab-dashboard .dashboard-priority-card")
        ?.scrollIntoView({ behavior: "smooth", block: "start" });
    };
  }
}
