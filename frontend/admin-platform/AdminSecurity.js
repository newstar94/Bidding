import { renderAdminDirectory } from "./AdminDirectory.js";
import { getAdminJson } from "./AdminApi.js";
import {
  adminLoadingMarkup,
  adminStateMarkup,
  renderAdminFailure,
  renderAdminMarkup,
} from "./AdminStateView.js";
import { escapeHtml } from "../shared/view_helpers.js";

function text(value, fallback = "N/A") {
  const normalized = String(value ?? "").trim();
  return escapeHtml(normalized || fallback);
}

function formatDateTime(value) {
  if (value === null || value === undefined || value === "") return "N/A";
  const source = typeof value === "number" ? value * 1_000 : value;
  const date = new Date(source);
  return Number.isNaN(date.valueOf()) ? "N/A" : escapeHtml(date.toLocaleString("vi-VN"));
}

function outcomeText(value) {
  const normalized = String(value || "").trim().toLowerCase();
  if (normalized === "success") return "Thành công";
  if (normalized === "failure") return "Thất bại";
  return "Unknown";
}

function auditTarget(item) {
  if (!item?.targetType && !item?.targetId) return "N/A";
  return `<div>${text(item.targetType)}</div><div class="small text-secondary">${text(item.targetId)}</div>`;
}

function sessionUser(item) {
  const user = item?.user;
  return `<div><strong>${text(user?.name)}</strong></div><div class="small text-secondary">${text(user?.email)}</div>`;
}

function detailRow(label, value, fallback = "N/A") {
  return `<tr><th scope="row">${escapeHtml(label)}</th><td>${text(value, fallback)}</td></tr>`;
}

function detailCard(title, body) {
  return `<section class="card mt-3" data-admin-security-detail tabindex="-1" aria-labelledby="admin-security-detail-title"><div class="card-header"><h3 class="card-title" id="admin-security-detail-title">${escapeHtml(title)}</h3><div class="card-actions"><button class="btn btn-sm btn-ghost-secondary" type="button" data-admin-security-detail-close>Đóng</button></div></div><div class="table-responsive"><table class="table table-vcenter card-table bf-admin-operation-table"><tbody>${body}</tbody></table></div></section>`;
}

export function auditDetailMarkup(item) {
  const details = item?.details && typeof item.details === "object"
    ? Object.entries(item.details).map(([key, value]) => detailRow(key, Array.isArray(value) ? value.join(", ") : value))
    : [];
  return detailCard("Chi tiết sự kiện nhật ký", [
    detailRow("Thời gian", formatDateTime(item?.createdAt)),
    detailRow("Hành động", item?.action),
    detailRow("Người thực hiện", item?.actorUserId, "Hệ thống"),
    detailRow("Tổ chức", item?.organizationId, "Toàn nền tảng"),
    detailRow("Loại đối tượng", item?.targetType),
    detailRow("Đối tượng", item?.targetId),
    detailRow("Kết quả", outcomeText(item?.result), "Unknown"),
    detailRow("Request ID", item?.requestId),
    detailRow("Chuỗi nhật ký", item?.chainId),
    detailRow("Thứ tự", item?.sequence),
    ...details,
  ].join(""));
}

export function sessionDetailMarkup(item) {
  const user = item?.user || {};
  return detailCard("Chi tiết phiên đăng nhập", [
    detailRow("Người dùng", user.name || user.username),
    detailRow("Tên đăng nhập", user.username),
    detailRow("Email", user.email),
    detailRow("Trạng thái tài khoản", user.status),
    detailRow("Vai trò nền tảng", user.platformRole),
    detailRow("Trạng thái phiên", item?.status),
    detailRow("Tạo lúc", formatDateTime(item?.createdAt)),
    detailRow("Hoạt động gần nhất", formatDateTime(item?.lastSeenAt)),
    detailRow("Hết hạn không hoạt động", formatDateTime(item?.idleExpiresAt)),
    detailRow("Hết hạn tuyệt đối", formatDateTime(item?.absoluteExpiresAt)),
    ...(item?.revokedAt ? [detailRow("Thu hồi lúc", formatDateTime(item.revokedAt))] : []),
    detailRow("Vai trò đang dùng", item?.activeRole, user.platformRole || "N/A"),
    detailRow("Tổ chức của vai trò", item?.activeRoleOrganizationId, "Không gian nền tảng"),
    detailRow("Ghi nhớ đăng nhập", item?.rememberMe === true ? "Có" : "Không"),
  ].join(""));
}

function bindSafeDetails(results, payload, markup) {
  results.querySelectorAll("[data-admin-security-detail-index]").forEach((button) => {
    button.addEventListener("click", () => {
      results.querySelector("[data-admin-security-detail]")?.remove();
      const item = payload?.items?.[Number(button.dataset.adminSecurityDetailIndex)];
      if (!item) return;
      const host = document.createElement("div");
      renderAdminMarkup(host, markup(item));
      const detail = host.firstElementChild;
      if (!detail) return;
      results.append(detail);
      detail.querySelector("[data-admin-security-detail-close]")?.addEventListener("click", () => {
        detail.remove();
        button.focus();
      });
      detail.focus({ preventScroll: true });
      detail.scrollIntoView({ block: "nearest" });
    });
  });
}

