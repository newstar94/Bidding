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
import { adminIconMarkup } from "./AdminIcons.js";

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

const SETTINGS_CATEGORIES = Object.freeze([
  ["application", "Application", "Cấu hình triển khai và vòng đời ứng dụng", "deployment"],
  ["registration", "Registration", "Đăng ký và xác minh người dùng", "deployment"],
  ["localization", "Localization", "Ngôn ngữ, múi giờ và định dạng vùng", "unsupported"],
  ["billing", "Billing", "Nhà cung cấp và chính sách thanh toán", "deployment"],
  ["documents", "Documents", "Worker và chính sách tạo tài liệu", "unsupported"],
  ["notifications", "Notifications", "Kênh gửi thông báo và hộp thư đi", "deployment"],
  ["storage", "Storage", "Kết nối và lưu trữ dữ liệu", "deployment"],
  ["sync", "Sync", "Đồng bộ, xung đột và thời gian thực", "deployment"],
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
    healthy: ["Khỏe mạnh", "success"],
    ready: ["Sẵn sàng", "success"],
    available: ["Khả dụng", "success"],
    degraded: ["Suy giảm", "warning"],
    incompatible: ["Không tương thích", "danger"],
    unavailable: ["Không khả dụng", "danger"],
    unknown: ["Chưa xác định", "secondary"],
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

function detailsCard(title, rows, { subtitle = "", icon = "" } = {}) {
  const content = rows.map(([label, value]) => `<tr><th scope="row">${escapeHtml(label)}</th><td>${value}</td></tr>`).join("");
  const heading = `${icon ? adminIconMarkup(icon, "bf-admin-section-icon") : ""}<span>${escapeHtml(title)}</span>`;
  return `<section class="card" aria-label="${escapeHtml(title)}"><div class="card-header"><div><h3 class="card-title bf-admin-section-title">${heading}</h3>${subtitle}</div></div><div class="table-responsive"><table class="table table-vcenter card-table bf-admin-operation-table"><tbody>${content}</tbody></table></div></section>`;
}

export function healthMarkup(payload) {
  if (!payload || typeof payload !== "object" || !payload.application || !payload.database) {
    return adminStateMarkup("empty", { message: "Chưa có dữ liệu trạng thái vận hành." });
  }
  const application = payload.application;
  const database = payload.database;
  const operations = payload.operations && typeof payload.operations === "object" ? payload.operations : {};
  const databasePool = operations.databasePool && typeof operations.databasePool === "object"
    ? operations.databasePool
    : {};
  const storage = operations.storage && typeof operations.storage === "object" ? operations.storage : {};
  const backup = operations.backup && typeof operations.backup === "object" ? operations.backup : {};
  const worker = operations.documentWorker && typeof operations.documentWorker === "object" ? operations.documentWorker : {};
  const websocket = operations.websocket && typeof operations.websocket === "object" ? operations.websocket : {};
  const analytics = operations.analytics && typeof operations.analytics === "object" ? operations.analytics : {};
  const databaseAnalytics = analytics.database && typeof analytics.database === "object" ? analytics.database : {};
  const syncAnalytics = analytics.sync && typeof analytics.sync === "object" ? analytics.sync : {};
  const resources = payload.resources && typeof payload.resources === "object" ? payload.resources : {};
  const backgroundJobs = Array.isArray(operations.backgroundJobs) ? operations.backgroundJobs : [];
  const backgroundSummary = backgroundJobs.length
    ? backgroundJobs.map((item) => `${text(item.queue)} · ${text(item.status)}: ${Number.isFinite(item.count) ? text(item.count) : "N/A"}`).join("<br>")
    : "Chưa có tác vụ trong hàng đợi";
  const resourceStatus = (name) => statusBadge(resources[name]?.status);
  return `<div class="row row-cards"><div class="col-lg-6">${detailsCard("Ứng dụng", [
    ["Trạng thái", resourceStatus("application")],
    ["Khởi động hoàn tất", text(yesNo(application.startupComplete))],
    ["Sẵn sàng phục vụ", text(yesNo(application.ready))],
    ["Độ trễ event loop", Number.isFinite(application.eventLoopLagMs) ? `${text(application.eventLoopLagMs)} ms` : "N/A"],
  ], { subtitle: generatedAtMarkup(payload.generatedAt) })}</div><div class="col-lg-6">${detailsCard("PostgreSQL", [
    ["Trạng thái", resourceStatus("postgresql")],
    ["Phiên bản PostgreSQL", database.version ? `PostgreSQL ${text(database.version)}` : "N/A"],
    ["Phiên bản schema", text(database.schemaVersion)],
    ["Độ trễ truy vấn trạng thái", Number.isFinite(database.latencyMs) ? `${text(database.latencyMs)} ms` : "N/A"],
    ["Yêu cầu DB", Number.isFinite(databaseAnalytics.requests) ? text(databaseAnalytics.requests) : "N/A"],
    ["Lỗi DB", Number.isFinite(databaseAnalytics.failures) ? text(databaseAnalytics.failures) : "N/A"],
    ["Độ trễ DB trung bình", Number.isFinite(databaseAnalytics.averageLatencyMs) ? `${text(databaseAnalytics.averageLatencyMs)} ms` : "N/A"],
    ["Dung lượng database", text(bytes(operations.databaseBytes))],
    ["Kết nối pool đang dùng", Number.isFinite(databasePool.pool_size) && Number.isFinite(databasePool.pool_available) ? text(Math.max(0, databasePool.pool_size - databasePool.pool_available)) : "N/A"],
    ["Kết nối pool khả dụng", Number.isFinite(databasePool.pool_available) ? text(databasePool.pool_available) : "N/A"],
    ["Yêu cầu chờ pool", Number.isFinite(databasePool.requests_waiting) ? text(databasePool.requests_waiting) : "N/A"],
    ["Khóa đang chờ", Number.isFinite(operations.waitingLocks) ? text(operations.waitingLocks) : "N/A"],
    ["WAL", text(bytes(operations.walBytes))],
  ])}</div><div class="col-lg-6">${detailsCard("Worker tài liệu", [
    ["Trạng thái", resourceStatus("documentWorker")],
    ["Đang xử lý", Number.isFinite(worker.active) ? text(worker.active) : "N/A"],
    ["Đang chờ", Number.isFinite(worker.waiting) ? text(worker.waiting) : "N/A"],
    ["Hoàn tất", Number.isFinite(worker.completed) ? text(worker.completed) : "N/A"],
    ["Lỗi", Number.isFinite(worker.failed) ? text(worker.failed) : "N/A"],
    ["Bị từ chối", Number.isFinite(worker.rejected) ? text(worker.rejected) : "N/A"],
  ])}</div><div class="col-lg-6">${detailsCard("Lưu trữ", [
    ["Trạng thái", resourceStatus("storage")],
    ["Data còn trống", text(bytes(storage.data?.freeBytes))],
    ["Tổng dung lượng data", text(bytes(storage.data?.totalBytes))],
    ["Backup còn trống", text(bytes(storage.backup?.freeBytes))],
    ["Tổng dung lượng backup", text(bytes(storage.backup?.totalBytes))],
  ])}</div><div class="col-lg-6">${detailsCard("WebSocket", [
    ["Trạng thái", resourceStatus("websocket")],
    ["Kết nối hoạt động", Number.isFinite(websocket.activeConnections) ? text(websocket.activeConnections) : "N/A"],
    ["Sự kiện đang chờ", Number.isFinite(websocket.pendingEvents) ? text(websocket.pendingEvents) : "N/A"],
    ["Tuổi sự kiện cũ nhất", Number.isFinite(websocket.oldestPendingSeconds) ? `${text(websocket.oldestPendingSeconds)} giây` : "N/A"],
  ])}</div><div class="col-lg-6">${detailsCard("Đồng bộ", [
    ["Trạng thái", resourceStatus("sync")],
    ["Yêu cầu đồng bộ", Number.isFinite(syncAnalytics.syncRequests) ? text(syncAnalytics.syncRequests) : "N/A"],
    ["Yêu cầu lỗi", Number.isFinite(syncAnalytics.failedSyncs) ? text(syncAnalytics.failedSyncs) : "N/A"],
    ["Yêu cầu toàn phần", Number.isFinite(syncAnalytics.fullSyncRequests) ? text(syncAnalytics.fullSyncRequests) : "N/A"],
  ])}</div><div class="col-lg-6">${detailsCard("Tác vụ nền", [
    ["Trạng thái", resourceStatus("backgroundJobs")],
    ["Tổng hợp hàng đợi", backgroundSummary],
  ])}</div><div class="col-lg-6">${detailsCard("Sao lưu", [
    ["Trạng thái", resourceStatus("backup")],
    ["Bản sao lưu đã xác minh gần nhất", timestamp(backup.lastVerifiedAt)],
    ["Lần diễn tập khôi phục gần nhất", timestamp(backup.lastRestoreDrillAt)],
    ["Lần kiểm tra trạng thái", timestamp(backup.checkedAt)],
  ])}</div></div>`;
}

export function environmentMarkup(payload) {
  if (!payload || typeof payload !== "object" || !payload.runtime || !payload.secretStatus) {
    return adminStateMarkup("empty", { message: "Chưa có dữ liệu cấu hình môi trường." });
  }
  const runtime = payload.runtime;
  const secretStatus = payload.secretStatus;
  const writable = payload.configuration?.writable === true;
  const secretRows = SECRET_FIELDS.map(([key, label]) => {
    const secret = secretStatus?.[key] && typeof secretStatus[key] === "object"
      ? secretStatus[key]
      : {};
    const configured = secret.configured === true;
    const state = configured ? "Đã cấu hình" : "Thiếu cấu hình";
    const tone = configured ? "success" : "warning";
    const canReplace = writable && secret.writable === true;
    const action = canReplace
      ? `<button class="btn btn-sm btn-outline-primary" type="button" data-admin-secret-replace="${escapeHtml(key)}">${configured ? "Thay thế" : "Cấu hình"}</button>`
      : '<span class="text-secondary small">Do hệ thống triển khai quản lý</span>';
    const source = text(secret.source, "Không xác định");
    const restart = secret.restartRequired === true ? "Cần khởi động lại" : "Không xác định";
    const updated = typeof secret.lastUpdated === "string" && secret.lastUpdated.trim()
      ? text(new Date(secret.lastUpdated).toLocaleString("vi-VN"))
      : "Chưa có dữ liệu";
    return `<tr><th scope="row">${escapeHtml(label)}<div class="text-secondary small"><code>${escapeHtml(key)}</code></div></th><td><span class="badge bg-${tone}-lt" data-admin-secret-status="${escapeHtml(key)}">${state}</span></td><td class="small text-secondary">${source}<br>${restart}<br>Cập nhật: ${updated}</td><td class="text-end">${action}</td></tr>`;
  }).join("");
  const configurationNotice = writable
    ? '<div class="alert alert-info" role="note">Có thể thay thế bí mật trong môi trường cục bộ. Giá trị hiện tại không bao giờ được hiển thị. Mọi thay đổi cần khởi động lại ứng dụng.</div>'
    : '<div class="alert alert-secondary" role="note">Môi trường này chỉ đọc. Hãy cập nhật bí mật bằng hệ thống cấu hình triển khai.</div>';
  return `${configurationNotice}<div class="row row-cards"><div class="col-12">${detailsCard("Môi trường chạy", [
    ["Môi trường", text(runtime.environment)],
    ["Chế độ tài nguyên giao diện", text(runtime.frontendAssetMode)],
    ["Chế độ gỡ lỗi", text(yesNo(runtime.debugEnabled))],
    ["Cookie bảo mật", text(yesNo(runtime.secureCookies))],
  ], { subtitle: generatedAtMarkup(payload.generatedAt), icon: "environment" })}</div><div class="col-12"><section class="card" aria-labelledby="secret-status-title"><div class="card-header"><div><h3 class="card-title bf-admin-section-title" id="secret-status-title">${adminIconMarkup("security", "bf-admin-section-icon")}<span>Cấu hình bí mật</span></h3><p class="text-secondary small mb-0">Chỉ hiển thị trạng thái; không đọc lại hoặc điền sẵn giá trị bí mật.</p></div></div><div class="table-responsive"><table class="table table-vcenter card-table bf-admin-operation-table"><tbody>${secretRows}</tbody></table></div><div class="card-footer"><div class="small" role="status" aria-live="polite" data-admin-environment-status></div></div></section></div></div>`;
}

export function settingsMarkup(payload) {
  if (!payload || typeof payload !== "object" || !payload.features) {
    return adminStateMarkup("empty", { message: "Chưa có dữ liệu cài đặt hệ thống." });
  }
  const features = payload.features;
  const writable = payload.configuration?.writable === true;
  const descriptions = {
    aiEnabled: "Cho phép sử dụng trợ lý AI trong các nghiệp vụ được hỗ trợ.",
    legalVersioningEnabled: "Bật quy trình quản lý phiên bản căn cứ pháp lý.",
    versionComparisonEnabled: "Cho phép đối chiếu thay đổi giữa các phiên bản.",
    paymentCheckoutEnabled: "Cho phép bắt đầu luồng thanh toán trực tuyến.",
  };
  const controls = FEATURE_FIELDS.map(([key, label]) => `<label class="form-check form-switch bf-admin-setting-row"><span class="bf-admin-setting-copy"><span class="form-check-label">${escapeHtml(label)}</span><span class="text-secondary small">${escapeHtml(descriptions[key])}</span></span><input class="form-check-input" type="checkbox" data-admin-feature="${escapeHtml(key)}"${features[key] === true ? " checked" : ""}${writable ? "" : " disabled"}></label>`).join("");
  const notice = writable
    ? "Thay đổi được lưu vào cấu hình cục bộ trên máy chủ và có hiệu lực sau khi khởi động lại."
    : "Môi trường này chỉ đọc; tính năng do hệ thống cấu hình triển khai quản lý.";
  // Keep deployment-managed configuration in the Environment screen. The
  // Settings screen is intentionally limited to feature flags so each control
  // has one canonical location and cannot drift from the runtime source.
  const categoryIcons = {
    application: "overview", registration: "security", localization: "settings",
    billing: "payments", documents: "invoices", notifications: "audit",
    storage: "environment", sync: "sync",
  };
  const categories = SETTINGS_CATEGORIES.map(([key, title, description, support]) => `<div class="col-12 col-lg-6"><section class="card h-100" data-admin-settings-category="${escapeHtml(key)}" data-admin-category-state="read-only"><div class="card-body"><div class="d-flex justify-content-between gap-3"><div><h3 class="card-title bf-admin-section-title">${adminIconMarkup(categoryIcons[key] || "settings", "bf-admin-section-icon")}<span>${escapeHtml(title)}</span></h3><p class="text-secondary small mb-2">${escapeHtml(description)}</p></div><span class="badge bg-secondary-lt text-dark align-self-start">${support === "unsupported" ? "Chưa hỗ trợ" : "Chỉ đọc"}</span></div><p class="text-secondary small mb-0">${support === "unsupported" ? "Chưa có kho cấu hình runtime có thẩm quyền." : "Do cấu hình triển khai quản lý; không chỉnh sửa tại trang này."}</p></div></section></div>`).join("");
  const featureFlags = `<div class="col-12"><section class="card bf-admin-settings-card" data-admin-settings-category="feature-flags" aria-labelledby="feature-settings-title"><form data-admin-settings-form><div class="card-header"><div><h3 class="card-title bf-admin-section-title" id="feature-settings-title">${adminIconMarkup("settings", "bf-admin-section-icon")}<span>Feature Flags · Tính năng hệ thống</span></h3><p class="text-secondary small mb-0">${escapeHtml(notice)}</p></div></div><div class="card-body bf-admin-settings-list">${controls}</div><div class="card-footer d-flex flex-wrap align-items-center gap-3"><button class="btn btn-primary" type="submit" data-admin-settings-save${writable ? "" : " disabled"}>Lưu cấu hình</button><div class="small" role="status" aria-live="polite" data-admin-settings-status>${writable ? "" : "Chỉ đọc"}</div></div></form></section></div>`;
  return `<div class="alert alert-info d-flex flex-wrap align-items-center justify-content-between gap-3" role="note"><span>Chỉ Feature Flags có kho cấu hình ghi được. Các nhóm khác phản ánh trạng thái triển khai hoặc điểm mở rộng chưa được hỗ trợ.</span><a class="btn btn-sm btn-outline-primary" href="/admin/environment" data-admin-link="/admin/environment">Quản lý biến môi trường</a></div><div class="row row-cards">${categories}${featureFlags}</div>`;
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

export async function confirmSecretReplacement(key, {
  requestConfirmation = requestAdminValue,
} = {}) {
  const confirmation = await requestConfirmation({
    title: "Xác nhận thay thế bí mật",
    message: `Thao tác này thay thế ${key} trên máy chủ và cần khởi động lại ứng dụng.`,
    label: `Nhập ${key} để xác nhận`,
    type: "text",
    autocomplete: "off",
  });
  return confirmation !== null && String(confirmation).trim() === key;
}

export function bindEnvironmentControls(root, payload, options = {}) {
  const status = root.querySelector?.("[data-admin-environment-status]");
  root.querySelectorAll?.("[data-admin-secret-replace]").forEach((button) => button.addEventListener("click", async () => {
    const key = String(button.dataset.adminSecretReplace || "");
    if (!SECRET_FIELDS.some(([candidate]) => candidate === key)) return;
    const confirmed = await confirmSecretReplacement(key, {
      requestConfirmation: options.requestConfirmation || requestAdminValue,
    });
    if (!confirmed) {
      updateStatus(status, "Đã hủy thao tác.");
      return;
    }
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
    ["Build SHA", text(payload.buildSha, "Chưa cấu hình")],
    ["Thời điểm build", text(payload.buildTime, "Chưa cấu hình")],
    ["Môi trường", text(payload.environment, "Không xác định")],
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
