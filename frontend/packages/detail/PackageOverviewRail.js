import { escapeHtml } from "../../shared/view_helpers.js";
import { resolveBidContractorName } from "../../partners/contractorVersionBinding.js";
import { parseEvaluationMetadataForDisplay } from "../evaluationMetadata.js";

/*
 * Read-only package progress and overview pieces:
 * - a horizontal progress stepper shown under the package title, built from
 *   dates and evaluation reports already recorded on the package and its plan;
 * - an overview rail (assignees, shortcut to the Word documents step) and a
 *   bidder card for the "Thông tin gói thầu" step.
 * Nothing here derives legal deadlines or exposes data outside the package
 * detail the user opened.
 */

const NON_POSTING_FORMS = new Set([
  "Chỉ định thầu rút gọn",
  "Lựa chọn nhà thầu trong trường hợp đặc biệt",
]);
const TWO_ENVELOPE = "Một giai đoạn hai túi hồ sơ";
const RESULT_STATUSES = new Set(["Đã có kết quả", "Đã có kết quả một phần"]);

/** Parses dd/MM/yyyy[ HH:mm] and yyyy-MM-dd[THH:mm] as local time; anything else is unknown. */
export function parseMilestoneDate(value) {
  const text = String(value || "").trim();
  if (!text) return null;
  const local = text.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})(?:\s+(\d{1,2}):(\d{2}))?/u);
  const iso = text.match(/^(\d{4})-(\d{2})-(\d{2})(?:[T\s](\d{2}):(\d{2}))?/u);
  const parts = local
    ? [local[3], local[2], local[1], local[4], local[5]]
    : iso ? [iso[1], iso[2], iso[3], iso[4], iso[5]] : null;
  if (!parts) return null;
  const [year, month, day, hour, minute] = parts.map((part) => Number(part || 0));
  const date = new Date(year, month - 1, day, hour, minute);
  return Number.isNaN(date.getTime()) || date.getMonth() !== month - 1 ? null : date;
}

/**
 * Latest recorded evaluation report, using the same evidence as the dashboard
 * "Chậm báo cáo đánh giá" rule (report number, report date, saved or completed round).
 */
export function packageEvaluationReport(pkg) {
  const raw = pkg?.danhGiaHsdtMetadata || pkg?.danh_gia_hsdt_metadata || {};
  const rounds = Object.values(parseEvaluationMetadataForDisplay(raw).metadata || {})
    .filter((round) => round && (
      round.soBaoCao || round.ngayBaoCao || round.saved
      || round.trangThai === "completed" || round.trangThai === "approved"
    ));
  if (!rounds.length) return { exists: false, date: "", number: "" };
  const latest = rounds
    .map((round) => ({ round, date: parseMilestoneDate(round.ngayBaoCao) }))
    .sort((left, right) => (right.date?.getTime() || 0) - (left.date?.getTime() || 0))[0].round;
  return { exists: true, date: String(latest.ngayBaoCao || ""), number: String(latest.soBaoCao || "") };
}

export function buildPackageMilestones({ pkg, approvals = [], status = "", now = new Date() } = {}) {
  if (!pkg) return [];
  const packageStatus = String(status || pkg.trangThai || "");
  const items = [];
  const add = (key, label, value, detail = "", options = {}) => {
    items.push({ key, label, value: String(value || ""), detail, withTime: false, done: false, activeLabel: "", ...options });
  };
  const approval = approvals.find((candidate) => candidate?.approvalDate) || approvals[0];
  add("plan", "Phê duyệt KHLCNT", approval?.approvalDate,
    approval?.decisionNumber ? `QĐ ${approval.decisionNumber}` : "");
  add("hsmt", "Phê duyệt E-HSMT", pkg.ngayQuyetDinh, pkg.soQuyetDinh ? `QĐ ${pkg.soQuyetDinh}` : "");
  if (!NON_POSTING_FORMS.has(pkg.hinhThucLuaChon)) {
    const twoEnvelope = pkg.phuongThucLuaChon === TWO_ENVELOPE;
    add("posting", "Đăng tải TBMT", pkg.thoiGianDangTai, "", { withTime: true });
    add("closing", "Đóng thầu", pkg.thoiGianDongThau, "", { withTime: true });
    add("opening", twoEnvelope ? "Mở E-HSĐXKT" : "Mở thầu", pkg.thoiGianMoThau, "", { withTime: true });
    if (twoEnvelope) add("opening_fin", "Mở E-HSĐXTC", pkg.thoiGianMoEhsdxtc, "", { withTime: true });
  }
  const report = packageEvaluationReport(pkg);
  add("evaluation", "Đánh giá E-HSDT", report.date, report.number ? `BC ${report.number}` : "", {
    done: report.exists || RESULT_STATUSES.has(packageStatus),
    activeLabel: packageStatus === "Đang chấm thầu" ? "Đang đánh giá" : "",
  });
  add("result", "Phê duyệt KQLCNT", pkg.ngayQuyetDinhKetQua,
    pkg.soQuyetDinhKetQua ? `QĐ ${pkg.soQuyetDinhKetQua}` : "", {
      done: packageStatus === "Đã có kết quả",
      activeLabel: packageStatus === "Đã có kết quả một phần" ? "Có kết quả một phần" : "",
    });

  const nowTime = now.getTime();
  const dated = items.map((item) => {
    const date = parseMilestoneDate(item.value);
    return { ...item, date, isDone: item.done || Boolean(date && date.getTime() <= nowTime) };
  });
  const lastDone = dated.reduce((last, item, index) => (item.isDone ? index : last), -1);
  let nextAssigned = packageStatus === "Hủy thầu";
  return dated.map(({ isDone, done: _evidence, ...item }, position) => {
    if (isDone) return { ...item, state: "done" };
    if (!nextAssigned && position > lastDone) {
      nextAssigned = true;
      return { ...item, state: "next" };
    }
    return { ...item, state: "pending" };
  });
}

