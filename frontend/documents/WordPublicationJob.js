import { requestJson } from "../shared/apiClient.js";
import { authFetchDownload } from "../shared/view_helpers.js";

const ACTIVE_JOB_STATUSES = new Set(["pending", "processing", "retry"]);
const DEFAULT_POLL_INTERVAL_MS = 2_000;
const DEFAULT_JOB_TIMEOUT_MS = 20 * 60 * 1_000;
const TERMINAL_POLL_ERROR_CODES = new Set([
  "AUTH_REQUIRED",
  "DOCUMENT_EXPORT_DENIED",
  "DOCUMENT_EXPORT_ENTITLEMENT_REQUIRED",
  "DOCUMENT_EXPORT_SUBSCRIPTION_REQUIRED",
  "DOCUMENT_EXPORT_PERMISSION_REVOKED",
  "DOCUMENT_JOB_NOT_FOUND",
  "DOCUMENT_JOB_EXPIRED",
]);
const TEAM_WARNING_CODES = new Set([
  "DOCUMENT_EXPORT_EXPERT_TEAM_REQUIRED",
  "DOCUMENT_EXPORT_APPRAISAL_TEAM_REQUIRED",
  "DOCUMENT_EXPORT_TEAMS_REQUIRED",
]);

function delay(milliseconds) {
  return new Promise((resolve) => globalThis.setTimeout(resolve, milliseconds));
}

function jobErrorCode(error) {
  return String(
    error?.data?.code
    || error?.data?.errorCode
    || error?.errorCode
    || error?.code
    || "",
  ).trim();
}

function jobErrorMessage(code, fallback = "") {
  const messages = {
    DOCUMENT_JOB_CANCELLED: "Yêu cầu xuất Word đã bị hủy.",
    DOCUMENT_JOB_EXPIRED: "Yêu cầu xuất Word đã hết thời gian lưu. Vui lòng xuất lại.",
    DOCUMENT_JOB_FAILED: "Không thể tạo tài liệu Word. Vui lòng thử lại.",
    DOCUMENT_JOB_NOT_FOUND: "Không còn tìm thấy yêu cầu xuất Word này.",
    DOCUMENT_JOB_NOT_READY: "Tài liệu Word chưa sẵn sàng để tải xuống.",
    DOCUMENT_JOB_RESULT_INVALID: "File Word do máy chủ tạo ra không hợp lệ.",
    DOCUMENT_EXPORT_DENIED: "Bạn không có quyền xuất tài liệu Word này.",
    DOCUMENT_EXPORT_ENTITLEMENT_REQUIRED: "Gói dịch vụ hiện tại chưa bật quyền xuất Word.",
    DOCUMENT_EXPORT_SUBSCRIPTION_REQUIRED: "Gói dịch vụ hiện tại chưa bật quyền xuất Word.",
    DOCUMENT_EXPORT_PERMISSION_REVOKED: "Quyền xuất tài liệu Word đã thay đổi. Vui lòng tải lại trang.",
    DOCUMENT_EXPORT_SOURCE_CHANGED: "Dữ liệu nguồn đã thay đổi trong lúc tạo Word. Vui lòng xuất lại.",
    DOCUMENT_EXPORT_TEMPLATE_SELECTION_REQUIRED: "Biểu mẫu Word đã chọn không còn khả dụng.",
    DOCUMENT_EXPORT_INPUT_INVALID: "Thông tin xuất Word không hợp lệ. Vui lòng chọn lại văn bản.",
    DOCUMENT_EXPORT_POLICY_INVALID: "Không thể xác minh yêu cầu xuất Word. Vui lòng xuất lại.",
    DOCUMENT_EXPORT_POLICY_TOO_LARGE: "Số lượng biểu mẫu trong lượt xuất này quá lớn. Vui lòng chia thành nhiều lượt.",
    DOCUMENT_EXPORT_EXPERT_TEAM_REQUIRED: "Cảnh báo: Tổ chuyên gia phải có thành viên và đúng một Tổ trưởng vì biểu mẫu Word đã chọn đang sử dụng trường Tổ chuyên gia.",
    DOCUMENT_EXPORT_APPRAISAL_TEAM_REQUIRED: "Cảnh báo: Tổ thẩm định phải có thành viên và đúng một Tổ trưởng vì biểu mẫu Word đã chọn đang sử dụng trường Tổ thẩm định.",
    DOCUMENT_EXPORT_TEAMS_REQUIRED: "Cảnh báo: Tổ chuyên gia và Tổ thẩm định phải có thành viên và đúng một Tổ trưởng vì biểu mẫu Word đã chọn đang sử dụng các trường này.",
    AUTH_REQUIRED: "Phiên đăng nhập đã hết hạn. Vui lòng đăng nhập lại.",
  };
  return messages[code] || fallback || "Không thể hoàn tất yêu cầu xuất Word.";
}

function exportJobError(code, fallback = "") {
  const error = new Error(jobErrorMessage(code, fallback));
  error.code = code;
  return error;
}

export function isWordPublicationTeamWarning(error) {
  return TEAM_WARNING_CODES.has(jobErrorCode(error));
}

