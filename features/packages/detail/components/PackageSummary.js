import { escapeHtml } from "../../../../views/subviews/view_helpers.js";

export function renderPackageSummary({ pkg, planName, investorName, formatCurrency, formatDateTime, timeIds = false }) {
  const field = (label, value, strong = false) => `<div>• <strong>${label}:</strong> ${strong ? `<span class="text-dark fw-bold">${value}</span>` : value}</div>`;
  const medicine = pkg.linhVuc === "Hàng hóa" ? (pkg.isThuoc === 1 || pkg.isThuoc === "1" ? " (Thuốc)" : " (Không phải thuốc)") : "";
  const closing = pkg.thoiGianDongThau ? formatDateTime(pkg.thoiGianDongThau) : "--";
  const opening = pkg.thoiGianMoThau ? formatDateTime(pkg.thoiGianMoThau) : "--";
  return `<div class="package-summary">
    <div class="package-summary-title">Thông số Gói thầu</div>
    <div class="package-summary-grid">
      ${field("Chủ đầu tư", escapeHtml(investorName || "Không rõ"), true)}
      ${field("Tên kế hoạch", escapeHtml(planName || "Không rõ"), true)}
      ${field("Lĩnh vực", `${escapeHtml(pkg.linhVuc || "Hàng hóa")}${medicine}`)}
      ${field("Phương thức LCNT", escapeHtml(pkg.phuongThucLuaChon || "Một giai đoạn một túi hồ sơ"))}
      ${field("Phân lô", pkg.phanLo === "Có" ? "Có chia phần lô" : "Không chia phần lô")}
      ${field("Giá gói thầu", escapeHtml(formatCurrency(pkg.giaGoiThau)), true)}
      ${field("Hình thức LCNT", escapeHtml(pkg.hinhThucLuaChon || "--"))}
      ${field("Loại hợp đồng", escapeHtml(pkg.loaiHopDong || "--"))}
      ${field("Thời gian thực hiện", escapeHtml(pkg.thoiGianThucHien || "--"))}
      ${field("Nguồn vốn", escapeHtml(pkg.nguonVon || "--"))}
      ${field("Thời gian đóng thầu", timeIds ? `<span id="display-thoigiandongthau" class="fw-bold">${escapeHtml(closing)}</span>` : escapeHtml(closing))}
      ${field("Thời gian mở thầu", timeIds ? `<span id="display-thoigianmothau" class="fw-bold">${escapeHtml(opening)}</span>` : escapeHtml(opening))}
    </div>
  </div>`;
}
