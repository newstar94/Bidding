export function isLotFinalizeResponse(response, packageId) {
  const url = new URL(response.url());
  const encodedPackageId = encodeURIComponent(String(packageId));
  return response.request().method() === "POST"
    && url.pathname.startsWith(`/api/packages/${encodedPackageId}/lot-batches/`)
    && url.pathname.endsWith("/finalize");
}

function describeFinalizeFailure(lifecycle) {
  const detail = lifecycle?.detail || lifecycle?.error || lifecycle?.code || "";
  return detail ? `: ${String(detail).slice(0, 500)}` : "";
}

export function hasRenderedLotFinalization({
  expectedId,
  expectedRounds,
  expectedStatus,
  expectedVersion,
}) {
  const wrapper = document.getElementById("detail-workflow-content-wrapper");
  return document.querySelectorAll(".evaluation-round-card").length >= expectedRounds
    && wrapper?.dataset.renderedPackageId === expectedId
    && wrapper.dataset.renderedPackageRowVersion === String(expectedVersion)
    && wrapper.dataset.renderedPackageStatus === expectedStatus
    && wrapper?.dataset.renderedWorkflowTab === "result"
    && wrapper.dataset.renderedRenderVersion === wrapper.dataset.pendingRenderVersion;
}

export function hasSettledAwardApproval({ afterGeneration }) {
  const root = document.documentElement;
  const generation = Number.parseInt(root?.dataset.awardApprovalGeneration || "0", 10);
  const state = root?.dataset.awardApprovalState || "";
  if (!Number.isFinite(generation) || generation <= afterGeneration || !state) {
    return false;
  }
  const failureDialog = document.getElementById("modal-custom-dialog");
  if (state === "pending" && failureDialog?.classList.contains("active")) {
    return {
      generation,
      state: "failed",
      kind: failureDialog.querySelector("#dialog-title")?.textContent?.trim()
        || "approval_dialog",
    };
  }
  if (state === "pending") return false;
  return {
    generation,
    state,
    kind: root.dataset.awardApprovalKind || "unknown",
  };
}

async function pageFunctionValue(value) {
  return typeof value?.jsonValue === "function" ? value.jsonValue() : value;
}

export async function finalizeLotAndWaitForRender({
  page,
  packageId,
  roundsBefore,
  expectedPackageStatus,
  expectedRenderedStatus,
  approve,
  waitForPageCondition,
  timeout = 20_000,
}) {
  const approvalGeneration = typeof page.evaluate === "function"
    ? await page.evaluate(() => Number.parseInt(
      document.documentElement.dataset.awardApprovalGeneration || "0",
      10,
    ))
    : null;
  const finalizeResponsePromise = page.waitForResponse(
    (response) => isLotFinalizeResponse(response, packageId),
    // The approval workflow commits dependent records before issuing finalize.
    // The application transport owns that operation's bounded deadline; a UI
    // default timeout here would also count time before the request exists.
    { timeout: 0 },
  ).then((response) => ({ type: "response", response }));
  const approvalOutcomePromise = approvalGeneration === null
    ? null
    : waitForPageCondition(page, hasSettledAwardApproval, {
      afterGeneration: approvalGeneration,
    }, { timeout: 0 }).then(async (value) => ({
      type: "approval",
      approval: await pageFunctionValue(value),
    }));
  await approve();
  const outcome = await Promise.race([
    finalizeResponsePromise,
    ...(approvalOutcomePromise ? [approvalOutcomePromise] : []),
  ]);
  if (outcome.type === "approval" && outcome.approval?.state === "failed") {
    throw new Error(
      `Lot approval failed before finalize: ${outcome.approval.kind || "unknown"}`,
    );
  }
  const finalizeResponse = outcome.type === "response"
    ? outcome.response
    : (await finalizeResponsePromise).response;
  const lifecycle = await finalizeResponse.json();
  if (finalizeResponse.status() !== 200) {
    throw new Error(
      `Lot finalize failed: HTTP ${finalizeResponse.status()}${describeFinalizeFailure(lifecycle)}`,
    );
  }
  if (lifecycle.packageStatus !== expectedPackageStatus) {
    throw new Error(
      `Unexpected lot lifecycle status: ${lifecycle.packageStatus}`,
    );
  }
  if (lifecycle.packageRowVersion === undefined || lifecycle.packageRowVersion === null) {
    throw new Error("Lot lifecycle response is missing packageRowVersion.");
  }
  await waitForPageCondition(page, hasRenderedLotFinalization, {
    expectedId: String(packageId),
    expectedRounds: roundsBefore + 1,
    expectedStatus: expectedRenderedStatus,
    expectedVersion: lifecycle.packageRowVersion,
  }, { timeout });
  return lifecycle;
}
