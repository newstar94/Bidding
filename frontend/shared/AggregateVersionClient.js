import { ApiError, postJson } from "./apiClient.js";
import {
  reportAggregateVersionConflict,
  reportLegacyVersionFallback,
} from "./releaseDiagnostics.js";
import { resolveServerCapabilities } from "../auth/serverCapabilities.js";
import {
  captureWorkspace,
  workspaceIsCurrent,
} from "../app/SyncWorkspaceContext.js";


export const AGGREGATE_VERSION_CAPABILITY = "aggregate-version-v1";


const reportWithoutBreakingVersionFlow = (reporter, value) => {
  try {
    Promise.resolve(reporter(value)).catch(() => {});
  } catch {
    // Diagnostics are an isolation boundary and must not change version semantics.
  }
};

function assertAggregateVersionWorkspace(controller, workspace) {
  if (!workspace || workspaceIsCurrent(controller, workspace)) return;
  const error = new Error("Workspace changed while creating aggregate version");
  error.name = "AbortError";
  error.code = "WORKSPACE_CHANGED";
  throw error;
}


async function supportsAuthoritativeAggregateVersion(fetchImpl) {
  const capabilities = await resolveServerCapabilities(() => postJson(
      "/api/auth/check-session",
      { remember: false },
      { csrf: false, retries: 0 },
      fetchImpl,
    ));
  return capabilities.includes(AGGREGATE_VERSION_CAPABILITY);
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
  const workspace = controller?.model ? captureWorkspace(controller) : null;
  const supportsAggregateVersion = await supportsAuthoritativeAggregateVersion(fetchImpl);
  assertAggregateVersionWorkspace(controller, workspace);
  if (!supportsAggregateVersion) {
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
    assertAggregateVersionWorkspace(controller, workspace);
    const refresh = typeof controller?.forceSyncData === "function"
      ? await controller.forceSyncData(true)
      : null;
    assertAggregateVersionWorkspace(controller, workspace);
    return { authoritative: true, data, refresh };
  } catch (error) {
    if (error instanceof ApiError && error.status === 409) {
      reportWithoutBreakingVersionFlow(reportConflict);
    }
    throw error;
  }
}
