import { renderAdminDirectory } from "./AdminDirectory.js";
import { getAdminJson, postAdminJson, requiresPrivilegedReauthentication } from "./AdminApi.js";
import { requestAdminValue } from "./AdminBilling.js";
import { adminLoadingMarkup, adminStateMarkup } from "./AdminStateView.js";
import { escapeHtml } from "../shared/view_helpers.js";
import { trustedHTML } from "../shared/trustedTypes.js";
import { trapAdminDialogFocus } from "./AdminFocusTrap.js";

function text(value, fallback = "N/A") {
  const normalized = String(value ?? "").trim();
  return escapeHtml(normalized || fallback);
}

function formatDate(value) {
  if (value === null || value === undefined || value === "") return "N/A";
  const source = typeof value === "number" ? value * 1_000 : value;
  const date = new Date(source);
  return Number.isNaN(date.valueOf()) ? text(value) : escapeHtml(date.toLocaleString("vi-VN"));
}

function progressMarkup(progress) {
  const completed = Number(progress?.completedItems);
  const total = Number(progress?.totalItems);
  if (!Number.isFinite(completed) || !Number.isFinite(total) || total < 1) return "N/A";
  return `<strong>${escapeHtml(completed)}/${escapeHtml(total)}</strong><div class="small text-secondary">${text(progress?.phase)}</div>`;
}

function summaryCards(items) {
  return `<div class="row row-cards mb-3">${items.map(([key, label, value]) => `<div class="col-sm-6 col-xl-3"><article class="card h-100"><div class="card-body"><div class="text-secondary">${escapeHtml(label)}</div><div class="h2 mb-0 mt-2" data-admin-system-metric="${escapeHtml(key)}">${Number.isFinite(value) ? escapeHtml(new Intl.NumberFormat("vi-VN").format(value)) : "N/A"}</div></div></article></div>`).join("")}</div>`;
}

export function jobSummaryMarkup(summary) {
  const byStatus = summary?.byStatus && typeof summary.byStatus === "object" ? summary.byStatus : {};
  return summaryCards([
    ["jobs-total", "Tổng tác vụ", summary?.total],
    ["jobs-pending", "Đang chờ", byStatus.pending],
    ["jobs-processing", "Đang xử lý", byStatus.processing],
    ["jobs-failed", "Thất bại", byStatus.failed],
  ]);
}

export function jobDetailMarkup(payload) {
  const job = payload?.job;
  if (!job || typeof job !== "object") {
    return adminStateMarkup("empty", { message: "Chưa có chi tiết tác vụ." });
  }
  const retry = job.retryAllowed === true
    ? `<button class="btn btn-primary" type="button" data-admin-job-retry="${text(job.id, "")}">Chạy lại tác vụ</button>`
    : '<span class="text-secondary small">Tác vụ này không thể chạy lại.</span>';
  return `<div class="offcanvas-header"><div><div class="text-secondary small">Tác vụ ${text(job.id)}</div><h2 class="offcanvas-title">${text(job.operation)}</h2></div><button class="btn-close" type="button" aria-label="Đóng" data-admin-job-detail-close></button></div><div class="offcanvas-body"><dl class="row"><dt class="col-5">Tổ chức</dt><dd class="col-7">${text(job.organizationId)}</dd><dt class="col-5">Loại bản ghi</dt><dd class="col-7">${text(job.recordType)}</dd><dt class="col-5">Trạng thái</dt><dd class="col-7">${text(job.status)}</dd><dt class="col-5">Tiến độ</dt><dd class="col-7">${progressMarkup(job.progress)}</dd><dt class="col-5">Số lần thử</dt><dd class="col-7">${Number.isFinite(job.attemptCount) ? escapeHtml(job.attemptCount) : "N/A"}</dd><dt class="col-5">Tạo lúc</dt><dd class="col-7">${formatDate(job.createdAt)}</dd><dt class="col-5">Cập nhật</dt><dd class="col-7">${formatDate(job.updatedAt)}</dd><dt class="col-5">Hoàn tất</dt><dd class="col-7">${formatDate(job.completedAt)}</dd><dt class="col-5">Hết hạn</dt><dd class="col-7">${formatDate(job.expiresAt)}</dd><dt class="col-5">Mã lỗi</dt><dd class="col-7">${text(job.error?.code)}</dd><dt class="col-5">Chi tiết lỗi đã khử nhạy cảm</dt><dd class="col-7 text-break">${text(job.error?.message)}</dd></dl><div class="btn-list">${retry}</div><div class="mt-3 small" role="status" aria-live="polite" data-admin-job-retry-status></div></div>`;
}

