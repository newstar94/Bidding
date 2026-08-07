import assert from "node:assert/strict";
import test from "node:test";

import { snapshotPlanAggregate } from "../../frontend/plans/planAggregateSnapshot.js";
import { hydratePlanPackageRecords } from "../../frontend/shared/tableDataUtils.js";

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
