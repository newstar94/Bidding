import { apiFetch } from "../shared/apiClient.js";


async function jsonResponse(response) {
  const payload = await response.json().catch(() => ({}));
  if (!response.ok) {
    const error = new Error(payload.message || "Không thể xử lý xung đột dữ liệu.");
    error.code = payload.code || "CONFLICT_CENTER_REQUEST_FAILED";
    error.status = response.status;
    error.fields = payload.fields || null;
    throw error;
  }
  return payload;
}


export class ConflictCenterClient {
  constructor({ fetchImpl = apiFetch } = {}) {
    this.fetchImpl = fetchImpl;
  }

  capture(request, { signal } = {}) {
    return this.fetchImpl("/api/conflict-drafts", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(request),
      signal,
    }).then(jsonResponse);
  }

  list(workspaceFingerprint, { signal } = {}) {
    const query = new URLSearchParams({ workspaceFingerprint: String(workspaceFingerprint || "") });
    return this.fetchImpl(`/api/conflict-drafts?${query}`, { signal }).then(jsonResponse);
  }

  preview(draftId, workspaceFingerprint, { signal } = {}) {
    const query = new URLSearchParams({ workspaceFingerprint: String(workspaceFingerprint || "") });
    return this.fetchImpl(
      `/api/conflict-drafts/${encodeURIComponent(String(draftId || ""))}/preview?${query}`,
      { method: "POST", signal },
    ).then(jsonResponse);
  }

  resolve(draftId, request, { signal } = {}) {
    return this.fetchImpl(
      `/api/conflict-drafts/${encodeURIComponent(String(draftId || ""))}/resolve`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(request),
        signal,
      },
    ).then(jsonResponse);
  }

  discard(draftId, workspaceFingerprint, { signal } = {}) {
    const query = new URLSearchParams({ workspaceFingerprint: String(workspaceFingerprint || "") });
    return this.fetchImpl(
      `/api/conflict-drafts/${encodeURIComponent(String(draftId || ""))}?${query}`,
      { method: "DELETE", signal },
    ).then(jsonResponse);
  }
}
