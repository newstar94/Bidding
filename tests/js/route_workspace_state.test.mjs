import test from "node:test";
import assert from "node:assert/strict";

import { RouteRegistry } from "../../frontend/app/RouteRegistry.js";
import { PackageWorkspaceState } from "../../frontend/packages/detail/PackageWorkspaceState.js";


test("route registry round-trips package workspace state with stable lot scope", () => {
  const route = {
    pathname: "/goithau-detail/GT-01",
    packageId: "package/01",
    workflowTab: "eval_fin",
    evaluationRoundId: "financial",
    bidId: "bid ? 01",
    detailTab: "financial",
    lotScope: { mode: "selected", ids: ["lot-2", "lot-1", "lot-2"] },
  };

  const serialized = RouteRegistry.serialize(route, "https://example.test/goithau-detail/GT-01?legacy=keep");
  const parsed = RouteRegistry.parse(serialized);

  assert.deepEqual(parsed, {
    pathname: "/goithau-detail/GT-01",
    packageId: "package/01",
    workflowTab: "eval_fin",
    evaluationRoundId: "financial",
    bidId: "bid ? 01",
    detailTab: "financial",
    lotScope: { mode: "selected", ids: ["lot-1", "lot-2"] },
  });
  assert.match(serialized, /legacy=keep/u);
});


test("route registry rejects navigation that would silently discard dirty state", () => {
  const calls = [];
  const result = RouteRegistry.navigate(
    { pathname: "/goithau-detail/GT-02", packageId: "package-2" },
    {
      preserveDirty: true,
      isDirty: () => true,
      historyAdapter: {
        pushState: (...args) => calls.push(args),
        replaceState: (...args) => calls.push(args),
      },
      currentUrl: "https://example.test/goithau-detail/GT-01",
    },
  );

  assert.deepEqual(result, { status: "blocked", reason: "DIRTY_STATE" });
  assert.deepEqual(calls, []);
});


test("package workspace owns transitions, subscriptions and serializable snapshots", () => {
  const workspace = new PackageWorkspaceState();
  const observed = [];
  workspace.subscribe((state) => observed.push(state));

  workspace.load({
    packageId: "package-1",
    workflowTab: "preparation",
    evaluationRoundId: "technical",
    bidId: "",
    detailTab: "validity",
    lotScope: { mode: "all", ids: [] },
  });
  const selected = workspace.transition({ type: "SELECT_TAB", tab: "eval_tech" });
  workspace.transition({ type: "SELECT_BID", bidId: "bid-1" });
  workspace.transition({ type: "SET_DIRTY", dirty: true });
  const blocked = workspace.transition({ type: "LOAD_ROUTE", route: { packageId: "package-2" } });

  assert.equal(selected.state.workflowTab, "eval_tech");
  assert.deepEqual(selected.effects, [{ type: "SYNC_ROUTE" }]);
  assert.deepEqual(blocked.effects, [{ type: "CONFIRM_DIRTY_NAVIGATION" }]);
  assert.deepEqual(workspace.snapshot(), {
    packageId: "package-1",
    workflowTab: "eval_tech",
    evaluationRoundId: "technical",
    bidId: "bid-1",
    detailTab: "validity",
    lotScope: { mode: "all", ids: [] },
  });
  assert.equal(observed.length, 4);

  workspace.dispose();
  assert.throws(() => workspace.transition({ type: "SET_DIRTY", dirty: false }), /disposed/u);
});