async function defaultRetryConfirmation(jobId) {
  const value = await requestAdminValue({
    title: "Xác nhận chạy lại tác vụ",
    message: "Worker sẽ kiểm tra lại quyền xuất tài liệu và phạm vi bản ghi của chủ tác vụ trước khi xếp hàng.",
    label: `Nhập ${jobId} để xác nhận`,
    autocomplete: "off",
  });
  return value !== null && String(value).trim() === jobId;
}

export async function executeJobRetry(jobId, {
  fetchImpl,
  signal,
  confirmImpl = defaultRetryConfirmation,
  requestPassword = () => requestAdminValue({
    title: "Xác thực thao tác quản trị",
    message: "Nhập lại mật khẩu để chạy lại tác vụ tài liệu.",
    label: "Mật khẩu hiện tại",
    type: "password",
  }),
} = {}) {
  const normalized = String(jobId || "").trim().toLowerCase();
  if (!/^[a-f0-9]{32}$/u.test(normalized)) throw new TypeError("Job ID is invalid");
  if (!await confirmImpl(normalized)) return { cancelled: true };
  const mutate = () => postAdminJson(`/api/admin/system/jobs/${normalized}/retry`, {
    body: {}, fetchImpl, signal,
  });
  try {
    return { payload: await mutate() };
  } catch (error) {
    if (!requiresPrivilegedReauthentication(error)) throw error;
    const password = await requestPassword();
    if (password === null) return { cancelled: true };
    await postAdminJson("/api/auth/privileged-reauth", {
      body: { password }, fetchImpl, signal,
    });
    return { payload: await mutate() };
  }
}

function openJobDetail(opener) {
  document.querySelector("[data-admin-job-detail]")?.remove();
  document.querySelector("[data-admin-job-detail-backdrop]")?.remove();
  const drawer = document.createElement("aside");
  drawer.className = "offcanvas offcanvas-end show";
  drawer.tabIndex = -1;
  drawer.setAttribute("role", "dialog");
  drawer.setAttribute("aria-modal", "true");
  drawer.setAttribute("aria-label", "Chi tiết tác vụ");
  drawer.setAttribute("data-admin-job-detail", "");
  drawer.style.visibility = "visible";
  const backdrop = document.createElement("div");
  backdrop.className = "offcanvas-backdrop fade show";
  backdrop.setAttribute("data-admin-job-detail-backdrop", "");
  document.body.append(drawer, backdrop);
  let closed = false;
  let releaseFocusTrap = () => {};
  const close = () => {
    if (closed) return;
    closed = true;
    releaseFocusTrap();
    drawer.remove(); backdrop.remove(); opener?.focus?.();
  };
  backdrop.addEventListener("click", close);
  releaseFocusTrap = trapAdminDialogFocus(drawer, { onEscape: close });
  return { drawer, close };
}

