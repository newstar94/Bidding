import assert from "node:assert/strict";
import test from "node:test";

import {
  captureProjectionAuthorizationScope,
  PaginatedProjectionStore,
  projectionAuthorizationScopeIsCurrent,
  projectionKeyMatchesScopeAndTable,
} from "../../frontend/shared/PaginatedProjectionStore.js";

function model() {
  return {
    state: { activeuser: { id: "user-1" }, activerole: "manager" },
    workspaceScope: { key: "user-1:org-1", organizationId: "org-1" },
    workspaceStorage: { getItem: () => "visibility-1" },
    getWorkspaceToken: () => "user-1:org-1@1",
  };
}

test("projection key isolates every response-shaping query and scope dimension", () => {
  const target = model();
  const store = new PaginatedProjectionStore(target);
  const base = store.key("kehoach", { page: 1, pageSize: 10, search: "a", sortBy: "id" });
  const variants = [
    store.key("kehoach", { page: 2, pageSize: 10, search: "a", sortBy: "id" }),
    store.key("kehoach", { page: 1, pageSize: 20, search: "a", sortBy: "id" }),
    store.key("kehoach", { page: 1, pageSize: 10, search: "b", sortBy: "id" }),
  ];
  target.state.activerole = "employee";
  variants.push(store.key("kehoach", { page: 1, pageSize: 10, search: "a", sortBy: "id" }));
  target.state.activerole = "manager";
  target.assignmentRevision = 2;
  variants.push(store.key("kehoach", { page: 1, pageSize: 10, search: "a", sortBy: "id" }));
  assert.equal(new Set([base, ...variants]).size, 6);
});

test("projection scope matching cancels only the same table and authorization scope", () => {
  const target = model();
  const store = new PaginatedProjectionStore(target);
  const lease = { token: target.getWorkspaceToken(), scope: target.workspaceScope.key };
  const key = store.key("kehoach", { page: 1, search: "old" }, lease);

  assert.equal(projectionKeyMatchesScopeAndTable(key, target, "kehoach", lease), true);
  assert.equal(projectionKeyMatchesScopeAndTable(key, target, "goithau", lease), false);
  assert.equal(projectionKeyMatchesScopeAndTable(
    key,
    target,
    "kehoach",
    { ...lease, token: "user-1:org-1@2" },
  ), false);
  target.state.activerole = "employee";
  assert.equal(projectionKeyMatchesScopeAndTable(key, target, "kehoach", lease), false);
});

test("every authorization revision invalidates a captured projection scope", () => {
  for (const field of [
    "visibilityRevision",
    "permissionRevision",
    "assignmentRevision",
    "recordScopeRevision",
  ]) {
    const target = model();
    const captured = captureProjectionAuthorizationScope(target);
    target[field] = 1;
    assert.equal(
      projectionAuthorizationScopeIsCurrent(target, captured),
      false,
      `${field} must invalidate an in-flight projection`,
    );
  }
});

test("a captured projection lease cannot read or write after visibility changes", () => {
  const target = model();
  let visibilityToken = "wide";
  target.workspaceStorage = { getItem: () => visibilityToken };
  const store = new PaginatedProjectionStore(target);
  const oldLease = {
    token: target.getWorkspaceToken(),
    scope: target.workspaceScope.key,
    projectionAuthorizationScope: captureProjectionAuthorizationScope(target),
  };
  const params = { page: 1 };
  visibilityToken = "narrow";
  assert.throws(
    () => store.setValue("kehoach", params, { items: [{ id: "old" }], fetchedAt: 1 }, oldLease),
    (error) => error?.code === "PAGINATION_AUTHORIZATION_SCOPE_CHANGED",
  );
  assert.equal(store.read("kehoach", params, oldLease, 2), null);
  assert.equal(store.read("kehoach", params, {}, 2), null);
});

test("disposing a pending projection prevents a signal-ignoring loader from restoring cache", async () => {
  const target = model();
  const store = new PaginatedProjectionStore(target);
  let release;
  const pending = store.query("kehoach", { page: 1 }, () => (
    new Promise((resolve) => { release = resolve; })
  ));
  const outcome = pending.then(
    (value) => ({ status: "fulfilled", value }),
    (reason) => ({ status: "rejected", reason }),
  );
  await new Promise((resolve) => setImmediate(resolve));

  store.disposeWorkspace();
  release({ items: [{ id: "stale" }], totalItems: 1 });
  const settled = await outcome;

  assert.equal(settled.status, "rejected");
  assert.equal(settled.reason?.name, "AbortError");
  assert.equal(store.cache.size, 0);
  assert.equal(store.flights.size, 0);
});

test("projection store deduplicates exact flights and purges cache plus requests on scope disposal", async () => {
  const target = model();
  const store = new PaginatedProjectionStore(target);
  let calls = 0;
  let release;
  const loader = () => {
    calls += 1;
    return new Promise((resolve) => { release = resolve; });
  };
  const first = store.query("goithau", { page: 1 }, loader);
  const second = store.query("goithau", { page: 1 }, loader);
  assert.equal(first, second);
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(calls, 1);
  release({ items: [], totalItems: 0 });
  await first;
  assert.equal(store.cache.size, 1);
  store.disposeWorkspace();
  assert.equal(store.cache.size, 0);
  assert.equal(store.flights.size, 0);
});

test("projection store uses bounded LRU retention", () => {
  const target = model();
  const store = new PaginatedProjectionStore(target, { maxEntries: 2 });
  store.setValue("kehoach", { page: 1 }, { items: [], fetchedAt: 1 });
  store.setValue("kehoach", { page: 2 }, { items: [], fetchedAt: 2 });
  store.setValue("kehoach", { page: 3 }, { items: [], fetchedAt: 3 });
  assert.equal(store.cache.size, 2);
  assert.equal(store.read("kehoach", { page: 1 }, {}, 4), null);
});
