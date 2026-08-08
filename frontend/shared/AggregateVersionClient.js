import { ApiError, postJson } from "./apiClient.js";


const LEGACY_SERVER_STATUSES = new Set([404, 405, 501]);


export async function createOfficialAggregateVersion(
  controller,
  command,
  { fetchImpl = globalThis.fetch } = {},
) {
  const clientMutationId = String(command?.clientMutationId || "").trim();
  if (!clientMutationId) {
    throw new TypeError("clientMutationId is required for aggregate version creation.");
  }
  try {
    const data = await postJson(
      "/api/versioning/aggregate",
      command,
      {
        headers: { "Idempotency-Key": clientMutationId },
        retries: 1,
      },
      fetchImpl,
    );
    const refresh = typeof controller?.forceSyncData === "function"
      ? await controller.forceSyncData(true)
      : null;
    return { authoritative: true, data, refresh };
  } catch (error) {
    if (error instanceof ApiError && LEGACY_SERVER_STATUSES.has(error.status)) {
      return { authoritative: false, fallbackRequired: true };
    }
    throw error;
  }
}
