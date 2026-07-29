import { escapeHtml } from "../../shared/view_helpers.js";

export function renderPackageSummary({
  pkg,
  planName,
  investorName,
  formatCurrency,
  formatDateTime,
  timeIds = false,
  lockedMessage = "",
}) {
  const field = (label, value, strong = false) => `<div>• <strong class="bf-s-fcb5ddef65">${label}:</strong> ${strong ? `<span class="text-dark fw-bold">${value}</span>` : value}</div>`;
  const medicine = pkg.linhVuc === "Hàng hóa" ? (pkg.isThuoc === 1 || pkg.isThuoc === "1" ? " (Thuốc)" : " (Không phải thuốc)") : "";
  const closing = pkg.thoiGianDongThau ? formatDateTime(pkg.thoiGianDongThau) : "--";
  const opening = pkg.thoiGianMoThau ? formatDateTime(pkg.thoiGianMoThau) : "--";
  return `<div class="bf-s-8bd3eb473c">
    <div class="bf-s-5d398becec">Thông số Gói thầu</div>
    <div class="bf-s-13b5590e90">
      ${field("Chủ đầu tư", escapeHtml(investorName || "Không rõ"), true)}
      ${field("Tên kế hoạch", escapeHtml(planName || "Không rõ"), true)}
      ${field("Lĩnh vực", `${escapeHtml(pkg.linhVuc || "Hàng hóa")}${medicine}`)}
      ${field("Phương thức LCNT", escapeHtml(pkg.phuongThucLuaChon || "Một giai đoạn một túi hồ sơ"))}
      ${field("Phân lô", pkg.phanLo === "Có" ? "Có chia phần lô" : "Không chia phần lô")}
      ${field("Giá gói thầu", escapeHtml(formatCurrency(pkg.giaGoiThau)), true)}
      ${field("Hình thức LCNT", escapeHtml(pkg.hinhThucLuaChon || "--"))}
      ${pkg.phuongPhapDanhGia ? field("Phương pháp đánh giá", `${escapeHtml(pkg.phuongPhapDanhGia)}${pkg.phuongPhapDanhGia === "Kết hợp giữa kỹ thuật và giá" && pkg.trongSoKyThuat ? ` (${escapeHtml(pkg.trongSoKyThuat)}%)` : ""}`) : ""}
      ${field("Loại hợp đồng", escapeHtml(pkg.loaiHopDong || "--"))}
      ${field("Thời gian thực hiện", escapeHtml(pkg.thoiGianThucHien || "--"))}
      ${field("Nguồn vốn", escapeHtml(pkg.nguonVon || "--"))}
      ${field("Thời gian đóng thầu", timeIds ? `<span id="display-thoigiandongthau" class="fw-bold">${escapeHtml(closing)}</span>` : escapeHtml(closing))}
      ${field("Thời gian mở thầu", timeIds ? `<span id="display-thoigianmothau" class="fw-bold">${escapeHtml(opening)}</span>` : escapeHtml(opening))}
    </div>
    ${lockedMessage ? `<div class="package-lock-notice" role="status">
      <svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><rect x="3" y="11" width="18" height="11" rx="2" ry="2"></rect><path d="M7 11V7a5 5 0 0 1 10 0v4"></path></svg>
      <span>${escapeHtml(lockedMessage)}</span>
    </div>` : ""}
  </div>`;
}
