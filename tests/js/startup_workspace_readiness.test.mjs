import assert from "node:assert/strict";
import test from "node:test";
import {
  hasAuthoritativeWorkspaceReadiness,
  readWorkspaceStartupReadiness,
} from "../../scripts/startup_readiness_metrics.mjs";

function withReadinessFixture(phase, marks, callback) {
  const previousDocument = Object.getOwnPropertyDescriptor(globalThis, "document");
  const previousPerformance = Object.getOwnPropertyDescriptor(globalThis, "performance");
  Object.defineProperty(globalThis, "document", { configurable: true, value: {
    getElementById: () => phase === undefined ? null : {
      dataset: { startupReconciliationPhase: phase },
    },
  } });
  Object.defineProperty(globalThis, "performance", { configurable: true, value: {
    getEntriesByName: (name) => marks[name] === undefined ? [] : [{ startTime: marks[name] }],
  } });
  try { callback(); } finally {
    if (previousDocument) Object.defineProperty(globalThis, "document", previousDocument);
    else delete globalThis.document;
    Object.defineProperty(globalThis, "performance", previousPerformance);
  }
}

test("admin measurement reports workspace synchronization as not applicable", () => {
  withReadinessFixture(undefined, {}, () => {
    const sample = readWorkspaceStartupReadiness({ waitForTerminal: true });
    assert.equal(sample.workspaceReconciliationApplicable, false);
    assert.equal(sample.workspaceSynchronizedMs, null);
    assert.equal(sample.workspaceReconciliationMs, null);
    assert.equal(hasAuthoritativeWorkspaceReadiness(sample), true);
  });
});

for (const phase of ["LOCAL_READY", "RECONCILING", ""]) {
  test(`workspace ${phase || "unknown"} cannot be mistaken for synchronized readiness`, () => {
    withReadinessFixture(phase, {}, () => {
      assert.equal(readWorkspaceStartupReadiness({ waitForTerminal: true }), null);
      assert.equal(hasAuthoritativeWorkspaceReadiness(readWorkspaceStartupReadiness()), false);
    });
  });
}

test("workspace readiness records authoritative completion separately from the loader", () => {
  withReadinessFixture("RECONCILED", {
    "bf:loader:hidden": 150,
    "bf:workspace-reconciliation:RECONCILING": 200,
    "bf:workspace-reconciliation:RECONCILED": 700,
  }, () => {
    const sample = readWorkspaceStartupReadiness({ waitForTerminal: true });
    assert.equal(sample.workspaceSynchronizedMs, 700);
    assert.equal(sample.workspaceReconciliationMs, 500);
    assert.equal(hasAuthoritativeWorkspaceReadiness(sample), true);
  });
});

for (const phase of ["OFFLINE_LOCAL", "SYNC_ERROR", "CONFLICT"]) {
  test(`workspace ${phase} settles without claiming authoritative synchronization`, () => {
    withReadinessFixture(phase, {
      "bf:workspace-reconciliation:RECONCILING": 200,
      "bf:workspace-reconciliation:RECONCILED": 400,
      [`bf:workspace-reconciliation:${phase}`]: 700,
    }, () => {
      const sample = readWorkspaceStartupReadiness({ waitForTerminal: true });
      assert.equal(sample.workspaceReconciliationSettledMs, 700);
      assert.equal(sample.workspaceSynchronizedMs, null);
      assert.equal(hasAuthoritativeWorkspaceReadiness(sample), false);
    });
  });
}

test("a success phase without its completion mark cannot pass the workspace gate", () => {
  withReadinessFixture("RECONCILED", {}, () => {
    assert.equal(hasAuthoritativeWorkspaceReadiness(readWorkspaceStartupReadiness()), false);
  });
});
