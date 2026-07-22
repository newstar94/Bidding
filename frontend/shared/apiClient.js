export class ApiError extends Error {
  constructor(message, {
    status = 0,
    code = "",
    data = null,
    response = null,
    requestId = "",
    retryAfter = null,
    cause = null
  } = {}) {
    super(message || "Yêu cầu tới máy chủ thất bại", cause ? { cause } : undefined);
    this.name = "ApiError";
    this.status = status;
    this.code = code;
    this.data = data;
    this.response = response;
    this.requestId = requestId;
    this.retryAfter = retryAfter;
  }
}

const MUTATING_METHODS = new Set(["POST", "PUT", "PATCH", "DELETE"]);
const IDEMPOTENT_METHODS = new Set(["GET", "HEAD", "OPTIONS", "PUT", "DELETE"]);
const RETRYABLE_STATUSES = new Set([429, 502, 503, 504]);
const CSRF_EXEMPT_PATHS = new Set([
  "/api/auth/login",
  "/api/auth/google-login",
  "/api/auth/register",
  "/api/auth/check-session",
  "/api/auth/verify",
  "/api/auth/resend-code",
  "/api/auth/forgot-password"
]);

const DEFAULT_TIMEOUT_MS = 60_000;
const defaultActiveOrganization = () => {
  try {
    return String(
      globalThis.sessionStorage?.getItem("bf_active_org")
      || globalThis.localStorage?.getItem("bf_active_org")
      || ""
    ).trim();
  } catch {
    return "";
  }
};

const clientConfiguration = {
  activeOrganization: defaultActiveOrganization,
  onHttpError: null
};

/**
 * Configure application-specific UI reactions without changing global fetch.
 * The transport remains usable before the workspace controller is loaded.
 */
export function configureApiClient({ activeOrganization, onHttpError } = {}) {
  if (activeOrganization !== undefined) {
    clientConfiguration.activeOrganization = typeof activeOrganization === "function"
      ? activeOrganization
      : defaultActiveOrganization;
  }
  if (onHttpError !== undefined) {
    clientConfiguration.onHttpError = typeof onHttpError === "function" ? onHttpError : null;
  }
}

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

function combineAbortSignals(signal, timeoutMs) {
  const controller = new AbortController();
  let timedOut = false;
  const abort = () => controller.abort(signal?.reason);
  if (signal?.aborted) abort();
  else signal?.addEventListener?.("abort", abort, { once: true });
  const timeout = Number.isFinite(timeoutMs) && timeoutMs > 0
    ? globalThis.setTimeout(() => {
      timedOut = true;
      controller.abort(new DOMException("Request timed out", "TimeoutError"));
    }, timeoutMs)
    : null;
  return {
    signal: controller.signal,
    didTimeOut: () => timedOut,
    cleanup: () => {
      if (timeout !== null) globalThis.clearTimeout(timeout);
      signal?.removeEventListener?.("abort", abort);
    }
  };
}

function parseRetryAfter(response) {
  const value = response?.headers?.get?.("retry-after");
  if (!value) return null;
  const seconds = Number(value);
  if (Number.isFinite(seconds)) return Math.max(0, seconds * 1_000);
  const date = Date.parse(value);
  return Number.isFinite(date) ? Math.max(0, date - Date.now()) : null;
}

function retryDelay(attempt, response) {
  const serverDelay = parseRetryAfter(response);
  if (serverDelay !== null) return Math.min(serverDelay, 5_000);
  return 250 * (2 ** attempt) + Math.floor(Math.random() * 100);
}

function wait(ms, signal) {
  return new Promise((resolve, reject) => {
    const timer = globalThis.setTimeout(resolve, ms);
    signal?.addEventListener?.("abort", () => {
      globalThis.clearTimeout(timer);
      reject(signal.reason || new DOMException("Aborted", "AbortError"));
    }, { once: true });
  });
}

