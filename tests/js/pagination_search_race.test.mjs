import assert from "node:assert/strict";
import test from "node:test";

import {
  loadPaginatedRecords,
  paginatedSearchHasChanged,
} from "../../frontend/shared/tableDataUtils.js";
import { paginatedProjectionStore } from "../../frontend/shared/PaginatedProjectionStore.js";

function deferred() {
  let resolve;
  let reject;
  const promise = new Promise((nextResolve, nextReject) => {
    resolve = nextResolve;
    reject = nextReject;
  });
  return { promise, resolve, reject };
}

function jsonResponse(payload) {
  return {
    ok: true,
    status: 200,
    statusText: "OK",
    headers: { get: () => "application/json" },
    json: async () => payload,
  };
}

function paginatedModel() {
  return {
    useServerSidePagination: true,
    state: {
      activeuser: { id: "user-1" },
      activerole: "manager",
      kehoach: [],
    },
    workspaceScope: { key: "user-1:org-1", organizationId: "org-1" },
    workspaceStorage: { getItem: () => "visibility-1" },
    getWorkspaceToken: () => "user-1:org-1@1",
    normalizeRecordKeys: (record) => record,
    entityIndexes: { invalidate() {} },
  };
}

test("a delayed search debounce does not reset a page rendered by sync", () => {
  const model = {
    useServerSidePagination: true,
    _lastPaginatedQueries: new Map([
      ["chuyengia", { page: 1, search: "phân trang thử nghiệm" }],
    ]),
  };

  assert.equal(
    paginatedSearchHasChanged(model, "chuyengia", "PHÂN TRANG THỬ NGHIỆM"),
    false,
  );
  assert.equal(
    paginatedSearchHasChanged(model, "chuyengia", "tìm kiếm mới"),
    true,
  );
  assert.equal(paginatedSearchHasChanged(model, "nhathau", "bất kỳ"), true);
  assert.equal(
    paginatedSearchHasChanged({ useServerSidePagination: false }, "chuyengia", "x"),
    true,
  );
});

test("a newer paginated search aborts the older request owned by the same list", async () => {
  const previousFetch = globalThis.fetch;
  const requests = [];
  const model = paginatedModel();
  globalThis.fetch = (url, options = {}) => {
    const pending = deferred();
    const request = { url: String(url), options, pending, aborted: false };
    requests.push(request);
    options.signal?.addEventListener?.("abort", () => {
      request.aborted = true;
      pending.reject(Object.assign(new Error("request aborted"), { name: "AbortError" }));
    }, { once: true });
    return pending.promise;
  };

  try {
    const first = loadPaginatedRecords(model, "kehoach", {
      page: 1,
      pageSize: 10,
      search: "old",
    }, { cancellationOwner: "plan-list" });
    const firstOutcome = first.then(
      (value) => ({ status: "fulfilled", value }),
      (reason) => ({ status: "rejected", reason }),
    );
    await new Promise((resolve) => setImmediate(resolve));
    const second = loadPaginatedRecords(model, "kehoach", {
      page: 1,
      pageSize: 10,
      search: "new",
    }, { cancellationOwner: "plan-list" });
    await new Promise((resolve) => setImmediate(resolve));

    assert.equal(requests.length, 2);
    assert.equal(requests[0].aborted, true, "stale search request must be cancelled");
    requests[1].pending.resolve(jsonResponse({
      items: [{ id: "new-result" }],
      totalItems: 1,
      hasMore: false,
      nextCursor: null,
    }));
    const staleOutcome = await firstOutcome;
    assert.equal(staleOutcome.status, "rejected");
    assert.equal(staleOutcome.reason?.name, "AbortError");
    const result = await second;
    assert.deepEqual(result.items.map((item) => item.id), ["new-result"]);
  } finally {
    if (previousFetch === undefined) delete globalThis.fetch;
    else globalThis.fetch = previousFetch;
  }
});

