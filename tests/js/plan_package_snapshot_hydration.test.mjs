import assert from "node:assert/strict";
import test from "node:test";

import { snapshotPlanAggregate } from "../../frontend/plans/planAggregateSnapshot.js";
import {
  hydratePlanPackageRecords,
  loadPaginatedRecords,
} from "../../frontend/shared/tableDataUtils.js";

function deferred() {
  let resolve;
  const promise = new Promise((done) => {
    resolve = done;
  });
  return { promise, resolve };
}

function response(payload) {
  return new Response(JSON.stringify(payload), {
    status: 200,
    headers: { "content-type": "application/json" },
  });
}

test("plan version inheritance hydrates source packages when the browser cache is cold", async () => {
  const previousFetch = globalThis.fetch;
  const sourcePackage = {
    id: "pkg-v01-plan00",
    rootId: "pkg-root",
    phienBan: "01",
    isLatest: 1,
    keHoachId: "plan-00",
    maGoiThau: "GT-01",
    tenGoiThau: "Gói thầu kiểm thử",
    phanLoList: [],
  };
  globalThis.fetch = async (url) => {
    const parsed = new URL(String(url), "http://localhost");
    assert.equal(parsed.searchParams.get("table"), "goithau");
    assert.equal(parsed.searchParams.get("keHoachId"), "plan-00");
    return new Response(JSON.stringify({
      items: [sourcePackage],
      totalItems: 1,
      hasMore: false,
      nextCursor: null,
    }), {
      status: 200,
      headers: { "content-type": "application/json" },
    });
  };

  const model = {
    useServerSidePagination: true,
    state: {
      goithau: [],
      goithauhanghoa: [],
      thongtinmothau: [],
      hanghoaduthaunhathau: [],
      assignments: [],
    },
    normalizeRecordKeys: (record) => record,
  };

  try {
    await hydratePlanPackageRecords(model, "plan-00");
    assert.equal(model.state.goithau.length, 1, "source package must be present before snapshotting");

    let sequence = 0;
    const aggregate = snapshotPlanAggregate(model.state, {
      sourcePlanId: "plan-00",
      targetPlanId: "plan-01",
      timestamp: "2026-08-07 14:00:00",
      sourcePackages: model.state.goithau,
      createId: (type) => `${type}-${++sequence}`,
    });

    assert.equal(aggregate.goithau.length, 1);
    assert.equal(aggregate.goithau[0].rootId, "pkg-root");
    assert.equal(aggregate.goithau[0].phienBan, "01", "plan snapshot must preserve package version number");
    assert.equal(aggregate.goithau[0].keHoachId, "plan-01");
  } finally {
    if (previousFetch === undefined) delete globalThis.fetch;
    else globalThis.fetch = previousFetch;
  }
});

test("plan snapshot is domain-equivalent with a cold or warm package cache", async () => {
  const previousFetch = globalThis.fetch;
  const sourcePackage = {
    id: "pkg-v01-plan00",
    rootId: "pkg-root",
    phienBan: "01",
    isLatest: 1,
    keHoachId: "plan-00",
    maGoiThau: "GT-01",
    tenGoiThau: "Gói thầu kiểm thử",
    phanLoList: [],
  };
  globalThis.fetch = async () => response({
    items: [sourcePackage], totalItems: 1, hasMore: false, nextCursor: null,
  });

  const modelFor = (packages) => ({
    useServerSidePagination: true,
    state: {
      goithau: packages.map((item) => ({ ...item })),
      goithauhanghoa: [],
      thongtinmothau: [],
      hanghoaduthaunhathau: [],
      assignments: [],
    },
    normalizeRecordKeys: (record) => record,
  });
  const snapshotFor = async (model) => {
    await hydratePlanPackageRecords(model, "plan-00");
    let sequence = 0;
    return snapshotPlanAggregate(model.state, {
      sourcePlanId: "plan-00",
      targetPlanId: "plan-01",
      timestamp: "2026-08-07 14:00:00",
      createId: (type) => `${type}-${++sequence}`,
    });
  };

  try {
    const cold = await snapshotFor(modelFor([]));
    const warm = await snapshotFor(modelFor([sourcePackage]));

    assert.deepEqual(warm, cold);
  } finally {
    if (previousFetch === undefined) delete globalThis.fetch;
    else globalThis.fetch = previousFetch;
  }
});

