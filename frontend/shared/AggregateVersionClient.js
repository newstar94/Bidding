import { ApiError, postJson } from "./apiClient.js";
import {
  reportAggregateVersionConflict,
  reportLegacyVersionFallback,
} from "./releaseDiagnostics.js";


export const AGGREGATE_VERSION_CAPABILITY = "aggregate-version-v1";


const reportWithoutBreakingVersionFlow = (reporter, value) => {
  try {
    Promise.resolve(reporter(value)).catch(() => {});
  } catch {
    // Diagnostics are an isolation boundary and must not change version semantics.
  }
};


async function supportsAuthoritativeAggregateVersion(fetchImpl) {
  const session = await postJson(
    "/api/auth/check-session",
    { remember: false },
    { csrf: false, retries: 0 },
    fetchImpl,
  );
  return Array.isArray(session?.serverCapabilities)
    && session.serverCapabilities.includes(AGGREGATE_VERSION_CAPABILITY);
}


export async function createOfficialAggregateVersion(
  controller,
  command,
  {
    fetchImpl = globalThis.fetch,
    reportConflict = reportAggregateVersionConflict,
    reportFallback = reportLegacyVersionFallback,
  } = {},
) {
  const clientMutationId = String(command?.clientMutationId || "").trim();
  if (!clientMutationId) {
    throw new TypeError("clientMutationId is required for aggregate version creation.");
  }
  if (!await supportsAuthoritativeAggregateVersion(fetchImpl)) {
    reportWithoutBreakingVersionFlow(reportFallback, "capability_missing");
    return { authoritative: false, fallbackRequired: true };
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
    if (error instanceof ApiError && error.status === 409) {
      reportWithoutBreakingVersionFlow(reportConflict);
    }
    throw error;
  }
}
