import { postJson } from "../shared/apiClient.js";


const LOOKUP_FIELDS = new Set([
  "code", "workspaceLease", "detailLevel", "revisionMode", "revisionNumbers",
]);

export class ProcurementLookupClient {
  constructor({ post = postJson } = {}) {
    this.post = post;
  }

  lookup(request, { signal } = {}) {
    const untrustedFields = Object.keys(request || {}).filter(
      (key) => !LOOKUP_FIELDS.has(key),
    );
    if (untrustedFields.length) {
      throw new TypeError(
        "Lookup chỉ nhận code, workspaceLease và tùy chọn detail/revision.",
      );
    }
    const payload = {
      code: String(request?.code || "").trim().toUpperCase(),
      workspaceLease: request?.workspaceLease || null,
    };
    if (request?.detailLevel != null) {
      payload.detailLevel = String(request.detailLevel).trim().toUpperCase();
    }
    if (request?.revisionMode != null) {
      payload.revisionMode = String(request.revisionMode).trim().toUpperCase();
    }
    if (request?.revisionNumbers != null) {
      if (!Array.isArray(request.revisionNumbers)) {
        throw new TypeError("revisionNumbers must be an array.");
      }
      payload.revisionNumbers = request.revisionNumbers.map((number) => String(number));
    }
    return this.post(
      "/api/procurement/lookup",
      payload,
      { signal, retries: 0 },
    );
  }
}
