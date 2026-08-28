import assert from "node:assert/strict";
import test from "node:test";

import { PaginatedProjectionStore } from "../../frontend/shared/PaginatedProjectionStore.js";

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