async function readErrorPayload(response) {
  try {
    const contentType = response.headers?.get?.("content-type") || "";
    if (contentType.includes("application/json")) return await response.clone().json();
    const message = await response.clone().text();
    return message ? { error: message } : null;
  } catch {
    return null;
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
  if (!token) throw new ApiError("Máy chủ không cấp CSRF token cho phiên làm việc");
  return token;
}

/**
 * Shared response-compatible transport. It owns credentials, tenant context,
 * CSRF, timeout and bounded retries; callers that need parsed data use requestJson.
 */
export async function apiFetch(url, options = {}, fetchImpl = globalThis.fetch) {
  if (typeof fetchImpl !== "function") {
    throw new ApiError("Trình duyệt không hỗ trợ gửi yêu cầu tới máy chủ");
  }
  const {
    csrf = true,
    timeoutMs = DEFAULT_TIMEOUT_MS,
    retries = 1,
    handleHttpErrors = true,
    ...requestOptions
  } = options;
  const method = String(requestOptions.method || "GET").toUpperCase();
  const path = apiPath(url);
  const headers = new Headers(requestOptions.headers || {});
  headers.delete("X-Session-Token");
  headers.delete("X-Username");
  if (path) {
    const activeOrganization = clientConfiguration.activeOrganization?.();
    if (activeOrganization) headers.set("X-Active-Org", encodeURIComponent(activeOrganization));
    if (csrf && MUTATING_METHODS.has(method) && !CSRF_EXEMPT_PATHS.has(path)) {
      const token = await ensureCsrfToken(fetchImpl);
      if (token) headers.set("X-CSRF-Token", token);
    }
  }

  const canRetry = IDEMPOTENT_METHODS.has(method) || headers.has("Idempotency-Key");
  const maxRetries = canRetry ? Math.max(0, Math.min(Number(retries) || 0, 2)) : 0;
  let attempt = 0;
  let httpRecoveryUsed = false;
  while (true) {
    const abort = combineAbortSignals(requestOptions.signal, timeoutMs);
    let response;
    try {
      response = await fetchImpl(url, {
        ...requestOptions,
        method,
        headers,
        credentials: "same-origin",
        signal: abort.signal
      });
    } catch (error) {
      abort.cleanup();
      if (requestOptions.signal?.aborted) {
        throw requestOptions.signal.reason instanceof Error
          ? requestOptions.signal.reason
          : new DOMException("Request cancelled", "AbortError");
      }
      if (attempt < maxRetries && !requestOptions.signal?.aborted) {
        await wait(retryDelay(attempt), requestOptions.signal);
        attempt += 1;
        continue;
      }
      if (abort.didTimeOut()) {
        throw new ApiError("Yêu cầu tới máy chủ đã quá thời gian chờ", {
          code: "REQUEST_TIMEOUT",
          cause: error
        });
      }
      throw error instanceof ApiError
        ? error
        : new ApiError("Không thể kết nối tới máy chủ", { code: "NETWORK_ERROR", cause: error });
    }
    abort.cleanup();

    if (RETRYABLE_STATUSES.has(response.status) && attempt < maxRetries) {
      await wait(retryDelay(attempt, response), requestOptions.signal);
      attempt += 1;
      continue;
    }

    if (
      handleHttpErrors
      && [401, 403, 409, 429].includes(response.status)
      && typeof clientConfiguration.onHttpError === "function"
    ) {
      const data = await readErrorPayload(response);
      const recovery = await clientConfiguration.onHttpError({
        url,
        path,
        method,
        options: { ...requestOptions, method, headers },
        response,
        data
      });
      if (recovery?.retry === true && !httpRecoveryUsed) {
        httpRecoveryUsed = true;
        continue;
      }
    }
    return response;
  }
}

async function readResponseBody(response) {
  if (response.status === 204) return null;
  const contentType = response.headers?.get?.("content-type") || "";
  if (contentType.includes("application/json")) {
    try {
      return await response.json();
    } catch {
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
  const requestOptions = { ...options };
  let body = requestOptions.body;
  const headers = new Headers(requestOptions.headers || {});
  const isFormData = typeof FormData !== "undefined" && body instanceof FormData;
  if (body != null && !isFormData && typeof body !== "string") {
    headers.set("Content-Type", "application/json");
    body = JSON.stringify(body);
  }
  const response = await apiFetch(url, { ...requestOptions, headers, body }, fetchImpl);
  const data = await readResponseBody(response);
  if (!response.ok) {
    const message = data && typeof data === "object" ? data.error || data.message : data;
    throw new ApiError(message || `${response.status} ${response.statusText || ""}`.trim(), {
      status: response.status,
      code: data && typeof data === "object" ? data.code || data.error_code || "" : "",
      data,
      response,
      requestId: response.headers?.get?.("x-request-id") || "",
      retryAfter: parseRetryAfter(response)
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
