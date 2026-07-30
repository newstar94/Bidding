import { getJson } from "./apiClient.js";
import { trustedHTML } from "./trustedTypes.js";
import { escapeHtml } from "./view_helpers.js";

export const ACTIVITY_LABELS = Object.freeze({
  "goithau.created": "Đã tạo gói thầu",
  "goithau.updated": "Đã cập nhật gói thầu",
  "hopdong.created": "Đã tạo hợp đồng",
  "hopdong.updated": "Đã cập nhật hợp đồng",
  "package_document.uploaded": "Đã tải tài liệu lên",
  "package_document.replaced": "Đã thay thế tài liệu",
  "package_document.deleted": "Đã xóa tài liệu",
  "assignment.added": "Đã thêm người phụ trách",
  "assignment.removed": "Đã gỡ người phụ trách",
});

const ACTIVITY_FIELD_LABELS = Object.freeze({
  goithau: Object.freeze({
    ma_goi_thau: "Mã gói thầu (Mã TBMT)",
    phien_ban: "Phiên bản dữ liệu",
    ten_goi_thau: "Tên gói thầu",
    gia_goi_thau: "Giá gói thầu",
    loai_hop_dong: "Loại hợp đồng",
    hinh_thuc_lua_chon: "Hình thức lựa chọn nhà thầu",
    phuong_thuc_lua_chon: "Phương thức lựa chọn nhà thầu",
    qua_mang: "Hình thức thực hiện qua mạng",
    trong_nuoc_quoc_te: "Phạm vi trong nước / quốc tế",
    thoi_gian_thuc_hien: "Thời gian thực hiện gói thầu",
    nguon_von: "Nguồn vốn",
    gia_trung_thau: "Giá trúng thầu",
    linh_vuc: "Lĩnh vực gói thầu",
    tuy_chon_mua_them: "Tùy chọn mua thêm",
    thoi_gian_to_chuc: "Thời gian tổ chức lựa chọn nhà thầu",
    thoi_gian_bat_dau_to_chuc: "Thời gian bắt đầu tổ chức",
    phan_lo: "Phạm vi chia phần lô",
    thoi_gian_dang_tai: "Thời gian đăng tải thông báo mời thầu",
    thoi_gian_dong_thau: "Thời gian đóng thầu",
    thoi_gian_mo_thau: "Thời gian mở thầu",
    thoi_gian_mo_ehsdxtc: "Thời gian mở E-HSĐXTC",
    so_quyet_dinh: "Số quyết định phê duyệt HSMT / Hồ sơ yêu cầu",
    ngay_quyet_dinh: "Ngày quyết định phê duyệt HSMT / Hồ sơ yêu cầu",
    so_quyet_dinh_ket_qua: "Số quyết định phê duyệt kết quả lựa chọn nhà thầu",
    ngay_quyet_dinh_ket_qua: "Ngày quyết định phê duyệt kết quả lựa chọn nhà thầu",
    thoi_gian_goi_thau: "Thời gian thực hiện gói thầu của nhà thầu trúng thầu",
    thoi_gian_hop_dong: "Thời gian thực hiện hợp đồng",
    gia_tri_dam_bao_du_thau: "Giá trị bảo đảm dự thầu",
    hieu_luc_hsdt: "Hiệu lực E-HSDT",
    hieu_luc_dam_bao_du_thau: "Hiệu lực bảo đảm dự thầu",
    phuong_phap_danh_gia: "Phương pháp đánh giá E-HSDT",
    trong_so_ky_thuat: "Trọng số điểm kỹ thuật",
    ty_le_bao_dam_hop_dong: "Tỷ lệ bảo đảm thực hiện hợp đồng",
    is_thuoc: "Phân loại gói thầu thuốc",
    trang_thai: "Trạng thái gói thầu",
    yeu_cau_tham_dinh_hsmt: "Yêu cầu thẩm định HSMT",
    so_bao_cao_tham_dinh_hsmt: "Số báo cáo thẩm định HSMT",
    ngay_bao_cao_tham_dinh_hsmt: "Ngày báo cáo thẩm định HSMT",
    so_to_trinh_hsmt: "Số tờ trình phê duyệt HSMT",
    ngay_trinh_hsmt: "Ngày trình phê duyệt HSMT",
    ngay_moi_doi_chieu: "Ngày mời đối chiếu tài liệu / thương thảo",
    ngay_doi_chieu: "Ngày đối chiếu tài liệu / thương thảo",
    is_rebid: "Trạng thái tổ chức lại gói thầu",
  }),
  hopdong: Object.freeze({
    phien_ban: "Phiên bản dữ liệu",
    ten_hop_dong: "Tên hợp đồng",
    so_hop_dong: "Số hợp đồng",
    ngay_ky: "Ngày ký hợp đồng",
    ngay_thanh_ly: "Ngày thanh lý hợp đồng",
    gia_tri: "Giá trị hợp đồng",
    loai_hop_dong: "Loại hợp đồng",
    thoi_gian_thuc_hien: "Thời gian thực hiện hợp đồng",
    trang_thai_hop_dong: "Trạng thái hợp đồng",
    phan_loai: "Phân loại hợp đồng",
    co_qd_chi_dinh: "Thông tin quyết định chỉ định thầu",
    so_qd_chi_dinh: "Số quyết định chỉ định thầu",
    ngay_qd_chi_dinh: "Ngày quyết định chỉ định thầu",
  }),
});

function activityTargetType(action) {
  const prefix = String(action || "").split(".", 1)[0];
  return Object.hasOwn(ACTIVITY_FIELD_LABELS, prefix) ? prefix : "";
}

