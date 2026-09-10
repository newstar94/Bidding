import { getAdminJson } from "./AdminApi.js";
import {
  adminLoadingMarkup,
  adminStateMarkup,
  renderAdminFailure,
  renderAdminMarkup,
} from "./AdminStateView.js";
import { escapeHtml } from "../shared/view_helpers.js";

const SECRET_FIELDS = Object.freeze([
  ["DATABASE_URL", "Kết nối cơ sở dữ liệu"],
  ["OTP_HMAC_KEY", "Khóa xác thực OTP"],
  ["EMAIL_OUTBOX_ENCRYPTION_KEY", "Mã hóa hộp thư đi"],
  ["CONFLICT_DRAFT_ENCRYPTION_KEY", "Mã hóa bản nháp xung đột"],
  ["AUDIT_CHECKPOINT_HMAC_KEY", "Khóa kiểm tra nhật ký"],
  ["ANALYTICS_HMAC_KEY", "Khóa phân tích sản phẩm"],
  ["TURNSTILE_SECRET_KEY", "Khóa Turnstile"],
  ["PAYOS_CLIENT_ID", "Định danh payOS"],
  ["PAYOS_API_KEY", "Khóa API payOS"],
  ["PAYOS_CHECKSUM_KEY", "Khóa checksum payOS"],
]);

const FEATURE_FIELDS = Object.freeze([
  ["aiEnabled", "Trợ lý AI"],
  ["legalVersioningEnabled", "Phiên bản pháp lý"],
  ["versionComparisonEnabled", "So sánh phiên bản"],
  ["paymentCheckoutEnabled", "Thanh toán trực tuyến"],
]);

function text(value, fallback = "N/A") {
  const normalized = typeof value === "string" || typeof value === "number"
    ? String(value).trim()
    : "";
  return escapeHtml(normalized || fallback);
}

function yesNo(value) {
  if (value === true) return "Bật";
  if (value === false) return "Tắt";
  return "N/A";
}

function statusBadge(status) {
  const normalized = String(status || "").trim().toLowerCase();
  const statusMap = {
    ready: ["Sẵn sàng", "success"],
    available: ["Khả dụng", "success"],
    degraded: ["Suy giảm", "warning"],
    incompatible: ["Không tương thích", "danger"],
    unavailable: ["Không khả dụng", "danger"],
  };
  const [label, tone] = statusMap[normalized] || ["N/A", "secondary"];
  return `<span class="badge bg-${tone}-lt">${label}</span>`;
}

function generatedAtMarkup(value) {
  if (typeof value !== "string" || !value.trim()) return "";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "";
  return `<p class="text-secondary small mb-0">Cập nhật: ${escapeHtml(date.toLocaleString("vi-VN"))}</p>`;
}

function detailsCard(title, rows, { subtitle = "" } = {}) {
  const content = rows.map(([label, value]) => `<tr><th scope="row">${escapeHtml(label)}</th><td>${value}</td></tr>`).join("");
  return `<section class="card" aria-label="${escapeHtml(title)}"><div class="card-header"><div><h3 class="card-title">${escapeHtml(title)}</h3>${subtitle}</div></div><div class="table-responsive"><table class="table table-vcenter card-table bf-admin-operation-table"><tbody>${content}</tbody></table></div></section>`;
}

export function healthMarkup(payload) {
  if (!payload || typeof payload !== "object" || !payload.application || !payload.database) {
    return adminStateMarkup("empty", { message: "Chưa có dữ liệu trạng thái vận hành." });
  }
  const application = payload.application;
  const database = payload.database;
  return `<div class="row row-cards"><div class="col-lg-6">${detailsCard("Ứng dụng", [
    ["Trạng thái", statusBadge(payload.status)],
    ["Khởi động hoàn tất", text(yesNo(application.startupComplete))],
    ["Sẵn sàng phục vụ", text(yesNo(application.ready))],
    ["Độ trễ event loop", Number.isFinite(application.eventLoopLagMs) ? `${text(application.eventLoopLagMs)} ms` : "N/A"],
  ], { subtitle: generatedAtMarkup(payload.generatedAt) })}</div><div class="col-lg-6">${detailsCard("Cơ sở dữ liệu", [
    ["Trạng thái", statusBadge(database.status)],
    ["Phiên bản schema", text(database.schemaVersion)],
  ])}</div></div>`;
}