function normalizedStatus(payload) {
  return String(payload?.status || "").trim().toLowerCase();
}

function processingMessage(status, payload) {
  const phase = String(payload?.phase || "").trim().toLowerCase();
  const totalItems = Math.max(0, Number(payload?.totalItems) || 0);
  const completedItems = Math.max(0, Number(payload?.completedItems) || 0);
  if (status === "pending") return "Yêu cầu đã được tiếp nhận và đang chờ xử lý.";
  if (status === "retry") return "Hệ thống đang tự thử lại việc tạo tài liệu Word.";
  if (phase === "preparing") {
    return "Hệ thống đang chuẩn bị biểu mẫu và hình ảnh cho tài liệu Word.";
  }
  if (phase === "finalizing") {
    return totalItems > 1
      ? `Đã tạo xong ${Math.min(completedItems, totalItems)}/${totalItems} biểu mẫu. Hệ thống đang đóng gói file.`
      : "Tài liệu đã được tạo. Hệ thống đang hoàn tất file tải xuống.";
  }
  if (phase === "rendering" && totalItems > 1) {
    return `Hệ thống đang tạo ${totalItems} tài liệu Word trong cùng một lượt.`;
  }
  return "Hệ thống đang tạo tài liệu Word từ dữ liệu mới nhất.";
}

function assertJobResponse(payload) {
  if (!payload || typeof payload !== "object") {
    throw new Error("Máy chủ không trả về thông tin theo dõi tài liệu Word.");
  }
  if (!String(payload.statusUrl || "").trim()) {
    throw new Error("Máy chủ không trả về đường dẫn theo dõi tài liệu Word.");
  }
}

/**
 * Create, follow and download one background Word export behind a single interface.
 * The second argument is the owned-HTTP adapter seam used by browser code and tests.
 */
export async function runWordPublicationExportJob({
  createJobUrl,
  filename,
  onProgress = async () => {},
}, {
  request = requestJson,
  download = authFetchDownload,
  wait = delay,
  now = Date.now,
  pollIntervalMs = DEFAULT_POLL_INTERVAL_MS,
  timeoutMs = DEFAULT_JOB_TIMEOUT_MS,
} = {}) {
  if (!String(createJobUrl || "").trim()) {
    throw new Error("Chưa xác định được đường dẫn tạo tài liệu Word.");
  }

  let created;
  try {
    created = await request(createJobUrl, {
      method: "POST",
      retries: 0,
      timeoutMs: 120_000,
    });
  } catch (error) {
    const code = jobErrorCode(error);
    throw exportJobError(code, error instanceof Error ? error.message : String(error));
  }
  assertJobResponse(created);

  const statusUrl = String(created.statusUrl).trim();
  const deadline = now() + Math.max(1, Number(timeoutMs) || DEFAULT_JOB_TIMEOUT_MS);
  let latest = created;
  while (normalizedStatus(latest) !== "completed") {
    const status = normalizedStatus(latest);
    if (status === "failed" || status === "cancelled") {
      const code = String(latest.errorCode || "DOCUMENT_JOB_FAILED");
      throw new Error(jobErrorMessage(code));
    }
    if (!ACTIVE_JOB_STATUSES.has(status)) {
      throw new Error("Máy chủ trả về trạng thái tạo tài liệu Word không hợp lệ.");
    }
    if (now() >= deadline) {
      throw new Error("Thời gian tạo tài liệu Word lâu hơn dự kiến. Vui lòng thử lại sau.");
    }

    await onProgress("render", processingMessage(status, latest));
    try {
      latest = await request(statusUrl, {
        method: "GET",
        retries: 1,
        timeoutMs: 30_000,
      });
    } catch (error) {
      const code = jobErrorCode(error);
      if (TERMINAL_POLL_ERROR_CODES.has(code)) {
        throw new Error(jobErrorMessage(code, error instanceof Error ? error.message : String(error)));
      }
      await onProgress(
        "render",
        "Tạm mất kết nối khi theo dõi tài liệu; hệ thống sẽ tự kết nối lại.",
      );
      await wait(Math.max(0, Number(pollIntervalMs) || DEFAULT_POLL_INTERVAL_MS));
      continue;
    }
    if (ACTIVE_JOB_STATUSES.has(normalizedStatus(latest))) {
      await wait(Math.max(0, Number(pollIntervalMs) || DEFAULT_POLL_INTERVAL_MS));
    }
  }

  const downloadUrl = String(latest.downloadUrl || created.downloadUrl || "").trim();
  if (!downloadUrl) {
    throw new Error("Máy chủ không trả về đường dẫn tải tài liệu Word.");
  }
  await onProgress("download", "Tài liệu đã sẵn sàng. Hệ thống đang tải file xuống.");
  try {
    await download(downloadUrl, filename);
  } catch (error) {
    const code = jobErrorCode(error);
    throw new Error(jobErrorMessage(code, error instanceof Error ? error.message : String(error)));
  }
  return Object.freeze({
    jobId: String(latest.jobId || created.jobId || ""),
    status: "completed",
    downloadUrl,
  });
}
