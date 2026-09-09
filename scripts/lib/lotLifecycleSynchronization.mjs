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

function withDeadline(promise, timeout, message) {
  let timer;
  const deadline = new Promise((_, reject) => {
    timer = setTimeout(() => reject(new Error(message)), timeout);
  });
  return Promise.race([promise, deadline]).finally(() => clearTimeout(timer));
}

export async function finalizeLotAndWaitForRender({
  page,
  packageId,
  roundsBefore,
  expectedPackageStatus,
  expectedRenderedStatus,
  approve,
  prepareRenderedState,
  waitForPageCondition,
  timeout = 20_000,
}) {
  const normalizedPackageId = String(packageId || "").trim();
  if (!normalizedPackageId) {
    throw new TypeError("Lot approval package identity is required.");
  }
  const approvalGeneration = typeof page.evaluate === "function"
    ? await withDeadline(page.evaluate(() => Number.parseInt(
      document.documentElement.dataset.awardApprovalGeneration || "0",
      10,
    )), timeout, "Lot approval generation probe did not settle.")
    : null;
  const finalizeResponsePromise = page.waitForResponse(
    (response) => isLotFinalizeResponse(response, normalizedPackageId),
    // The approval workflow commits dependent records before issuing finalize.
    // The application transport owns that operation's bounded deadline; a UI
    // default timeout here would also count time before the request exists.
    { timeout: 0 },
  ).then(
    (response) => ({ type: "response", response }),
    (error) => ({ type: "response-error", error }),
  );
  const approvalOutcomePromise = approvalGeneration === null
    ? null
    : waitForPageCondition(page, hasSettledAwardApproval, {
      afterGeneration: approvalGeneration,
    }, { timeout: 0 }).then(
      async (value) => ({
        type: "approval",
        approval: await pageFunctionValue(value),
      }),
      (error) => ({ type: "approval-error", error }),
    );
  const approvalInvocationFailure = Promise.resolve()
    .then(approve)
    // A completed click is not authoritative. Keep this branch pending until
    // either the finalize response or the semantic operation state settles.
    .then(() => new Promise(() => {}), (error) => ({ type: "approve-error", error }));
  const outcome = await withDeadline(
    Promise.race([
      finalizeResponsePromise,
      ...(approvalOutcomePromise ? [approvalOutcomePromise] : []),
      approvalInvocationFailure,
    ]),
    timeout,
    "Lot approval did not yield an authoritative finalize response or settled operation state.",
  ).catch(async (error) => {
    let diagnostic;
    try {
      diagnostic = await withDeadline(page.evaluate(() => ({
        path: location.pathname,
        operation: { ...document.documentElement.dataset },
        render: { ...document.getElementById("detail-workflow-content-wrapper")?.dataset },
        invalid: [...document.querySelectorAll(":invalid")].map((item) => ({ id: item.id, message: item.validationMessage })).slice(0, 20),
        dialog: document.getElementById("modal-custom-dialog")?.innerText,
        toasts: [...document.querySelectorAll(".bf-toast")].map((item) => item.innerText),
      })), timeout, "Lot failure diagnostics did not settle.");
    } catch (diagnosticError) {
      diagnostic = { unavailable: diagnosticError.message };
    }
    throw new Error(`${error.message} Diagnostics: ${JSON.stringify(diagnostic)}`, { cause: error });
  });
  if (outcome.type === "response-error" || outcome.type === "approval-error" || outcome.type === "approve-error") {
    throw new Error(`Lot approval observation failed: ${outcome.error?.message || "unknown"}`);
  }
  if (outcome.type === "approval" && outcome.approval?.state === "failed") {
    throw new Error(
      `Lot approval failed before finalize: ${outcome.approval.kind || "unknown"}`,
    );
  }
  const finalizeOutcome = outcome.type === "response"
    ? outcome
    : await withDeadline(
      finalizeResponsePromise,
      timeout,
      "Lot approval settled without an authoritative finalize response.",
    );
  if (finalizeOutcome.type === "response-error") {
    throw new Error(`Lot approval observation failed: ${finalizeOutcome.error?.message || "unknown"}`);
  }
  const finalizeResponse = finalizeOutcome.response;
  const lifecycle = await withDeadline(
    finalizeResponse.json(),
    timeout,
    "Lot finalize response body did not settle.",
  );
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
  const renderPage = typeof prepareRenderedState === "function"
    ? await withDeadline(
      Promise.resolve(prepareRenderedState({ lifecycle, page })),
      timeout,
      "Lot canonical rendered state preparation did not settle.",
    )
    : page;
  if (!renderPage) {
    throw new TypeError("Lot canonical rendered state preparation must return a page.");
  }
  await withDeadline(waitForPageCondition(renderPage, hasRenderedLotFinalization, {
    expectedId: normalizedPackageId,
    expectedRounds: roundsBefore + 1,
    expectedStatus: expectedRenderedStatus,
    expectedVersion: lifecycle.packageRowVersion,
  }, { timeout }), timeout, "Lot finalization render did not converge before the operation deadline.");
  return lifecycle;
}