export function activityChangedFieldLabels(item) {
  const changedFields = Array.isArray(item?.metadata?.changedFields)
    ? item.metadata.changedFields
    : [];
  const fieldLabels = ACTIVITY_FIELD_LABELS[activityTargetType(item?.action)] || {};
  const labels = [];
  let unknownCount = 0;
  changedFields.forEach((fieldName) => {
    const label = fieldLabels[String(fieldName || "").trim()];
    if (label && !labels.includes(label)) labels.push(label);
    else if (!label) unknownCount += 1;
  });
  if (unknownCount) labels.push(`${unknownCount} thông tin khác`);
  return labels;
}

export function formatActivityTime(value) {
  const parsed = new Date(value);
  if (!value || Number.isNaN(parsed.getTime())) return "Không rõ thời gian";
  const time = new Intl.DateTimeFormat("vi-VN", {
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  }).format(parsed);
  const date = new Intl.DateTimeFormat("vi-VN", {
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
  }).format(parsed);
  return `${time} · ${date}`;
}

function activityDetailMarkup(item) {
  const metadata = item?.metadata || {};
  if (metadata.documentName) {
    return `<p class="activity-detail-line"><i data-lucide="file-text" aria-hidden="true"></i><span>Tài liệu: <strong>${escapeHtml(metadata.documentName)}</strong></span></p>`;
  }
  if (metadata.assigneeName) {
    return `<p class="activity-detail-line"><i data-lucide="user-round" aria-hidden="true"></i><span>Người phụ trách: <strong>${escapeHtml(metadata.assigneeName)}</strong></span></p>`;
  }
  const changedLabels = activityChangedFieldLabels(item);
  if (changedLabels.length) {
    return `<div class="activity-change-block">
      <p class="activity-change-heading"><i data-lucide="pencil-line" aria-hidden="true"></i><span>Nội dung đã thay đổi</span></p>
      <ul class="activity-change-list" aria-label="Nội dung đã thay đổi">
        ${changedLabels.map((label) => `<li><i data-lucide="check" aria-hidden="true"></i><span>${escapeHtml(label)}</span></li>`).join("")}
      </ul>
    </div>`;
  }
  return "";
}

export function buildActivityTimelineMarkup(items, { hasMore = false } = {}) {
  if (!items?.length) {
    return `<div class="activity-empty"><i data-lucide="history" aria-hidden="true"></i><p>Chưa có lịch sử chỉnh sửa.</p></div>`;
  }
  return `<ol class="activity-timeline-list">
    ${items.map((item) => `<li class="activity-timeline-item">
      <span class="activity-avatar" aria-hidden="true">${escapeHtml(String(item.actorName || "?").trim().charAt(0).toUpperCase() || "?")}</span>
      <article class="activity-card">
        <header class="activity-card-header">
          <div class="activity-identity">
            <strong class="activity-actor">${escapeHtml(item.actorName || "Không xác định")}</strong>
            <span class="activity-action">${escapeHtml(ACTIVITY_LABELS[item.action] || item.action)}</span>
          </div>
          <time datetime="${escapeHtml(item.occurredAt || "")}"><i data-lucide="clock-3" aria-hidden="true"></i>${escapeHtml(formatActivityTime(item.occurredAt))}</time>
        </header>
        ${activityDetailMarkup(item)}
      </article>
    </li>`).join("")}
  </ol>${hasMore ? '<button type="button" class="btn btn-outline" data-activity-more>Xem thêm</button>' : ""}`;
}

const requestVersions = new WeakMap();

export async function renderActivityTimeline(container, {
  targetType,
  targetId,
  isCurrent = () => true,
} = {}) {
  if (!container) return;
  const requestVersion = (requestVersions.get(container) || 0) + 1;
  requestVersions.set(container, requestVersion);
  let items = [];
  let cursor = null;

  const load = async ({ append = false } = {}) => {
    if (!append) {
      container.innerHTML = trustedHTML('<div class="activity-loading" role="status"><span class="loading-spinner" aria-hidden="true"></span> Đang tải lịch sử chỉnh sửa...</div>');
    }
    const query = new URLSearchParams({ limit: "30" });
    if (cursor?.beforeOccurredAt && cursor?.beforeId) {
      query.set("beforeOccurredAt", cursor.beforeOccurredAt);
      query.set("beforeId", cursor.beforeId);
    }
    try {
      const data = await getJson(
        `/api/activities/${encodeURIComponent(targetType)}/${encodeURIComponent(targetId)}?${query}`,
        { retries: 0 },
      );
      if (requestVersions.get(container) !== requestVersion || !isCurrent()) return;
      items = append ? [...items, ...(data.items || [])] : (data.items || []);
      cursor = data.nextCursor || null;
      container.innerHTML = trustedHTML(buildActivityTimelineMarkup(items, { hasMore: Boolean(cursor) }));
      container.querySelector("[data-activity-more]")?.addEventListener("click", () => load({ append: true }));
      globalThis.lucide?.createIcons?.({ root: container });
    } catch (error) {
      if (requestVersions.get(container) !== requestVersion || !isCurrent()) return;
      container.innerHTML = trustedHTML(`<div class="activity-error" role="alert"><p>${escapeHtml(error?.message || "Không tải được lịch sử chỉnh sửa.")}</p><button type="button" class="btn btn-outline" data-activity-retry>Thử lại</button></div>`);
      container.querySelector("[data-activity-retry]")?.addEventListener("click", () => load());
    }
  };

  await load();
}