export function environmentMarkup(payload) {
  if (!payload || typeof payload !== "object" || !payload.runtime || !payload.secretStatus) {
    return adminStateMarkup("empty", { message: "Chưa có dữ liệu cấu hình môi trường." });
  }
  const runtime = payload.runtime;
  const features = payload.features && typeof payload.features === "object" ? payload.features : {};
  const secretStatus = payload.secretStatus;
  const secretRows = SECRET_FIELDS.map(([key, label]) => {
    const configured = secretStatus?.[key]?.configured === true;
    const state = configured ? "Đã cấu hình" : "Thiếu cấu hình";
    const tone = configured ? "success" : "warning";
    return `<tr><th scope="row">${escapeHtml(label)}</th><td><span class="badge bg-${tone}-lt" data-admin-secret-status="${escapeHtml(key)}">${state}</span></td></tr>`;
  }).join("");
  return `<div class="row row-cards"><div class="col-lg-6">${detailsCard("Môi trường chạy", [
    ["Môi trường", text(runtime.environment)],
    ["Chế độ tài nguyên giao diện", text(runtime.frontendAssetMode)],
    ["Chế độ gỡ lỗi", text(yesNo(runtime.debugEnabled))],
    ["Cookie bảo mật", text(yesNo(runtime.secureCookies))],
  ], { subtitle: generatedAtMarkup(payload.generatedAt) })}</div><div class="col-lg-6">${detailsCard("Tính năng", FEATURE_FIELDS.map(([key, label]) => [label, text(yesNo(features[key]))]))}</div><div class="col-12"><section class="card" aria-labelledby="secret-status-title"><div class="card-header"><div><h3 class="card-title" id="secret-status-title">Trạng thái bí mật</h3><p class="text-secondary small mb-0">Chỉ hiển thị đã cấu hình hoặc thiếu cấu hình.</p></div></div><div class="table-responsive"><table class="table table-vcenter card-table bf-admin-operation-table"><tbody>${secretRows}</tbody></table></div></section></div></div>`;
}

export function versionMarkup(payload) {
  if (!payload || typeof payload !== "object") {
    return adminStateMarkup("empty", { message: "Chưa có dữ liệu phiên bản hệ thống." });
  }
  return detailsCard("Thông tin phát hành", [
    ["Phiên bản ứng dụng", text(payload.applicationVersion)],
    ["Mã phát hành", text(payload.releaseId, "Chưa cấu hình")],
    ["Phiên bản bundle giao diện", text(payload.frontendBundleVersion, "Chưa cấu hình")],
    ["Phiên bản schema đang chạy", text(payload.schemaVersion)],
    ["Phiên bản schema yêu cầu", text(payload.expectedSchemaVersion)],
    ["Tương thích schema", statusBadge(payload.schemaStatus)],
  ], { subtitle: generatedAtMarkup(payload.generatedAt) });
}

async function renderOperation(container, path, markup, { fetchImpl, signal } = {}) {
  renderAdminMarkup(container, adminLoadingMarkup(), { busy: true });
  try {
    const payload = await getAdminJson(path, { fetchImpl, signal });
    renderAdminMarkup(container, markup(payload));
  } catch (error) {
    if (signal?.aborted) return;
    renderAdminFailure(container, error, () => renderOperation(container, path, markup, { fetchImpl, signal }));
  }
}

export function renderAdminHealth(container, options) {
  return renderOperation(container, "/api/admin/health", healthMarkup, options);
}

export function renderAdminEnvironment(container, options) {
  return renderOperation(container, "/api/admin/environment", environmentMarkup, options);
}

export function renderAdminSystemVersion(container, options) {
  return renderOperation(container, "/api/admin/system/version", versionMarkup, options);
}