test("a fresh cache hit still aborts an older request owned by the same list", async () => {
  const previousFetch = globalThis.fetch;
  const requests = [];
  const model = paginatedModel();
  const freshParams = { page: 1, pageSize: 10, search: "cached" };
  paginatedProjectionStore(model).setValue("kehoach", freshParams, {
    items: [{ id: "cached-result" }],
    totalItems: 1,
    hasMore: false,
    nextCursor: null,
    fetchedAt: Date.now(),
  });
  globalThis.fetch = (url, options = {}) => {
    const pending = deferred();
    const request = { url: String(url), options, pending, aborted: false };
    requests.push(request);
    options.signal?.addEventListener?.("abort", () => {
      request.aborted = true;
      pending.reject(Object.assign(new Error("request aborted"), { name: "AbortError" }));
    }, { once: true });
    return pending.promise;
  };

  try {
    const first = loadPaginatedRecords(model, "kehoach", {
      page: 1,
      pageSize: 10,
      search: "old",
    }, { cancellationOwner: "plan-list" });
    const firstOutcome = first.then(
      (value) => ({ status: "fulfilled", value }),
      (reason) => ({ status: "rejected", reason }),
    );
    await new Promise((resolve) => setImmediate(resolve));

    const cached = await loadPaginatedRecords(
      model,
      "kehoach",
      freshParams,
      { cancellationOwner: "plan-list" },
    );

    assert.equal(requests.length, 1);
    assert.equal(requests[0].aborted, true, "cache hit must cancel the owner's stale request");
    const staleOutcome = await firstOutcome;
    assert.equal(staleOutcome.status, "rejected");
    assert.equal(staleOutcome.reason?.name, "AbortError");
    assert.deepEqual(cached.items.map((item) => item.id), ["cached-result"]);
  } finally {
    if (previousFetch === undefined) delete globalThis.fetch;
    else globalThis.fetch = previousFetch;
  }
});

test("different owners may load different queries for the same table concurrently", async () => {
  const previousFetch = globalThis.fetch;
  const requests = [];
  const model = paginatedModel();
  globalThis.fetch = (url, options = {}) => {
    const pending = deferred();
    const request = { url: String(url), options, pending, aborted: false };
    requests.push(request);
    options.signal?.addEventListener?.("abort", () => {
      request.aborted = true;
      pending.reject(Object.assign(new Error("request aborted"), { name: "AbortError" }));
    }, { once: true });
    return pending.promise;
  };

  try {
    const first = loadPaginatedRecords(
      model,
      "kehoach",
      { page: 1, pageSize: 10, search: "list" },
      { cancellationOwner: "plan-list" },
    );
    const second = loadPaginatedRecords(
      model,
      "kehoach",
      { pageSize: 200, keHoachId: "plan-2" },
      { cancellationOwner: "plan-workflow" },
    );
    const outcomes = [first, second].map((promise) => promise.then(
      (value) => ({ status: "fulfilled", value }),
      (reason) => ({ status: "rejected", reason }),
    ));
    await new Promise((resolve) => setImmediate(resolve));

    assert.equal(requests.length, 2);
    assert.deepEqual(requests.map((request) => request.aborted), [false, false]);
    requests.forEach((request, index) => request.pending.resolve(jsonResponse({
      items: [{ id: `result-${index + 1}` }],
      totalItems: 1,
      hasMore: false,
      nextCursor: null,
    })));
    assert.deepEqual((await Promise.all(outcomes)).map(({ status }) => status), [
      "fulfilled",
      "fulfilled",
    ]);
  } finally {
    if (previousFetch === undefined) delete globalThis.fetch;
    else globalThis.fetch = previousFetch;
  }
});

