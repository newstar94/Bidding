export function isLotFinalizeResponse(response, packageId) {
  const url = new URL(response.url());
  return response.request().method() === "POST"
    && isLotFinalizeUrl(url, packageId);
}

function isLotFinalizeUrl(url, packageId) {
  const prefix = `/api/packages/${encodeURIComponent(String(packageId))}/lot-batches/`;
  return url.pathname.startsWith(prefix)
    && /^[^/]+\/finalize$/u.test(url.pathname.slice(prefix.length));
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

async function observeLotFinalize(page, packageId, timeout) {
  const matcher = (url) => isLotFinalizeUrl(url, packageId);
  const observed = Promise.withResolvers();
  let stopped = false;
  let removal;
  const capture = async (route) => {
    if (stopped || route.request().method() !== "POST") {
      await route.fallback();
      return;
    }
    let delivered = false;
    try {
      // Retain authoritative upstream bytes before releasing them to the
      // browser. Chromium can discard a document's Response body after render
      // or navigation. Forward the original mutation once, with no retry or
      // redirect, and preserve its status/headers/body for the application.
      const response = await withDeadline(
        route.fetch({ timeout, maxRedirects: 0, maxRetries: 0 }),
        timeout, "Lot finalize upstream response did not settle.",
      );
      const body = await withDeadline(
        response.body(), timeout, "Lot finalize response body did not settle.",
      );
      const status = response.status();
      let lifecycle;
      let parseError;
      try { lifecycle = JSON.parse(body.toString("utf8")); }
      catch (error) { parseError = error; }
      await withDeadline(
        route.fulfill({ response, body }), timeout,
        "Lot finalize response delivery did not settle.",
      );
      delivered = true;
      if (!stopped) {
        observed.resolve(parseError
          ? { type: "response-error", error: parseError }
          : { type: "response", status, lifecycle });
      }
    } catch (error) {
      if (!delivered) {
        await withDeadline(route.abort("failed"), timeout, "Lot finalize observation cleanup did not settle.").catch(() => {});
      }
      if (!stopped) observed.resolve({ type: "response-error", error });
    }
  };
  const stop = async () => {
    if (removal) return removal;
    stopped = true;
    observed.resolve({ type: "response-error", error: new Error("Lot finalize observer stopped.") });
    if (page.isClosed?.()) return;
    removal = withDeadline(page.unroute(matcher, capture), timeout, "Lot finalize observer removal did not settle.");
    await removal;
  };
  try {
    await withDeadline(page.route(matcher, capture), timeout, "Lot finalize observer installation did not settle.");
  } catch (error) {
    await stop().catch(() => {});
    throw error;
  }
  return { promise: observed.promise, stop };
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
  const observer = await observeLotFinalize(page, normalizedPackageId, timeout);
  const finalizeResponsePromise = observer.promise;
  try {
    const approvalOutcomePromise = approvalGeneration === null
      ? null
      : waitForPageCondition(page, hasSettledAwardApproval, {
        afterGeneration: approvalGeneration,
      }, { timeout }).then(
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
    const lifecycle = finalizeOutcome.lifecycle;
    if (finalizeOutcome.status !== 200) {
      throw new Error(
        `Lot finalize failed: HTTP ${finalizeOutcome.status}${describeFinalizeFailure(lifecycle)}`,
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
    // Canonical rehydration can close the approval page. Remove the interceptor
    // before that handoff, while its owning browser surface still exists.
    await observer.stop();
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
  } finally {
    await observer.stop();
  }
}
