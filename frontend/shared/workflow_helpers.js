import { apiFetch } from "./apiClient.js";

export function getAuthDownloadUrl(url) {
  return url;
}
export function authFetchDownload(url, filename) {
  return apiFetch(url, { timeoutMs: 120_000 }).then(async (res) => {
    if (!res.ok) {
      let errMsg = "Lỗi tải file";
      try {
        const contentType = res.headers.get("content-type");
        if (contentType && contentType.includes("application/json")) {
          const d = await res.json();
          errMsg = d.error || errMsg;
        } else {
          const text = await res.text();
          errMsg = text || `${res.status} ${res.statusText}`;
        }
      } catch (e) {
        errMsg = `${res.status} ${res.statusText}`;
      }
      throw new Error(errMsg);
    }
    return res.blob();
  }).then((blob) => {
    const a = document.createElement("a");
    const objectUrl = URL.createObjectURL(blob);
    a.href = objectUrl;
    a.download = filename || "download";
    document.body.appendChild(a);
    a.click();
    a.remove();
    URL.revokeObjectURL(objectUrl);
  });
}

export async function authFetchDownloadWithAlert(
  view,
  url,
  filename,
  {
    title = "Lỗi tải mẫu",
    messagePrefix = "Không thể tải tệp: ",
  } = {},
) {
  try {
    await authFetchDownload(url, filename);
    return true;
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error || "Lỗi tải file");
    try {
      await view?.customAlert?.(title, messagePrefix + message, "x-circle");
    } catch {
      // The download failure is already handled; alert rendering must not leak it.
    }
    return false;
  }
}
