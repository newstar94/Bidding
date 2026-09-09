import assert from "node:assert/strict";
import test from "node:test";

import {
  invalidatePaginatedQueryCache,
  cachePaginatedRecords,
  loadPaginatedRecords,
  paginatedSearchHasChanged,
} from "../../frontend/shared/tableDataUtils.js";
import { bindPaginatedTableSearch } from "../../frontend/app/BiddingControllerForms.js";
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

test("pagination hydration preserves an in-flight package mutation in shared detail state", () => {
  const model = paginatedModel();
  const pending = { id: "package-1", trangThai: "Đang chấm thầu", rowVersion: 3 };
  model.state.goithau = [pending];
  model.getMutationQueue = () => ({ upserts: { goithau: { "package-1": pending } } });
  cachePaginatedRecords(model, "goithau", [
    { id: "package-1", trangThai: "Đã mở thầu", rowVersion: 3 },
  ]);
  assert.equal(model.state.goithau[0].trangThai, "Đang chấm thầu");
});

test("pending hydration persists local fields without contaminating canonical cache or adding absent IDs", () => {
  const model = paginatedModel();
  const writes = [];
  model.db = { putRecords: async (table, rows) => { writes.push({ table, rows }); } };
  const patch = { id: "package-1", trangThai: "Đang chấm thầu", rowVersion: 3 };
  model.getMutationQueue = () => ({ patches: { goithau: { "package-1": patch } },
    upserts: { goithau: { absent: { id: "absent", rowVersion: 1 } } } });
  const canonical = { id: "package-1", tenGoiThau: "Server title", trangThai: "Đã mở thầu", rowVersion: 3 };
  const result = cachePaginatedRecords(model, "goithau", [canonical]);
  assert.equal(result[0].trangThai, "Đã mở thầu");
  assert.equal(model.state.goithau[0].trangThai, "Đang chấm thầu");
  assert.equal(model.state.goithau[0].tenGoiThau, "Server title");
  assert.deepEqual(writes[0].rows, model.state.goithau);
  assert.deepEqual(model.state.goithau.map(row => row.id), ["package-1"]);
  assert.equal(patch.rowVersion, 3);
  model.getMutationQueue = () => null;
  cachePaginatedRecords(model, "goithau", [{ ...canonical, trangThai: "Đang chấm thầu", rowVersion: 4 }]);
  assert.equal(model.state.goithau[0].rowVersion, 4);
});

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

test("a search input resets pagination before a background render can adopt the new query", () => {
  const previousDocument = globalThis.document;
  const input = new EventTarget();
  input.value = "tìm kiếm mới";
  const model = {
    useServerSidePagination: true,
    currentPage: { chuyengia: 2 },
    _lastPaginatedQueries: new Map([
      ["chuyengia", { page: 2, search: "phân trang thử nghiệm" }],
    ]),
  };
  let renders = 0;
  globalThis.document = {
    getElementById: (id) => id === "search-chuyengia" ? input : null,
  };

  try {
    const debouncedRender = bindPaginatedTableSearch(model, {
      inputId: "search-chuyengia",
      table: "chuyengia",
      render: () => { renders += 1; },
    });
    input.dispatchEvent(new Event("input"));
    assert.equal(model.currentPage.chuyengia, 1, "the input event must reset the page synchronously");

    model._lastPaginatedQueries.set("chuyengia", { page: 1, search: input.value });
    model.currentPage.chuyengia = 2;
    debouncedRender.flush();
    assert.equal(model.currentPage.chuyengia, 2, "the delayed render must not undo later pagination");
    assert.equal(renders, 1);
  } finally {
    globalThis.document = previousDocument;
  }
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
    requests.forEach(({ pending }) => pending.resolve(jsonResponse({
      items: [], totalItems: 0, hasMore: false, nextCursor: null,
    })));
    if (previousFetch === undefined) delete globalThis.fetch;
    else globalThis.fetch = previousFetch;
  }
});