test("plan package hydration rejects a stale workspace response without touching the new state or database", async () => {
  const previousFetch = globalThis.fetch;
  const request = deferred();
  globalThis.fetch = () => request.promise;
  let token = "user:org-a@1";
  const writes = [];
  const model = {
    useServerSidePagination: true,
    getWorkspaceToken: () => token,
    isWorkspaceCurrent: (candidate) => candidate === token,
    workspaceScope: { key: "user:org-a" },
    state: { goithau: [{ id: "pkg-a-current" }] },
    db: {
      async putRecords(table, records) {
        writes.push({ workspace: "org-a", table, records });
      },
    },
    entityIndexes: { invalidate() {} },
    normalizeRecordKeys: (record) => record,
  };

  try {
    const hydration = hydratePlanPackageRecords(model, "plan-a");
    await Promise.resolve();
    token = "user:org-b@2";
    model.workspaceScope = { key: "user:org-b" };
    model.state = { goithau: [{ id: "pkg-b-current" }] };
    model.db = {
      async putRecords(table, records) {
        writes.push({ workspace: "org-b", table, records });
      },
    };
    request.resolve(response({
      items: [{ id: "pkg-a-stale", keHoachId: "plan-a" }],
      totalItems: 1,
      hasMore: false,
      nextCursor: null,
    }));

    await assert.rejects(hydration, (error) => (
      error?.name === "AbortError" && error?.code === "WORKSPACE_CHANGED"
    ));
    assert.deepEqual(model.state.goithau, [{ id: "pkg-b-current" }]);
    assert.deepEqual(writes, []);
  } finally {
    if (previousFetch === undefined) delete globalThis.fetch;
    else globalThis.fetch = previousFetch;
  }
});

test("paginated loading rejects a stale workspace response before cache or query metadata changes", async () => {
  const previousFetch = globalThis.fetch;
  const request = deferred();
  globalThis.fetch = () => request.promise;
  let token = "user:org-a@1";
  const writes = [];
  const model = {
    useServerSidePagination: true,
    getWorkspaceToken: () => token,
    isWorkspaceCurrent: (candidate) => candidate === token,
    workspaceScope: { key: "user:org-a" },
    state: { goithau: [{ id: "pkg-a-current" }] },
    db: {
      async putRecords(table, records) {
        writes.push({ workspace: "org-a", table, records });
      },
    },
    entityIndexes: { invalidate() {} },
    normalizeRecordKeys: (record) => record,
  };

  try {
    const loading = loadPaginatedRecords(model, "goithau", { page: 1, pageSize: 10 });
    await Promise.resolve();
    token = "user:org-b@2";
    model.workspaceScope = { key: "user:org-b" };
    model.state = { goithau: [{ id: "pkg-b-current" }] };
    model.db = {
      async putRecords(table, records) {
        writes.push({ workspace: "org-b", table, records });
      },
    };
    request.resolve(response({
      items: [{ id: "pkg-a-stale" }],
      totalItems: 1,
      hasMore: false,
      nextCursor: null,
    }));

    await assert.rejects(loading, (error) => (
      error?.name === "AbortError" && error?.code === "WORKSPACE_CHANGED"
    ));
    assert.deepEqual(model.state.goithau, [{ id: "pkg-b-current" }]);
    assert.deepEqual(writes, []);
    assert.equal(model._lastPaginatedQueries, undefined);
  } finally {
    if (previousFetch === undefined) delete globalThis.fetch;
    else globalThis.fetch = previousFetch;
  }
});
