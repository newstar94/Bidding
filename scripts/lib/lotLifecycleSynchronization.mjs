export function isLotFinalizeResponse(response, packageId) {
  const url = new URL(response.url());
  const encodedPackageId = encodeURIComponent(String(packageId));
  return response.request().method() === "POST"
    && url.pathname.startsWith(`/api/packages/${encodedPackageId}/lot-batches/`)
    && url.pathname.endsWith("/finalize")
    && response.status() === 200;
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
  const finalizeResponsePromise = page.waitForResponse(
    (response) => isLotFinalizeResponse(response, packageId),
  );
  await approve();
  const finalizeResponse = await finalizeResponsePromise;
  const lifecycle = await finalizeResponse.json();
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
