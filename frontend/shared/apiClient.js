export class ApiError extends Error {
  constructor(message, { status = 0, data = null, response = null } = {}) {
    super(message || "Yêu cầu tới máy chủ thất bại");
    this.name = "ApiError";
    this.status = status;
    this.data = data;
    this.response = response;
  }
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
  const headers = new Headers(options.headers || {});
  let body = options.body;
  if (body != null && !(body instanceof FormData) && typeof body !== "string") {
    headers.set("Content-Type", "application/json");
    body = JSON.stringify(body);
  }
  const response = await fetchImpl(url, { ...options, headers, body });
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
