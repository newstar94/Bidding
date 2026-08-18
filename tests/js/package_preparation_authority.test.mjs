import assert from "node:assert/strict";
import test from "node:test";

import { savePackagePreparation } from "../../frontend/packages/packagePreparation.js";

function deferred() {
  let resolve;
  const promise = new Promise((done) => {
    resolve = done;
  });
  return { promise, resolve };
}

function sourcePackage(overrides = {}) {
  return {
    id: "package-00",
    rootId: "package-root",
    phienBan: "00",
    isLatest: 1,
    rowVersion: 3,
    keHoachId: "plan-1",
    maGoiThau: "PKG-01",
    tenGoiThau: "Gói thầu 01",
    trangThai: "Đang chấm thầu",
    thoiGianDangTai: "2026-08-01 08:00:00",
    thoiGianDongThau: "2026-08-05 08:00:00",
    phanLoList: [],
    awardedPhanLoList: [],
    timelineItems: [],
    ehsmtAdjustments: [],
    ...overrides,
  };
}

function buildController(pkg = sourcePackage()) {
  const staged = [];
  const state = {
    goithau: [pkg],
    goithauhanghoa: [],
    thongtinmothau: [],
    hanghoaduthaunhathau: [],
    assignments: [],
  };
  const model = {
    state,
    getLatestPlan: () => ({ id: "plan-1" }),
    getCurrentDateTimeString: () => "2026-08-18 12:00:00",
    commitLocalMutation(table, { records }) {
      staged.push([table, ...records.map((record) => record.id)]);
    },
    async persistData() {},
    async flushMutationOutbox() {},
  };
  return {
    controller: {
      model,
      async autoSync() { return { ok: true }; },
    },
    model,
    state,
    staged,
  };
}

function deterministicIds() {
  let sequence = 0;
  return (type) => `${type}-new-${++sequence}`;
}

test("package_preparation_waits_for_authority_before_version_api", async () => {
  const boundary = deferred();
  const aggregate = deferred();
  const scenario = buildController();
  let aggregateCalls = 0;
  scenario.controller.awaitAuthoritativeMutationBoundary = () => boundary.promise;
  const initialState = structuredClone(scenario.state);

  const saving = savePackagePreparation(
    scenario.controller,
    scenario.state.goithau[0],
    { thoiGianDongThau: "2026-08-06 08:00:00" },
    {
      generateRecordId: deterministicIds(),
      createAggregateVersion: async () => {
        aggregateCalls += 1;
        return aggregate.promise;
      },
    },
  );

  try {
    await new Promise((resolve) => setImmediate(resolve));
    assert.equal(aggregateCalls, 0);
    assert.deepEqual(scenario.state, initialState);
    assert.deepEqual(scenario.staged, []);
  } finally {
    boundary.resolve({ authoritative: true, offline: false });
    aggregate.resolve({ authoritative: false });
    await saving;
  }
});

test("package_preparation_recomputes_version_decision_after_authoritative_refresh", async () => {
  const stale = sourcePackage();
  const scenario = buildController(stale);
  const refreshed = sourcePackage({
    rowVersion: 8,
    thoiGianDongThau: "2026-08-06 08:00:00",
  });
  let boundaryCalls = 0;
  let aggregateCalls = 0;
  scenario.controller.awaitAuthoritativeMutationBoundary = async () => {
    boundaryCalls += 1;
    scenario.state.goithau[0] = refreshed;
    return { authoritative: true, offline: false };
  };
  scenario.controller.fetchRecordByLookup = async () => refreshed;

  const saved = await savePackagePreparation(
    scenario.controller,
    stale,
    {
      thoiGianDangTai: "2026-08-01 08:00:00",
      thoiGianDongThau: "2026-08-06 08:00:00",
    },
    {
      generateRecordId: deterministicIds(),
      createAggregateVersion: async () => {
        aggregateCalls += 1;
        return { authoritative: false };
      },
    },
  );

  assert.equal(boundaryCalls, 1);
  assert.equal(aggregateCalls, 0);
  assert.equal(saved, refreshed);
  assert.equal(scenario.state.goithau.length, 1);
  assert.equal(refreshed.isLatest, 1);
});

test("package_preparation_uses_refreshed_row_version_for_aggregate_version_command", async () => {
  const stale = sourcePackage();
  const scenario = buildController(stale);
  const commands = [];
  scenario.controller.awaitAuthoritativeMutationBoundary = async () => {
    stale.rowVersion = 11;
    return { authoritative: true, offline: false };
  };
  scenario.controller.fetchRecordByLookup = async () => stale;

  const saved = await savePackagePreparation(
    scenario.controller,
    stale,
    { thoiGianDongThau: "2026-08-07 08:00:00" },
    {
      generateRecordId: deterministicIds(),
      createAggregateVersion: async (_controller, command) => {
        commands.push(command);
        stale.isLatest = 0;
        scenario.state.goithau.push({
          ...stale,
          id: "package-01",
          phienBan: "01",
          isLatest: 1,
          rowVersion: 1,
          thoiGianDongThau: command.changes.thoiGianDongThau,
        });
        return { authoritative: true };
      },
    },
  );

  assert.equal(commands.length, 1);
  assert.equal(commands[0].expectedRowVersion, 11);
  assert.equal(saved.id, "package-01");
});