function bindJobActions(root, jobs, options) {
  root.querySelectorAll("[data-admin-job-detail-id]").forEach((button) => button.addEventListener("click", async () => {
    const jobId = String(button.dataset.adminJobDetailId || "");
    if (!jobs.some((job) => job?.id === jobId)) return;
    const detail = openJobDetail(button);
    detail.drawer.innerHTML = trustedHTML(`<div class="offcanvas-header"><h2 class="offcanvas-title">Đang tải chi tiết</h2><button class="btn-close" type="button" aria-label="Đóng" data-admin-job-detail-close></button></div><div class="offcanvas-body">${adminLoadingMarkup("Đang tải chi tiết tác vụ…")}</div>`);
    detail.drawer.querySelector("[data-admin-job-detail-close]")?.addEventListener("click", detail.close);
    try {
      const payload = await getAdminJson(`/api/admin/system/jobs/${encodeURIComponent(jobId)}`, options);
      detail.drawer.innerHTML = trustedHTML(jobDetailMarkup(payload));
      detail.drawer.querySelector("[data-admin-job-detail-close]")?.addEventListener("click", detail.close);
      const retry = detail.drawer.querySelector("[data-admin-job-retry]");
      retry?.addEventListener("click", async () => {
        const status = detail.drawer.querySelector("[data-admin-job-retry-status]");
        retry.disabled = true;
        if (status) { status.textContent = "Đang gửi yêu cầu…"; status.className = "mt-3 small text-secondary"; }
        try {
          const result = await executeJobRetry(jobId, options);
          if (status) {
            status.textContent = result.cancelled ? "Đã hủy thao tác." : "Máy chủ đã xếp hàng chạy lại tác vụ.";
            status.className = `mt-3 small text-${result.cancelled ? "secondary" : "success"}`;
          }
          if (!result.cancelled) { retry.remove(); await options.reload?.(); }
        } catch (error) {
          if (options.signal?.aborted) return;
          retry.disabled = false;
          if (status) { status.textContent = error?.message || "Không thể chạy lại tác vụ."; status.className = "mt-3 small text-danger"; }
        }
      });
      detail.drawer.querySelector("[data-admin-job-detail-close]")?.focus();
    } catch (error) {
      if (options.signal?.aborted) return detail.close();
      detail.drawer.innerHTML = trustedHTML(`<div class="offcanvas-header"><h2 class="offcanvas-title">Không thể tải chi tiết</h2><button class="btn-close" type="button" aria-label="Đóng" data-admin-job-detail-close></button></div><div class="offcanvas-body">${adminStateMarkup(error?.status === 403 ? "permission" : "error", { message: error?.message })}</div>`);
      detail.drawer.querySelector("[data-admin-job-detail-close]")?.addEventListener("click", detail.close);
    }
  }));
}

export function syncSummaryMarkup(summary) {
  const byStatus = summary?.eventsByStatus && typeof summary.eventsByStatus === "object"
    ? summary.eventsByStatus
    : {};
  return `${summaryCards([
    ["sync-events", "Tổng sự kiện", summary?.eventsTotal],
    ["sync-failed", "Sự kiện lỗi", (byStatus.retry || 0) + (byStatus.dead_letter || 0)],
    ["sync-connections", "Kết nối hoạt động", summary?.activeConnections],
    ["sync-mutations", "Mutation đã ghi nhận", summary?.recordedMutations],
    ["sync-row-conflicts", "Xung đột phiên bản", summary?.rowVersionConflicts],
    ["sync-visibility-resets", "Thu hồi hiển thị", summary?.visibilityResets],
    ["sync-full-resets", "Đồng bộ toàn phần", summary?.fullSyncs],
    ["sync-outbox-failures", "Lỗi outbox", summary?.outboxFailures],
  ])}<p class="text-secondary small">Các chỉ số không được hệ thống lưu có thẩm quyền hiển thị N/A; không suy diễn từ log hoặc dữ liệu riêng tư.</p>`;
}