test("an aborted pre-commit response cannot repopulate cache when transport ignores abort", async () => {
  const previousFetch = globalThis.fetch;
  const requests = [];
  const model = paginatedModel();
  globalThis.fetch = (url, options = {}) => {
    const pending = deferred();
    const request = { url: String(url), options, pending, aborted: false };
    requests.push(request);
    options.signal?.addEventListener?.("abort", () => {
      request.aborted = true;
      // Deliberately leave the transport pending. A late response must still be fenced.
    }, { once: true });
    return pending.promise;
  };

  try {
    const params = { page: 1, pageSize: 10, search: "" };
    const staleRequest = loadPaginatedRecords(
      model,
      "hopdong",
      params,
      { cancellationOwner: "contract-list" },
    );
    const staleOutcome = staleRequest.then(
      (value) => ({ status: "fulfilled", value }),
      (reason) => ({ status: "rejected", reason }),
    );
    await new Promise((resolve) => setImmediate(resolve));

    invalidatePaginatedQueryCache(model, "hopdong", { abortInFlight: true });
    const canonicalRequest = loadPaginatedRecords(
      model,
      "hopdong",
      params,
      { cancellationOwner: "contract-list" },
    );
    await new Promise((resolve) => setImmediate(resolve));
    assert.equal(requests.length, 2);

    requests[1].pending.resolve(jsonResponse({
      items: [{ id: "contract-v2", trangThaiHopDong: "Đã hoàn thành" }],
      totalItems: 1,
      hasMore: false,
      nextCursor: null,
    }));
    const canonical = await canonicalRequest;
    assert.equal(canonical.items[0].trangThaiHopDong, "Đã hoàn thành");

    requests[0].pending.resolve(jsonResponse({
      items: [{ id: "contract-v1", trangThaiHopDong: "Đang thực hiện" }],
      totalItems: 1,
      hasMore: false,
      nextCursor: null,
    }));
    await new Promise((resolve) => setImmediate(resolve));

    const stale = await staleOutcome;
    assert.equal(stale.status, "rejected");
    assert.equal(stale.reason?.name, "AbortError");
    assert.equal(
      paginatedProjectionStore(model).read("hopdong", params)?.items?.[0]?.trangThaiHopDong,
      "Đã hoàn thành",
      "the late pre-commit response must not overwrite the canonical cache",
    );
  } finally {
    requests.forEach(({ pending }) => pending.resolve(jsonResponse({
      items: [], totalItems: 0, hasMore: false, nextCursor: null,
    })));
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
    requests.forEach(({ pending }) => pending.resolve(jsonResponse({
      items: [], totalItems: 0, hasMore: false, nextCursor: null,
    })));
    if (previousFetch === undefined) delete globalThis.fetch;
    else globalThis.fetch = previousFetch;
  }
});

test("canonical mutation invalidation fences an older in-flight page before revalidation", async () => {
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
    const params = { page: 1, pageSize: 10, search: "" };
    const staleRequest = loadPaginatedRecords(
      model,
      "hopdong",
      params,
      { cancellationOwner: "contract-list" },
    );
    const staleOutcome = staleRequest.then(
      (value) => ({ status: "fulfilled", value }),
      (reason) => ({ status: "rejected", reason }),
    );
    await new Promise((resolve) => setImmediate(resolve));

    // A successful POST /api/sync has committed a newer contract version.
    // The pre-commit pagination response must not be reused by the canonical render.
    invalidatePaginatedQueryCache(model, "hopdong", { abortInFlight: true });
    const canonicalRequest = loadPaginatedRecords(
      model,
      "hopdong",
      params,
      { cancellationOwner: "contract-list" },
    );
    await new Promise((resolve) => setImmediate(resolve));

    assert.equal(requests.length, 2, "canonical revalidation must start a post-commit request");
    assert.equal(requests[0].aborted, true, "the pre-commit page request must be fenced");
    requests[1].pending.resolve(jsonResponse({
      items: [{ id: "contract-v2", trangThaiHopDong: "Đã hoàn thành" }],
      totalItems: 1,
      hasMore: false,
      nextCursor: null,
    }));

    const stale = await staleOutcome;
    assert.equal(stale.status, "rejected");
    assert.equal(stale.reason?.name, "AbortError");
    const canonical = await canonicalRequest;
    assert.equal(canonical.items[0].trangThaiHopDong, "Đã hoàn thành");
    assert.equal(
      paginatedProjectionStore(model).read("hopdong", params)?.items?.[0]?.trangThaiHopDong,
      "Đã hoàn thành",
      "only the post-commit page may repopulate the projection cache",
    );
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
