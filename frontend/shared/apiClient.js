export class ApiError extends Error {
  constructor(message, { status = 0, data = null, response = null } = {}) {
    super(message || "Yêu cầu tới máy chủ thất bại");
    this.name = "ApiError";
    this.status = status;
    this.data = data;
    this.response = response;
  }
}

const MUTATING_METHODS = new Set(["POST", "PUT", "PATCH", "DELETE"]);
const CSRF_EXEMPT_PATHS = new Set([
  "/api/auth/login",
  "/api/auth/google-login",
  "/api/auth/register",
  "/api/auth/check-session",
  "/api/auth/verify",
  "/api/auth/resend-code",
  "/api/auth/forgot-password"
]);

export function readCookie(name, cookieSource = globalThis.document?.cookie || "") {
  const prefix = `${name}=`;
  const raw = String(cookieSource)
    .split(";")
    .map((part) => part.trim())
    .find((part) => part.startsWith(prefix));
  if (!raw) return "";
  try {
    return decodeURIComponent(raw.slice(prefix.length));
  } catch {
    return "";
  }
}

function apiPath(url) {
  if (typeof url !== "string") return "";
  if (url.startsWith("/api/")) return url.split(/[?#]/, 1)[0];
  if (!globalThis.location?.origin) return "";
  try {
    const parsed = new URL(url, globalThis.location.origin);
    return parsed.origin === globalThis.location.origin && parsed.pathname.startsWith("/api/")
      ? parsed.pathname
      : "";
  } catch {
    return "";
  }
}

export async function ensureCsrfToken(fetchImpl = globalThis.fetch) {
  let token = readCookie("csrf_token");
  if (token || !globalThis.document || typeof fetchImpl !== "function") return token;

  const response = await fetchImpl("/api/auth/check-session", {
    method: "POST",
    credentials: "same-origin",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ remember: false })
  });
  if (!response.ok) {
    throw new ApiError("Không thể khởi tạo bảo vệ CSRF", {
      status: response.status,
      response
    });
  }
  token = readCookie("csrf_token");
  if (!token) {
    throw new ApiError("Máy chủ không cấp CSRF token cho phiên làm việc");
  }
  return token;
}

async function readResponseBody(response) {
  if (response.status === 204) return null;
  const contentType = response.headers?.get?.("content-type") || "";
  if (contentType.includes("application/json")) {
    try {
      return await response.json();
    } catch (error) {
      throw new ApiError("Phản hồi JSON từ máy chủ không hợp lệ", {
        status: response.status,
        response
      });
    }
  }
  const text = await response.text();
  return text || null;
}

export async function requestJson(url, options = {}, fetchImpl = globalThis.fetch) {
  if (typeof fetchImpl !== "function") {
    throw new ApiError("Trình duyệt không hỗ trợ gửi yêu cầu tới máy chủ");
  }
  const { csrf = true, ...requestOptions } = options;
  const headers = new Headers(requestOptions.headers || {});
  const method = String(requestOptions.method || "GET").toUpperCase();
  const path = apiPath(url);
  if (csrf && path && MUTATING_METHODS.has(method) && !CSRF_EXEMPT_PATHS.has(path)) {
    const csrfToken = await ensureCsrfToken(fetchImpl);
    if (csrfToken) headers.set("X-CSRF-Token", csrfToken);
  }
  let body = requestOptions.body;
  if (body != null && !(body instanceof FormData) && typeof body !== "string") {
    headers.set("Content-Type", "application/json");
    body = JSON.stringify(body);
  }
  const response = await fetchImpl(url, {
    credentials: "same-origin",
    ...requestOptions,
    method,
    headers,
    body
  });
  const data = await readResponseBody(response);
  if (!response.ok) {
    const message = data && typeof data === "object"
      ? data.error || data.message
      : data;
    throw new ApiError(message || `${response.status} ${response.statusText || ""}`.trim(), {
      status: response.status,
      data,
      response
    });
  }
  return data;
}

export function getJson(url, options = {}, fetchImpl) {
  return requestJson(url, { ...options, method: "GET" }, fetchImpl);
}

export function postJson(url, body, options = {}, fetchImpl) {
  return requestJson(url, { ...options, method: "POST", body }, fetchImpl);
}

export function putJson(url, body, options = {}, fetchImpl) {
  return requestJson(url, { ...options, method: "PUT", body }, fetchImpl);
}

export function deleteJson(url, body = null, options = {}, fetchImpl) {
  return requestJson(url, { ...options, method: "DELETE", body }, fetchImpl);
}