export const JOB_DIRECTORY = Object.freeze({
  endpoint: "/api/admin/system/jobs",
  title: "Tác vụ",
  searchPlaceholder: "Lọc theo loại tác vụ",
  searchQueryKey: "operation",
  emptyMessage: "Không có tác vụ phù hợp với bộ lọc.",
  defaultSort: "created_at",
  defaultSortDir: "desc",
  sortKeys: ["created_at", "updated_at", "available_at", "status", "attempt_count"],
  summaryMarkup: jobSummaryMarkup,
  filters: [
    { key: "status", label: "Trạng thái", allLabel: "Mọi trạng thái", options: [["pending", "Đang chờ"], ["processing", "Đang xử lý"], ["retry", "Chờ thử lại"], ["completed", "Hoàn thành"], ["failed", "Thất bại"]] },
  ],
  columns: [
    { label: "Tác vụ" }, { label: "Tổ chức" },
    { label: "Trạng thái", sortKey: "status" }, { label: "Tiến độ" },
    { label: "Lần thử", sortKey: "attempt_count" }, { label: "Lỗi cuối" },
    { label: "Cập nhật", sortKey: "updated_at" }, { label: "Chi tiết" },
  ],
  rowMarkup(job) {
    return `<tr><td data-label="Tác vụ"><strong>${text(job?.operation)}</strong><div class="small text-secondary">${text(job?.id)} · ${text(job?.recordType)}</div></td><td data-label="Tổ chức">${text(job?.organizationId)}</td><td data-label="Trạng thái">${text(job?.status)}</td><td data-label="Tiến độ">${progressMarkup(job?.progress)}</td><td data-label="Lần thử">${Number.isFinite(job?.attemptCount) ? escapeHtml(job.attemptCount) : "N/A"}</td><td data-label="Lỗi cuối">${text(job?.lastErrorCode)}</td><td data-label="Cập nhật">${formatDate(job?.updatedAt)}</td><td data-label="Chi tiết"><button class="btn btn-sm btn-outline-primary" type="button" data-admin-job-detail-id="${text(job?.id, "")}">Xem và thao tác</button></td></tr>`;
  },
  bindResultActions(root, options) { bindJobActions(root, options.payload?.items || [], options); },
});

export const SYNC_DIRECTORY = Object.freeze({
  endpoint: "/api/admin/system/sync",
  title: "Đồng bộ",
  searchPlaceholder: "",
  hideSearch: true,
  emptyMessage: "Không có sự kiện đồng bộ phù hợp với bộ lọc.",
  defaultSort: "created_at",
  defaultSortDir: "desc",
  sortKeys: ["created_at", "available_at", "status", "attempt_count"],
  summaryMarkup: syncSummaryMarkup,
  filters: [
    { key: "status", label: "Trạng thái", allLabel: "Mọi trạng thái", options: [["pending", "Đang chờ"], ["retry", "Chờ thử lại"], ["dispatched", "Đã phát"], ["dead_letter", "Lỗi vĩnh viễn"]] },
    { key: "eventType", label: "Loại sự kiện", allLabel: "Mọi sự kiện", options: [["broadcast", "Phát tới tổ chức"], ["revoke_user", "Thu hồi người dùng"]] },
  ],
  columns: [
    { label: "Sự kiện" }, { label: "Tổ chức" },
    { label: "Trạng thái", sortKey: "status" },
    { label: "Lần thử", sortKey: "attempt_count" },
    { label: "Sẵn sàng", sortKey: "available_at" },
    { label: "Đã phát" }, { label: "Lỗi cuối" },
  ],
  rowMarkup(event) {
    return `<tr><td data-label="Sự kiện"><strong>${text(event?.eventType)}</strong><div class="small text-secondary">#${text(event?.id)}</div></td><td data-label="Tổ chức">${text(event?.organizationId)}</td><td data-label="Trạng thái">${text(event?.status)}</td><td data-label="Lần thử">${Number.isFinite(event?.attemptCount) ? escapeHtml(event.attemptCount) : "N/A"}</td><td data-label="Sẵn sàng">${formatDate(event?.availableAt)}</td><td data-label="Đã phát">${formatDate(event?.dispatchedAt)}</td><td data-label="Lỗi cuối">${text(event?.lastErrorCode)}</td></tr>`;
  },
});

export function renderAdminSystemJobs(container, options) {
  return renderAdminDirectory(container, JOB_DIRECTORY, options);
}

export function renderAdminSystemSync(container, options) {
  return renderAdminDirectory(container, SYNC_DIRECTORY, options);
}
