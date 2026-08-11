import { postJson } from "../shared/apiClient.js";


const LOOKUP_FIELDS = new Set(["code", "workspaceLease"]);

export class ProcurementLookupClient {
  constructor({ post = postJson } = {}) {
    this.post = post;
  }

  lookup(request, { signal } = {}) {
    const untrustedFields = Object.keys(request || {}).filter(
      (key) => !LOOKUP_FIELDS.has(key),
    );
    if (untrustedFields.length) {
      throw new TypeError("Lookup chỉ nhận code và workspaceLease.");
    }
    return this.post(
      "/api/procurement/lookup",
      {
        code: String(request?.code || "").trim().toUpperCase(),
        workspaceLease: request?.workspaceLease || null,
      },
      { signal, retries: 0 },
    );
  }
}
