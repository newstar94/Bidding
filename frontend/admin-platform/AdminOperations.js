import {
  getAdminJson,
  postAdminJson,
  requiresPrivilegedReauthentication,
} from "./AdminApi.js";
import { requestAdminValue } from "./AdminBilling.js";
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

function bytes(value) {
  if (!Number.isFinite(value) || value < 0) return "N/A";
  const units = ["B", "KB", "MB", "GB", "TB"];
  let amount = value; let unit = 0;
  while (amount >= 1024 && unit < units.length - 1) { amount /= 1024; unit += 1; }
  return `${amount.toLocaleString("vi-VN", { maximumFractionDigits: 1 })} ${units[unit]}`;
}

function timestamp(value) {
  if (!Number.isFinite(value) || value <= 0) return "N/A";
  return escapeHtml(new Date(value * 1000).toLocaleString("vi-VN"));
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
  const operations = payload.operations && typeof payload.operations === "object" ? payload.operations : {};
  const storage = operations.storage && typeof operations.storage === "object" ? operations.storage : {};
  const backup = operations.backup && typeof operations.backup === "object" ? operations.backup : {};
  const worker = operations.documentWorker && typeof operations.documentWorker === "object" ? operations.documentWorker : {};
  const websocket = operations.websocket && typeof operations.websocket === "object" ? operations.websocket : {};
  const backgroundJobs = Array.isArray(operations.backgroundJobs) ? operations.backgroundJobs : [];
  const backgroundSummary = backgroundJobs.length
    ? backgroundJobs.map((item) => `${text(item.queue)} · ${text(item.status)}: ${Number.isFinite(item.count) ? text(item.count) : "N/A"}`).join("<br>")
    : "Chưa có tác vụ trong hàng đợi";
  return `<div class="row row-cards"><div class="col-lg-6">${detailsCard("Ứng dụng", [
    ["Trạng thái", statusBadge(payload.status)],
    ["Khởi động hoàn tất", text(yesNo(application.startupComplete))],
    ["Sẵn sàng phục vụ", text(yesNo(application.ready))],
    ["Độ trễ event loop", Number.isFinite(application.eventLoopLagMs) ? `${text(application.eventLoopLagMs)} ms` : "N/A"],
  ], { subtitle: generatedAtMarkup(payload.generatedAt) })}</div><div class="col-lg-6">${detailsCard("Cơ sở dữ liệu", [
    ["Trạng thái", statusBadge(database.status)],
    ["Phiên bản schema", text(database.schemaVersion)],
    ["Dung lượng database", text(bytes(operations.databaseBytes))],
    ["Khóa đang chờ", Number.isFinite(operations.waitingLocks) ? text(operations.waitingLocks) : "N/A"],
    ["WAL", text(bytes(operations.walBytes))],
  ])}</div><div class="col-lg-6">${detailsCard("Lưu trữ", [
    ["Data còn trống", text(bytes(storage.data?.freeBytes))],
    ["Tổng dung lượng data", text(bytes(storage.data?.totalBytes))],
    ["Backup còn trống", text(bytes(storage.backup?.freeBytes))],
    ["Tổng dung lượng backup", text(bytes(storage.backup?.totalBytes))],
  ])}</div><div class="col-lg-6">${detailsCard("Sao lưu và khôi phục", [
    ["Bản sao lưu đã xác minh gần nhất", timestamp(backup.lastVerifiedAt)],
    ["Lần diễn tập khôi phục gần nhất", timestamp(backup.lastRestoreDrillAt)],
    ["Lần kiểm tra trạng thái", timestamp(backup.checkedAt)],
  ])}</div><div class="col-lg-6">${detailsCard("Worker tài liệu", [
    ["Đang xử lý", Number.isFinite(worker.active) ? text(worker.active) : "N/A"],
    ["Đang chờ", Number.isFinite(worker.waiting) ? text(worker.waiting) : "N/A"],
    ["Hoàn tất", Number.isFinite(worker.completed) ? text(worker.completed) : "N/A"],
    ["Lỗi", Number.isFinite(worker.failed) ? text(worker.failed) : "N/A"],
    ["Bị từ chối", Number.isFinite(worker.rejected) ? text(worker.rejected) : "N/A"],
  ])}</div><div class="col-lg-6">${detailsCard("Đồng bộ thời gian thực", [
    ["Kết nối WebSocket", Number.isFinite(websocket.activeConnections) ? text(websocket.activeConnections) : "N/A"],
    ["Sự kiện đang chờ", Number.isFinite(websocket.pendingEvents) ? text(websocket.pendingEvents) : "N/A"],
    ["Tuổi sự kiện cũ nhất", Number.isFinite(websocket.oldestPendingSeconds) ? `${text(websocket.oldestPendingSeconds)} giây` : "N/A"],
    ["Tác vụ nền", backgroundSummary],
  ])}</div></div>`;
}

