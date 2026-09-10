export class AdminApiError extends Error {
  constructor(message, { status = 0, code = "", cause = null } = {}) {
    super(message, cause ? { cause } : undefined);
    this.name = "AdminApiError";
    this.status = status;
    this.code = code;
  }
}

function assertAdminPath(path) {
  const value = String(path || "");
  if (!/^\/api\/admin(?:\/|$)/u.test(value) || /[?#]/u.test(value)) {
    throw new TypeError("Admin API requests require an internal /api/admin path");
  }
  return value;
}

async function readPayload(response) {
  if (response.status === 204) return null;
  const contentType = response.headers?.get?.("content-type") || "";
  if (!contentType.includes("application/json")) {
    throw new AdminApiError("Máy chủ trả về dữ liệu không hợp lệ.", {
      status: response.status,
      code: "INVALID_RESPONSE",
    });
  }
  try {
    return await response.json();
  } catch (cause) {
    throw new AdminApiError("Máy chủ trả về dữ liệu không hợp lệ.", {
      status: response.status,
      code: "INVALID_RESPONSE",
      cause,
    });
  }
}

function errorMessage(status, payload) {
  if (status === 401) return "Phiên đăng nhập đã hết hạn.";
  if (status === 403) return "Bạn không có quyền xem dữ liệu quản trị này.";
  if (status === 429) return "Máy chủ đang giới hạn yêu cầu. Vui lòng thử lại sau.";
  return payload?.message || payload?.error || "Không thể tải dữ liệu quản trị.";
}

function queryString(query) {
  if (!query || typeof query !== "object") return "";
  return Object.entries(query)
    .filter(([, value]) => value !== "" && value !== null && value !== undefined)
    .map(([key, value]) => `${encodeURIComponent(key)}=${encodeURIComponent(String(value))}`)
    .join("&");
}

export async function getAdminJson(path, { query, signal, fetchImpl = globalThis.fetch } = {}) {
  const baseUrl = assertAdminPath(path);
  const encodedQuery = queryString(query);
  const url = encodedQuery ? `${baseUrl}?${encodedQuery}` : baseUrl;
  if (typeof fetchImpl !== "function") {
    throw new AdminApiError("Trình duyệt không hỗ trợ kết nối tới máy chủ.", { code: "FETCH_UNAVAILABLE" });
  }
  let response;
  try {
    response = await fetchImpl(url, {
      method: "GET",
      credentials: "same-origin",
      headers: { Accept: "application/json" },
      signal,
    });
  } catch (cause) {
    if (signal?.aborted) throw cause;
    throw new AdminApiError("Không thể kết nối tới máy chủ.", { code: "NETWORK_ERROR", cause });
  }
  const payload = await readPayload(response);
  if (!response.ok) {
    throw new AdminApiError(errorMessage(response.status, payload), {
      status: response.status,
      code: payload?.code || payload?.error_code || "HTTP_ERROR",
    });
  }
  return payload;
}