test("superseding one owner of a shared exact flight leaves the other owner attached", async () => {
  const previousFetch = globalThis.fetch;
  const requests = [];
  const model = paginatedModel();
  globalThis.fetch = (url, options = {}) => {
    const pending = deferred();
    const request = { url: String(url), options, pending, aborted: false };
    requests.push(request);
    options.signal?.addEventListener?.("abort", () => {
      request.aborted = true;
      pending.reject(Object.assign(new Error("request aborted"), { name: "AbortError" }));
    }, { once: true });
    return pending.promise;
  };

  try {
    const sharedParams = { page: 1, pageSize: 10, search: "shared" };
    const firstOwnerOld = loadPaginatedRecords(
      model,
      "kehoach",
      sharedParams,
      { cancellationOwner: "plan-list-a" },
    );
    const firstOwnerOldOutcome = firstOwnerOld.then(
      (value) => ({ status: "fulfilled", value }),
      (reason) => ({ status: "rejected", reason }),
    );
    const secondOwner = loadPaginatedRecords(
      model,
      "kehoach",
      sharedParams,
      { cancellationOwner: "plan-list-b" },
    );
    await new Promise((resolve) => setImmediate(resolve));
    assert.equal(requests.length, 1, "exact flights must still deduplicate across owners");

    const firstOwnerNew = loadPaginatedRecords(
      model,
      "kehoach",
      { ...sharedParams, search: "new" },
      { cancellationOwner: "plan-list-a" },
    );
    await new Promise((resolve) => setImmediate(resolve));
    assert.equal(requests.length, 2);
    assert.equal(requests[0].aborted, false, "the other owner still needs the shared flight");

    requests[0].pending.resolve(jsonResponse({
      items: [{ id: "shared-result" }],
      totalItems: 1,
      hasMore: false,
      nextCursor: null,
    }));
    requests[1].pending.resolve(jsonResponse({
      items: [{ id: "new-result" }],
      totalItems: 1,
      hasMore: false,
      nextCursor: null,
    }));

    const stale = await firstOwnerOldOutcome;
    assert.equal(stale.status, "rejected");
    assert.equal(stale.reason?.code, "PAGINATION_SUPERSEDED");
    assert.deepEqual((await secondOwner).items.map((item) => item.id), ["shared-result"]);
    assert.deepEqual((await firstOwnerNew).items.map((item) => item.id), ["new-result"]);
  } finally {
    if (previousFetch === undefined) delete globalThis.fetch;
    else globalThis.fetch = previousFetch;
  }
});

test("unowned callers may load different queries for the same table concurrently", async () => {
  const previousFetch = globalThis.fetch;
  const requests = [];
  const model = paginatedModel();
  globalThis.fetch = (url, options = {}) => {
    const pending = deferred();
    const request = { url: String(url), options, pending, aborted: false };
    requests.push(request);
    options.signal?.addEventListener?.("abort", () => {
      request.aborted = true;
      pending.reject(Object.assign(new Error("request aborted"), { name: "AbortError" }));
    }, { once: true });
    return pending.promise;
  };

  try {
    const first = loadPaginatedRecords(model, "kehoach", {
      pageSize: 200,
      keHoachId: "plan-1",
    });
    const second = loadPaginatedRecords(model, "kehoach", {
      pageSize: 200,
      keHoachId: "plan-2",
    });
    const outcomes = [first, second].map((promise) => promise.then(
      (value) => ({ status: "fulfilled", value }),
      (reason) => ({ status: "rejected", reason }),
    ));
    await new Promise((resolve) => setImmediate(resolve));

    assert.equal(requests.length, 2);
    assert.deepEqual(requests.map((request) => request.aborted), [false, false]);
    requests.forEach((request, index) => request.pending.resolve(jsonResponse({
      items: [{ id: `result-${index + 1}` }],
      totalItems: 1,
      hasMore: false,
      nextCursor: null,
    })));
    assert.deepEqual((await Promise.all(outcomes)).map(({ status }) => status), [
      "fulfilled",
      "fulfilled",
    ]);
  } finally {
    if (previousFetch === undefined) delete globalThis.fetch;
    else globalThis.fetch = previousFetch;
  }
});

test("rapid same-owner A to B to A starts a fresh final flight", async () => {
  const previousFetch = globalThis.fetch;
  const requests = [];
  const model = paginatedModel();
  globalThis.fetch = (url, options = {}) => {
    const pending = deferred();
    const request = { url: String(url), options, pending, aborted: false };
    requests.push(request);
    options.signal?.addEventListener?.("abort", () => {
      request.aborted = true;
      pending.reject(Object.assign(new Error("request aborted"), { name: "AbortError" }));
    }, { once: true });
    return pending.promise;
  };

  try {
    const queryA = { page: 1, pageSize: 10, search: "a" };
    const queryB = { page: 1, pageSize: 10, search: "b" };
    const outcome = (promise) => promise.then(
      (value) => ({ status: "fulfilled", value }),
      (reason) => ({ status: "rejected", reason }),
    );
    const calls = [outcome(loadPaginatedRecords(model, "kehoach", queryA, {
      cancellationOwner: "plan-list",
    }))];
    await new Promise((resolve) => setImmediate(resolve));
    calls.push(outcome(loadPaginatedRecords(model, "kehoach", queryB, {
      cancellationOwner: "plan-list",
    })));
    await new Promise((resolve) => setImmediate(resolve));
    calls.push(outcome(loadPaginatedRecords(model, "kehoach", queryA, {
      cancellationOwner: "plan-list",
    })));
    await new Promise((resolve) => setImmediate(resolve));

    assert.equal(requests.length, 3, "the final A must not dedupe into the aborted first A");
    assert.deepEqual(requests.map(({ aborted }) => aborted), [true, true, false]);
    requests[2].pending.resolve(jsonResponse({
      items: [{ id: "final-a" }],
      totalItems: 1,
      hasMore: false,
      nextCursor: null,
    }));
    const results = await Promise.all(calls);
    assert.deepEqual(results.map(({ status }) => status), ["rejected", "rejected", "fulfilled"]);
    assert.deepEqual(results[2].value.items.map(({ id }) => id), ["final-a"]);
  } finally {
    if (previousFetch === undefined) delete globalThis.fetch;
    else globalThis.fetch = previousFetch;
  }
});