test("package_preparation_does_not_resurrect_a_record_removed_by_authoritative_refresh", async () => {
  const stale = sourcePackage();
  const scenario = buildController(stale);
  let aggregateCalls = 0;
  scenario.controller.awaitAuthoritativeMutationBoundary = async () => {
    scenario.state.goithau = [];
    return { authoritative: true, offline: false };
  };
  scenario.controller.fetchRecordByLookup = async () => null;

  await assert.rejects(
    savePackagePreparation(
      scenario.controller,
      stale,
      { thoiGianDongThau: "2026-08-09 08:00:00" },
      {
        generateRecordId: deterministicIds(),
        createAggregateVersion: async () => {
          aggregateCalls += 1;
          return { authoritative: false };
        },
      },
    ),
    (error) => error?.code === "AUTHORITATIVE_PACKAGE_UNAVAILABLE",
  );

  assert.equal(aggregateCalls, 0);
  assert.deepEqual(scenario.state.goithau, []);
  assert.deepEqual(scenario.staged, []);
});

test("package_preparation_does_not_snapshot_incomplete_children_after_hydration_failure", async () => {
  const previousFetch = globalThis.fetch;
  const previousConsoleError = console.error;
  const pkg = sourcePackage({ rowVersion: 0 });
  const scenario = buildController(pkg);
  const initialState = structuredClone(scenario.state);
  scenario.model.useServerSidePagination = true;
  scenario.model.workspaceScope = { key: "user:org-a", organizationId: "org-a" };
  scenario.model.getWorkspaceToken = () => "user:org-a@1";
  scenario.model.isWorkspaceCurrent = (token) => token === "user:org-a@1";
  scenario.controller.awaitAuthoritativeMutationBoundary = async () => ({
    authoritative: true,
    offline: false,
  });
  scenario.controller.fetchRecordByLookup = async () => pkg;
  globalThis.fetch = async () => new Response(JSON.stringify({ error: "child hydration failed" }), {
    status: 500,
    headers: { "content-type": "application/json" },
  });
  console.error = () => {};

  try {
    await assert.rejects(
      savePackagePreparation(
        scenario.controller,
        pkg,
        { thoiGianDongThau: "2026-08-10 08:00:00" },
        { generateRecordId: deterministicIds() },
      ),
      (error) => error?.status === 500,
    );
    assert.deepEqual(scenario.state, initialState);
    assert.deepEqual(scenario.staged, []);
  } finally {
    console.error = previousConsoleError;
    if (previousFetch === undefined) delete globalThis.fetch;
    else globalThis.fetch = previousFetch;
  }
});

test("detail_edit_closing_time_preserves_status_assignment_and_owned_children", async () => {
  const pkg = sourcePackage({
    rowVersion: 0,
    danhGiaHsdtMetadata: {
      schemaVersion: 1,
      criteria: [{ id: "criterion-1", code: "KT-01", name: "Kỹ thuật" }],
    },
  });
  const scenario = buildController(pkg);
  scenario.state.assignments.push({
    id: "assignment-1",
    type: "goithau",
    targetId: pkg.id,
    empId: "employee-1",
  });
  scenario.state.goithauhanghoa.push({
    id: "goods-1",
    goiThauId: pkg.id,
    tenHangHoa: "Hàng hóa 1",
  });
  scenario.state.thongtinmothau.push({
    id: "opening-1",
    goiThauId: pkg.id,
    nhaThauId: "contractor-1",
    baoCaoDanhGiaChiTietList: [{
      id: "report-1",
      loaiVong: "single",
      chiTietList: [{
        id: "detail-1",
        tieuChiDanhGiaId: "criterion-1",
        ketQua: "Đạt",
      }],
    }],
  });
  scenario.state.hanghoaduthaunhathau.push({
    id: "bidder-goods-1",
    goiThauId: pkg.id,
    thongTinMoThauId: "opening-1",
    goiThauHangHoaId: "goods-1",
  });
  scenario.controller.awaitAuthoritativeMutationBoundary = async () => ({
    authoritative: true,
    offline: false,
  });
  scenario.controller.fetchRecordByLookup = async () => pkg;

  const saved = await savePackagePreparation(
    scenario.controller,
    pkg,
    { thoiGianDongThau: "2026-08-08 08:00:00" },
    { generateRecordId: deterministicIds() },
  );

  assert.equal(saved.trangThai, "Đang chấm thầu");
  assert.notEqual(saved.trangThai, "Chuẩn bị");
  assert.equal(saved.danhGiaHsdtMetadata.criteria[0].code, "KT-01");
  assert.notEqual(saved.danhGiaHsdtMetadata.criteria[0].id, "criterion-1");
  assert.equal(
    scenario.state.assignments.find((row) => row.targetId === saved.id)?.empId,
    "employee-1",
  );
  const clonedGoods = scenario.state.goithauhanghoa.find((row) => row.goiThauId === saved.id);
  const clonedOpening = scenario.state.thongtinmothau.find((row) => row.goiThauId === saved.id);
  const clonedBidderGoods = scenario.state.hanghoaduthaunhathau.find(
    (row) => row.goiThauId === saved.id,
  );
  assert.ok(clonedGoods);
  assert.ok(clonedOpening);
  assert.ok(clonedBidderGoods);
  assert.equal(clonedBidderGoods.goiThauHangHoaId, clonedGoods.id);
  assert.equal(clonedBidderGoods.thongTinMoThauId, clonedOpening.id);
  assert.equal(
    clonedOpening.baoCaoDanhGiaChiTietList[0].chiTietList[0].tieuChiDanhGiaId,
    saved.danhGiaHsdtMetadata.criteria[0].id,
  );
});