export const AUDIT_DIRECTORY = Object.freeze({
  endpoint: "/api/admin/audit",
  title: "Nhật ký quản trị",
  searchPlaceholder: "Hành động hoặc đối tượng",
  emptyMessage: "Không có sự kiện nhật ký phù hợp.",
  defaultSort: "created_at",
  defaultSortDir: "desc",
  sortKeys: ["created_at", "action", "target_type", "sequence"],
  filters: [
    {
      key: "action",
      label: "Hành động",
      placeholder: "Hành động",
      maxLength: 120,
    },
    { key: "targetType", label: "Loại đối tượng", placeholder: "Loại đối tượng", maxLength: 120 },
    { key: "actorUserId", label: "Người thực hiện", placeholder: "ID người thực hiện" },
    { key: "organizationId", label: "Tổ chức", placeholder: "ID tổ chức" },
    { key: "result", label: "Kết quả", allLabel: "Mọi kết quả", options: [["success", "Thành công"], ["failure", "Thất bại"], ["unknown", "Unknown"]] },
    { key: "requestId", label: "Request ID", placeholder: "Request ID", maxLength: 128 },
    { key: "from", label: "Từ ngày", type: "date" },
    { key: "to", label: "Đến ngày", type: "date" },
  ],
  columns: [
    { label: "Thời gian", sortKey: "created_at" },
    { label: "Hành động", sortKey: "action" },
    { label: "Đối tượng", sortKey: "target_type" },
    { label: "Người thực hiện" },
    { label: "Tổ chức" },
    { label: "Kết quả" },
    { label: "Request ID" },
    { label: "Chuỗi / thứ tự", sortKey: "sequence" },
    { label: "Chi tiết" },
  ],
  rowMarkup(item, index) {
    return `<tr><td data-label="Thời gian">${formatDateTime(item?.createdAt)}</td><td data-label="Hành động"><strong>${text(item?.action)}</strong></td><td data-label="Đối tượng">${auditTarget(item)}</td><td data-label="Người thực hiện">${text(item?.actorUserId, "Hệ thống")}</td><td data-label="Tổ chức">${text(item?.organizationId, "Toàn nền tảng")}</td><td data-label="Kết quả">${escapeHtml(outcomeText(item?.result))}</td><td data-label="Request ID">${text(item?.requestId)}</td><td data-label="Chuỗi / thứ tự"><div>${text(item?.chainId)}</div><div class="small text-secondary">#${text(item?.sequence)}</div></td><td data-label="Chi tiết"><button class="btn btn-sm btn-outline-secondary" type="button" data-admin-security-detail-index="${index}">Xem</button></td></tr>`;
  },
  bindResultActions(results, { payload }) { bindSafeDetails(results, payload, auditDetailMarkup); },
});

export const SESSION_DIRECTORY = Object.freeze({
  endpoint: "/api/admin/security/sessions",
  title: "Phiên đăng nhập",
  searchPlaceholder: "Tên, tài khoản hoặc email",
  emptyMessage: "Không có phiên đăng nhập phù hợp.",
  defaultSort: "last_seen_at",
  defaultSortDir: "desc",
  sortKeys: ["created_at", "last_seen_at", "absolute_expires_at", "user"],
  filters: [
    {
      key: "status",
      label: "Trạng thái phiên",
      allLabel: "Mọi trạng thái",
      options: [["active", "Đang hoạt động"], ["expired", "Đã hết hạn"], ["revoked", "Đã thu hồi"]],
    },
  ],
  columns: [
    { label: "Người dùng", sortKey: "user" },
    { label: "Trạng thái" },
    { label: "Hoạt động gần nhất", sortKey: "last_seen_at" },
    { label: "Hết hạn tuyệt đối", sortKey: "absolute_expires_at" },
    { label: "Vai trò đang dùng" },
    { label: "Ghi nhớ đăng nhập" },
    { label: "Chi tiết" },
  ],
  rowMarkup(item, index) {
    return `<tr><td data-label="Người dùng">${sessionUser(item)}</td><td data-label="Trạng thái">${text(item?.status)}</td><td data-label="Hoạt động gần nhất">${formatDateTime(item?.lastSeenAt)}</td><td data-label="Hết hạn tuyệt đối">${formatDateTime(item?.absoluteExpiresAt)}</td><td data-label="Vai trò đang dùng"><div>${text(item?.activeRole, item?.user?.platformRole || "N/A")}</div><div class="small text-secondary">${text(item?.activeRoleOrganizationId, "Không gian nền tảng")}</div></td><td data-label="Ghi nhớ đăng nhập">${item?.rememberMe === true ? "Có" : "Không"}</td><td data-label="Chi tiết"><button class="btn btn-sm btn-outline-secondary" type="button" data-admin-security-detail-index="${index}">Xem</button></td></tr>`;
  },
  bindResultActions(results, { payload }) { bindSafeDetails(results, payload, sessionDetailMarkup); },
});