test("a response from an obsolete authorization scope cannot merge or cache rows", async () => {
  const previousFetch = globalThis.fetch;
  const pending = deferred();
  const model = paginatedModel();
  let visibilityToken = "wide";
  model.workspaceStorage = { getItem: () => visibilityToken };
  globalThis.fetch = (_url, options = {}) => {
    options.signal?.addEventListener?.("abort", () => {
      pending.reject(Object.assign(new Error("request aborted"), { name: "AbortError" }));
    }, { once: true });
    return pending.promise;
  };

  try {
    const params = { page: 1, pageSize: 10, search: "old-scope" };
    const oldScopeRequest = loadPaginatedRecords(model, "kehoach", params);
    const outcome = oldScopeRequest.then(
      (value) => ({ status: "fulfilled", value }),
      (reason) => ({ status: "rejected", reason }),
    );
    await new Promise((resolve) => setImmediate(resolve));
    visibilityToken = "narrow";
    pending.resolve(jsonResponse({
      items: [{ id: "revoked-old" }],
      totalItems: 1,
      hasMore: false,
      nextCursor: null,
    }));

    const stale = await outcome;
    assert.equal(stale.status, "rejected");
    assert.equal(stale.reason?.code, "PAGINATION_AUTHORIZATION_SCOPE_CHANGED");
    assert.deepEqual(model.state.kehoach, []);
    assert.equal(
      paginatedProjectionStore(model).read("kehoach", params),
      null,
      "obsolete rows must not be cached under the narrower scope",
    );
  } finally {
    if (previousFetch === undefined) delete globalThis.fetch;
    else globalThis.fetch = previousFetch;
  }
});

test("same owner cancels its predecessor across an authorization-scope change", async () => {
  const previousFetch = globalThis.fetch;
  const requests = [];
  const model = paginatedModel();
  let visibilityToken = "wide";
  model.workspaceStorage = { getItem: () => visibilityToken };
  globalThis.fetch = (url, options = {}) => {
    const pending = deferred();
    const request = { url: String(url), pending, aborted: false };
    requests.push(request);
    options.signal?.addEventListener?.("abort", () => {
      request.aborted = true;
      pending.reject(Object.assign(new Error("request aborted"), { name: "AbortError" }));
    }, { once: true });
    return pending.promise;
  };

  try {
    const first = loadPaginatedRecords(model, "kehoach", {
      page: 1,
      search: "wide",
    }, { cancellationOwner: "plan-list" });
    const firstOutcome = first.then(
      (value) => ({ status: "fulfilled", value }),
      (reason) => ({ status: "rejected", reason }),
    );
    await new Promise((resolve) => setImmediate(resolve));
    visibilityToken = "narrow";
    const second = loadPaginatedRecords(model, "kehoach", {
      page: 1,
      search: "narrow",
    }, { cancellationOwner: "plan-list" });
    await new Promise((resolve) => setImmediate(resolve));

    assert.deepEqual(requests.map(({ aborted }) => aborted), [true, false]);
    requests[1].pending.resolve(jsonResponse({
      items: [{ id: "allowed-new" }],
      totalItems: 1,
      hasMore: false,
      nextCursor: null,
    }));
    assert.equal((await firstOutcome).status, "rejected");
    assert.deepEqual((await second).items.map(({ id }) => id), ["allowed-new"]);
    assert.deepEqual(model.state.kehoach.map(({ id }) => id), ["allowed-new"]);
  } finally {
    if (previousFetch === undefined) delete globalThis.fetch;
    else globalThis.fetch = previousFetch;
  }
});