export function environmentMarkup(payload) {
  if (!payload || typeof payload !== "object" || !payload.runtime || !payload.secretStatus) {
    return adminStateMarkup("empty", { message: "Chưa có dữ liệu cấu hình môi trường." });
  }
  const runtime = payload.runtime;
  const features = payload.features && typeof payload.features === "object" ? payload.features : {};
  const secretStatus = payload.secretStatus;
  const writable = payload.configuration?.writable === true;
  const secretRows = SECRET_FIELDS.map(([key, label]) => {
    const configured = secretStatus?.[key]?.configured === true;
    const state = configured ? "Đã cấu hình" : "Thiếu cấu hình";
    const tone = configured ? "success" : "warning";
    const canReplace = writable && secretStatus?.[key]?.writable === true;
    const action = canReplace
      ? `<button class="btn btn-sm btn-outline-primary" type="button" data-admin-secret-replace="${escapeHtml(key)}">${configured ? "Thay thế" : "Cấu hình"}</button>`
      : '<span class="text-secondary small">Do hệ thống triển khai quản lý</span>';
    return `<tr><th scope="row">${escapeHtml(label)}</th><td><span class="badge bg-${tone}-lt" data-admin-secret-status="${escapeHtml(key)}">${state}</span></td><td class="text-end">${action}</td></tr>`;
  }).join("");
  const configurationNotice = writable
    ? '<div class="alert alert-info" role="note">Có thể thay thế bí mật trong môi trường cục bộ. Giá trị hiện tại không bao giờ được hiển thị. Mọi thay đổi cần khởi động lại ứng dụng.</div>'
    : '<div class="alert alert-secondary" role="note">Môi trường này chỉ đọc. Hãy cập nhật bí mật bằng hệ thống cấu hình triển khai.</div>';
  return `${configurationNotice}<div class="row row-cards"><div class="col-lg-6">${detailsCard("Môi trường chạy", [
    ["Môi trường", text(runtime.environment)],
    ["Chế độ tài nguyên giao diện", text(runtime.frontendAssetMode)],
    ["Chế độ gỡ lỗi", text(yesNo(runtime.debugEnabled))],
    ["Cookie bảo mật", text(yesNo(runtime.secureCookies))],
  ], { subtitle: generatedAtMarkup(payload.generatedAt) })}</div><div class="col-lg-6">${detailsCard("Tính năng", FEATURE_FIELDS.map(([key, label]) => [label, text(yesNo(features[key]))]))}</div><div class="col-12"><section class="card" aria-labelledby="secret-status-title"><div class="card-header"><div><h3 class="card-title" id="secret-status-title">Cấu hình bí mật</h3><p class="text-secondary small mb-0">Chỉ hiển thị trạng thái; không đọc lại hoặc điền sẵn giá trị bí mật.</p></div></div><div class="table-responsive"><table class="table table-vcenter card-table bf-admin-operation-table"><tbody>${secretRows}</tbody></table></div><div class="card-footer"><div class="small" role="status" aria-live="polite" data-admin-environment-status></div></div></section></div></div>`;
}

export function settingsMarkup(payload) {
  if (!payload || typeof payload !== "object" || !payload.features) {
    return adminStateMarkup("empty", { message: "Chưa có dữ liệu cài đặt hệ thống." });
  }
  const features = payload.features;
  const writable = payload.configuration?.writable === true;
  const controls = FEATURE_FIELDS.map(([key, label]) => `<label class="form-check form-switch bf-admin-setting-row"><input class="form-check-input" type="checkbox" data-admin-feature="${escapeHtml(key)}"${features[key] === true ? " checked" : ""}${writable ? "" : " disabled"}><span class="form-check-label">${escapeHtml(label)}</span></label>`).join("");
  const notice = writable
    ? "Thay đổi được lưu vào cấu hình cục bộ trên máy chủ và có hiệu lực sau khi khởi động lại."
    : "Môi trường này chỉ đọc; tính năng do hệ thống cấu hình triển khai quản lý.";
  return `<div class="row row-cards"><div class="col-lg-8"><section class="card" aria-labelledby="feature-settings-title"><form data-admin-settings-form><div class="card-header"><div><h3 class="card-title" id="feature-settings-title">Tính năng hệ thống</h3><p class="text-secondary small mb-0">${escapeHtml(notice)}</p></div></div><div class="card-body bf-admin-settings-list">${controls}</div><div class="card-footer d-flex align-items-center gap-3"><button class="btn btn-primary" type="submit" data-admin-settings-save${writable ? "" : " disabled"}>Lưu cấu hình</button><div class="small" role="status" aria-live="polite" data-admin-settings-status>${writable ? "" : "Chỉ đọc"}</div></div></form></section></div></div>`;
}

