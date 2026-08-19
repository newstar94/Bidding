import assert from "node:assert/strict";
import test from "node:test";

import {
  applyPlanAggregateSnapshot,
  snapshotPlanAggregate,
} from "../../frontend/plans/planAggregateSnapshot.js";
import {
  normalizePackageVersionSelection,
  selectPackageVersion,
} from "../../frontend/shared/versionResolver.js";

/**
 * Mirrors the selection logic of renderGoiThauTable: which row of the version
 * family is displayed, and therefore whether the row keeps edit/delete actions
 * or degrades to a view-only historical version.
 */
function resolveDisplayedPackage(state, serverRow) {
  const root = serverRow.rootId || serverRow.id;
  const related = state.goithau.filter((pkg) => (pkg.rootId || pkg.id) === root);
  const byVersion = {};
  related.forEach((pkg) => {
    const version = pkg.phienBan || "00";
    if (!byVersion[version]) {
      byVersion[version] = pkg;
      return;
    }
    const planOf = (row) => (state.kehoach || []).find((plan) => String(plan.id) === String(row.keHoachId));
    const versionOf = (plan) => (plan ? Number.parseInt(plan.phienBan, 10) || 0 : 0);
    if (versionOf(planOf(pkg)) > versionOf(planOf(byVersion[version]))) byVersion[version] = pkg;
  });
  const uniqueVersions = Object.values(byVersion)
    .sort((a, b) => Number.parseInt(b.phienBan || 0, 10) - Number.parseInt(a.phienBan || 0, 10));
  const rememberedId = state.selectedPackageVersion?.[root];
  const remembered = rememberedId
    ? uniqueVersions.find((version) => String(version.id) === String(rememberedId))
    : null;
  const displayed = remembered
    || state.goithau.find((pkg) => String(pkg.id) === String(uniqueVersions[0]?.id))
    || serverRow;
  return { displayedId: displayed.id, viewOnly: displayed.id !== serverRow.id };
}

function planWithPackage() {
  const state = {
    kehoach: [{ id: "plan-00", rootId: "plan-00", phienBan: "00", isLatest: 1 }],
    goithau: [{
      id: "pkg-a",
      rootId: "pkg-a",
      phienBan: "00",
      isLatest: 1,
      keHoachId: "plan-00",
      phanLoList: [],
      timelineItems: [],
      ehsmtAdjustments: [],
    }],
    goithauhanghoa: [],
    thongtinmothau: [],
    hanghoaduthaunhathau: [],
    assignments: [],
    selectedPackageVersion: {},
  };
  return state;
}

function createPlanVersion(state) {
  state.kehoach.forEach((plan) => { plan.isLatest = 0; });
  state.kehoach.push({ id: "plan-01", rootId: "plan-00", phienBan: "01", isLatest: 1 });
  let sequence = 0;
  applyPlanAggregateSnapshot(state, snapshotPlanAggregate(state, {
    sourcePlanId: "plan-00",
    targetPlanId: "plan-01",
    timestamp: "2026-08-05 10:00:00",
    createId: (type) => `${type}-new-${++sequence}`,
  }));
  return state.goithau.find((pkg) => pkg.keHoachId === "plan-01");
}

test("a remembered package version follows the copy frozen by a new plan version", () => {
  const state = planWithPackage();
  // The user had the current package selected in the version droplist.
  state.selectedPackageVersion["pkg-a"] = "pkg-a";

  const inheritedRow = createPlanVersion(state);

  assert.equal(
    state.selectedPackageVersion["pkg-a"],
    inheritedRow.id,
    "the remembered selection must point at the inherited package row",
  );
  assert.deepEqual(resolveDisplayedPackage(state, inheritedRow), {
    displayedId: inheritedRow.id,
    viewOnly: false,
  });
});

test("an unrelated remembered selection is left untouched", () => {
  const state = planWithPackage();
  state.selectedPackageVersion["other-root"] = "other-pkg";

  createPlanVersion(state);

  assert.equal(state.selectedPackageVersion["other-root"], "other-pkg");
});

test("a remembered selection that no longer exists falls back to the current row", () => {
  const state = planWithPackage();
  state.selectedPackageVersion["pkg-a"] = "pkg-deleted";

  const result = resolveDisplayedPackage(state, state.goithau[0]);

  assert.equal(result.viewOnly, false, "a dangling selection must not hide edit and delete");
  assert.equal(result.displayedId, "pkg-a");
});

test("a remembered historical package version follows the inherited current snapshot", () => {
  const state = planWithPackage();
  state.goithau.push({
    ...state.goithau[0],
    id: "pkg-history",
    phienBan: "00",
    isLatest: 0,
  });
  state.selectedPackageVersion["pkg-a"] = "pkg-history";

  const inheritedRow = createPlanVersion(state);

  assert.equal(
    state.selectedPackageVersion["pkg-a"],
    inheritedRow.id,
    "a plan version must not retain a historical package selection",
  );
});

test("force sync normalizes a stale physical package id to the latest plan snapshot", () => {
  const state = planWithPackage();
  const inheritedRow = createPlanVersion(state);
  state.selectedPackageVersion["pkg-a"] = "pkg-a";
  delete state.selectedPackageVersionIntent?.["pkg-a"];

  normalizePackageVersionSelection(state);

  assert.equal(state.selectedPackageVersion["pkg-a"], inheritedRow.id);
  assert.equal(state.selectedPackageVersionIntent["pkg-a"], "latest");
});

test("force sync preserves an explicitly selected historical package", () => {
  const state = planWithPackage();
  const historicalRow = state.goithau[0];
  createPlanVersion(state);
  selectPackageVersion(state, "pkg-a", historicalRow.id);

  normalizePackageVersionSelection(state);

  assert.equal(state.selectedPackageVersion["pkg-a"], historicalRow.id);
  assert.equal(state.selectedPackageVersionIntent["pkg-a"], "historical");
});