export function renderAdminAudit(container, options) {
  return renderAdminDirectory(container, AUDIT_DIRECTORY, options);
}

const SECURITY_SECTIONS = Object.freeze([
  ["failedLogins", "Đăng nhập thất bại", "Các lần đăng nhập hoặc xác thực lại thất bại đã có bằng chứng audit."],
  ["suspiciousEvents", "Sự kiện đáng chú ý", "Các sự kiện được hệ thống ghi rõ là giới hạn, chặn hoặc đáng ngờ."],
  ["authorizationDenies", "Từ chối quyền", "Các sự kiện audit có hành động từ chối hoặc loại bỏ yêu cầu."],
  ["adminActions", "Thao tác quản trị", "Các thao tác có hành động audit bắt đầu bằng admin."],
]);

function securityEventRows(items) {
  return items.map((item) => `<tr><td data-label="Thời gian">${formatDateTime(item?.createdAt)}</td><td data-label="Hành động"><strong>${text(item?.action)}</strong><div class="small text-secondary">${text(item?.targetType)} · ${text(item?.targetId)}</div></td><td data-label="Người thực hiện">${text(item?.actorUserId, "Hệ thống")}</td><td data-label="Kết quả">${escapeHtml(outcomeText(item?.outcome))}</td></tr>`).join("");
}

export function securityCenterMarkup(payload) {
  const counts = payload?.counts && typeof payload.counts === "object" ? payload.counts : {};
  const sections = payload?.sections && typeof payload.sections === "object" ? payload.sections : {};
  const cards = SECURITY_SECTIONS.map(([key, title]) => `<div class="col-sm-6 col-xl-3"><article class="card h-100"><div class="card-body"><div class="text-secondary">${escapeHtml(title)}</div><div class="h2 mb-0 mt-2" data-admin-security-count="${key}">${Number.isFinite(counts[key]) ? escapeHtml(new Intl.NumberFormat("vi-VN").format(counts[key])) : "N/A"}</div><div class="small text-secondary mt-2">24 giờ gần nhất</div></div></article></div>`).join("");
  const sectionMarkup = SECURITY_SECTIONS.map(([key, title, description]) => {
    const items = Array.isArray(sections[key]) ? sections[key] : [];
    const content = items.length
      ? `<div class="table-responsive"><table class="table table-vcenter card-table"><thead><tr><th scope="col">Thời gian</th><th scope="col">Hành động</th><th scope="col">Người thực hiện</th><th scope="col">Kết quả</th></tr></thead><tbody>${securityEventRows(items)}</tbody></table></div>`
      : adminStateMarkup("empty", { message: "Không có sự kiện audit phù hợp trong 24 giờ gần nhất." });
    return `<section class="card" aria-labelledby="security-${key}-title"><div class="card-header"><div><h3 class="card-title" id="security-${key}-title">${escapeHtml(title)}</h3><p class="text-secondary small mb-0">${escapeHtml(description)}</p></div></div>${content}</section>`;
  }).join("");
  const coverageNote = payload?.coverage?.note
    ? `<div class="alert alert-info" role="note"><strong>Phạm vi dữ liệu:</strong> ${escapeHtml(payload.coverage.note)}</div>`
    : "";
  return `<section aria-labelledby="security-center-title"><div class="d-flex flex-wrap align-items-start justify-content-between gap-3 mb-3"><div><h2 class="h3 mb-1" id="security-center-title">Trung tâm bảo mật</h2><p class="text-secondary mb-0">Sự kiện có bằng chứng từ audit log; kết quả không có bằng chứng được ghi là Unknown.</p></div><a class="btn btn-outline-primary" href="/admin/audit">Mở toàn bộ nhật ký</a></div>${coverageNote}<div class="row row-cards">${cards}</div><div class="vstack gap-3 mt-4">${sectionMarkup}</div></section><div class="mt-4" data-admin-security-sessions></div>`;
}

export async function renderAdminSecurity(container, { fetchImpl, signal } = {}) {
  renderAdminMarkup(container, adminLoadingMarkup("Đang tải trung tâm bảo mật…"), { busy: true });
  try {
    const payload = await getAdminJson("/api/admin/security/summary", { fetchImpl, signal });
    if (signal?.aborted) return;
    renderAdminMarkup(container, securityCenterMarkup(payload));
    const sessions = container.querySelector("[data-admin-security-sessions]");
    if (sessions) await renderAdminDirectory(sessions, SESSION_DIRECTORY, { fetchImpl, signal });
  } catch (error) {
    if (signal?.aborted) return;
    renderAdminFailure(container, error, () => renderAdminSecurity(container, { fetchImpl, signal }));
  }
}