function updateStatus(element, message, tone = "secondary") {
  if (!element) return;
  element.textContent = message;
  element.className = `small text-${tone}`;
}

async function privilegedEnvironmentUpdate(body, {
  fetchImpl,
  signal,
  requestPassword = () => requestAdminValue({
    title: "Xác thực thao tác quản trị",
    message: "Nhập lại mật khẩu để lưu cấu hình hệ thống.",
    label: "Mật khẩu hiện tại",
    type: "password",
  }),
} = {}) {
  const mutate = () => postAdminJson("/api/admin/environment", { body, fetchImpl, signal });
  try {
    return await mutate();
  } catch (error) {
    if (!requiresPrivilegedReauthentication(error)) throw error;
    const password = await requestPassword();
    if (password === null) return null;
    await postAdminJson("/api/auth/privileged-reauth", {
      body: { password }, fetchImpl, signal,
    });
    return mutate();
  }
}

export async function executeEnvironmentUpdate(body, options) {
  return privilegedEnvironmentUpdate(body, options);
}

export function bindEnvironmentControls(root, payload, options = {}) {
  const status = root.querySelector?.("[data-admin-environment-status]");
  root.querySelectorAll?.("[data-admin-secret-replace]").forEach((button) => button.addEventListener("click", async () => {
    const key = String(button.dataset.adminSecretReplace || "");
    if (!SECRET_FIELDS.some(([candidate]) => candidate === key)) return;
    const value = await (options.requestSecret || requestAdminValue)({
      title: "Thay thế bí mật cấu hình",
      message: "Giá trị mới được gửi thẳng tới máy chủ và không được hiển thị lại.",
      label: SECRET_FIELDS.find(([candidate]) => candidate === key)?.[1] || key,
      type: "password",
      autocomplete: "new-password",
    });
    if (value === null) return;
    button.disabled = true;
    updateStatus(status, "Đang lưu…");
    try {
      const result = await privilegedEnvironmentUpdate({ secrets: { [key]: value } }, options);
      updateStatus(status, result ? "Đã lưu trên máy chủ. Cần khởi động lại để áp dụng." : "Đã hủy thao tác.", result ? "success" : "secondary");
    } catch (error) {
      if (!options.signal?.aborted) updateStatus(status, error?.message || "Không thể lưu cấu hình.", "danger");
    } finally {
      button.disabled = false;
    }
  }));
}

export function bindSettingsControls(root, payload, options = {}) {
  const form = root.querySelector?.("[data-admin-settings-form]");
  if (!form || payload.configuration?.writable !== true) return;
  const save = root.querySelector?.("[data-admin-settings-save]");
  const status = root.querySelector?.("[data-admin-settings-status]");
  form.addEventListener("submit", async (event) => {
    event.preventDefault();
    const features = {};
    root.querySelectorAll?.("[data-admin-feature]").forEach((input) => {
      features[String(input.dataset.adminFeature)] = input.checked === true;
    });
    if (save) save.disabled = true;
    updateStatus(status, "Đang lưu…");
    try {
      const result = await privilegedEnvironmentUpdate({ features }, options);
      updateStatus(status, result ? "Đã lưu trên máy chủ. Cần khởi động lại để áp dụng." : "Đã hủy thao tác.", result ? "success" : "secondary");
    } catch (error) {
      if (!options.signal?.aborted) updateStatus(status, error?.message || "Không thể lưu cấu hình.", "danger");
    } finally {
      if (save) save.disabled = false;
    }
  });
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

async function renderOperation(container, path, markup, { fetchImpl, signal, bind } = {}) {
  renderAdminMarkup(container, adminLoadingMarkup(), { busy: true });
  try {
    const payload = await getAdminJson(path, { fetchImpl, signal });
    renderAdminMarkup(container, markup(payload));
    bind?.(container, payload, { fetchImpl, signal });
  } catch (error) {
    if (signal?.aborted) return;
    renderAdminFailure(container, error, () => renderOperation(container, path, markup, { fetchImpl, signal, bind }));
  }
}

export function renderAdminHealth(container, options) {
  return renderOperation(container, "/api/admin/health", healthMarkup, options);
}

export function renderAdminEnvironment(container, options) {
  return renderOperation(container, "/api/admin/environment", environmentMarkup, {
    ...options,
    bind: (root, payload, runtimeOptions) => bindEnvironmentControls(root, payload, { ...options, ...runtimeOptions }),
  });
}

export function renderAdminSettings(container, options) {
  return renderOperation(container, "/api/admin/environment", settingsMarkup, {
    ...options,
    bind: (root, payload, runtimeOptions) => bindSettingsControls(root, payload, { ...options, ...runtimeOptions }),
  });
}

export function renderAdminSystemVersion(container, options) {
  return renderOperation(container, "/api/admin/system/version", versionMarkup, options);
}