function milestoneCaption(item, formatDate) {
  if (item.state === "next") {
    return item.activeLabel || (item.date ? `Sắp tới · ${formatDate(item.value)}` : "Bước tiếp theo");
  }
  return item.date ? formatDate(item.value) : (item.state === "done" ? "Đã hoàn thành" : "Chưa cập nhật");
}

export function renderPackageProgressStepper({
  milestones = [],
  cancelled = false,
  formatDate = (value) => value,
  formatDateTime = formatDate,
} = {}) {
  if (!milestones.length) return "";
  const done = milestones.filter((item) => item.state === "done").length;
  const note = cancelled ? "Gói thầu đã hủy" : `${done}/${milestones.length} bước đã xong`;
  const steps = milestones.map((item) => {
    const fullDate = item.date ? (item.withTime ? formatDateTime(item.value) : formatDate(item.value)) : "";
    const tooltip = [item.label, fullDate, item.detail].filter(Boolean).join(" · ");
    return `
      <li class="package-step" data-state="${escapeHtml(item.state)}" title="${escapeHtml(tooltip)}">
        <span class="package-step-dot" aria-hidden="true"></span>
        <strong>${escapeHtml(item.label)}</strong>
        <small>${escapeHtml(milestoneCaption(item, formatDate))}</small>
      </li>`;
  }).join("");
  return `
    <div class="package-progress-head">
      <span><strong>Tiến độ gói thầu</strong> · ${escapeHtml(note)}</span>
      <button type="button" class="btn btn-text btn-sm" data-bf-action="switch-tab" data-tab="goithau-timeline">
        <i data-lucide="calendar-clock" aria-hidden="true"></i>Xem timeline
      </button>
    </div>
    <ol class="package-stepper" aria-label="Các bước tiến độ gói thầu">${steps}</ol>`;
}

export function assigneeInitials(name) {
  const words = String(name || "").trim().split(/\s+/u).filter(Boolean);
  if (words.length === 0) return "?";
  const letters = words.length > 1 ? [words[words.length - 2], words[words.length - 1]] : [words[0]];
  return letters.map((word) => word.charAt(0)).join("").toLocaleUpperCase("vi");
}

export function renderPackageOverviewRail({ assignees = [], hasDocumentsTab = false } = {}) {
  const people = assignees.length
    ? `<ul class="package-rail-people">${assignees.map((name) => `
        <li class="package-rail-person">
          <span class="package-rail-avatar" aria-hidden="true">${escapeHtml(assigneeInitials(name))}</span>
          <span>${escapeHtml(name)}<small>Người phụ trách</small></span>
        </li>`).join("")}</ul>`
    : '<p class="package-rail-empty">Chưa phân công người phụ trách.</p>';
  const documents = hasDocumentsTab ? `
    <section class="card package-rail-card" aria-labelledby="package-rail-documents-title">
      <h4 id="package-rail-documents-title">Văn bản Word</h4>
      <p class="package-rail-sub">Tạo và tải các văn bản Word của gói thầu ở bước Tài liệu.</p>
      <button type="button" class="btn btn-outline btn-sm package-rail-action" data-package-open-tab="documents">
        <i data-lucide="folder-open" aria-hidden="true"></i>Mở bước Tài liệu
      </button>
    </section>` : "";
  return `
    <aside class="package-overview-rail" aria-label="Tóm tắt gói thầu">
      <section class="card package-rail-card" aria-labelledby="package-rail-people-title">
        <h4 id="package-rail-people-title">Phân công</h4>
        ${people}
      </section>
      ${documents}
    </aside>`;
}

export function bidConclusionTone(conclusion) {
  const text = String(conclusion || "").trim().toLocaleLowerCase("vi");
  if (!text) return "neutral";
  if (text.startsWith("không") || text.includes("loại")) return "danger";
  if (text.startsWith("đạt") || text.includes("trúng thầu")) return "success";
  return "neutral";
}

export function renderPackageBiddersCard({ model, bids = [], formatCurrency = (value) => value } = {}) {
  if (!bids.length) return "";
  const rows = bids.map((bid) => {
    const name = resolveBidContractorName(model, bid) || bid?.tenNhaThau || "--";
    const conclusion = String(bid?.danhGiaKetLuan || "").trim();
    const tone = bidConclusionTone(conclusion);
    const price = bid?.giaDuThau !== undefined && bid?.giaDuThau !== null && bid?.giaDuThau !== ""
      ? formatCurrency(bid.giaDuThau)
      : "--";
    return `<tr>
        <td class="text-wrap">${escapeHtml(name)}</td>
        <td class="text-right">${escapeHtml(price)}</td>
        <td><span class="badge badge-${tone}">${escapeHtml(conclusion || "Chưa đánh giá")}</span></td>
      </tr>`;
  }).join("");
  return `
    <section class="card package-bidders-card" aria-labelledby="package-bidders-title">
      <header>
        <h4 id="package-bidders-title">Nhà thầu tham dự <span class="badge badge-neutral">${bids.length}</span></h4>
        <p class="package-rail-sub">Giá dự thầu và kết luận đánh giá đã ghi nhận.</p>
      </header>
      <div class="table-container">
        <table class="data-table package-bidders-table">
          <thead><tr><th>Nhà thầu</th><th class="text-right">Giá dự thầu</th><th>Kết luận</th></tr></thead>
          <tbody>${rows}</tbody>
        </table>
      </div>
    </section>`;
}
