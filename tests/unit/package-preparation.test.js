import test from "node:test";
import assert from "node:assert/strict";

import {
  savePackagePreparation,
  shouldCreatePackagePreparationVersion
} from "../../frontend/packages/packagePreparation.js";

test("package preparation creates a version only after published times change", () => {
  const pkg = {
    thoiGianDangTai: "2026-07-13 08:00:00",
    thoiGianDongThau: "2026-07-14 08:00:00",
    thoiGianMoThau: "2026-07-14 08:00:00"
  };
  assert.equal(shouldCreatePackagePreparationVersion(pkg, { ...pkg }), false);
  assert.equal(shouldCreatePackagePreparationVersion(pkg, {
    ...pkg, thoiGianDongThau: "2026-07-15 08:00:00"
  }), true);
  assert.equal(shouldCreatePackagePreparationVersion({ ...pkg, thoiGianDangTai: "" }, {
    ...pkg, thoiGianDongThau: "2026-07-15 08:00:00"
  }), false);
});

test("package preparation starts a clean version and keeps historical relations unchanged", async () => {
  const calls = [];
  const pkg = {
    id: "gt-00", rootId: "gt-root", phienBan: "00", isLatest: 1,
    keHoachId: "kh-00", thoiGianDangTai: "2026-07-13 08:00:00",
    thoiGianDongThau: "2026-07-14 08:00:00", thoiGianMoThau: "2026-07-14 08:00:00"
  };
  let sequence = 0;
  const controller = {
    model: {
      state: {
        goithau: [pkg],
        hopdong: [{ id: "hd-1", goiThauIds: ["gt-00"] }],
        thongtinmothau: [{ id: "bid-00", goiThauId: "gt-00", tenNhaThau: "A" }]
      },
      getLatestPlan: () => ({ id: "kh-01" }),
      getCurrentDateTimeString: () => "2026-07-13 09:00:00",
      persistData: async table => calls.push(`persist:${table}`)
    },
    autoSync: async () => calls.push("sync")
  };
  const saved = await savePackagePreparation(controller, pkg, {
    thoiGianDangTai: pkg.thoiGianDangTai,
    thoiGianDongThau: "2026-07-15 08:00:00",
    thoiGianMoThau: "2026-07-15 08:00:00"
  }, { generateRecordId: table => `${table}-${++sequence}` });

  assert.equal(saved.phienBan, "01");
  assert.equal(saved.keHoachId, "kh-01");
  assert.equal(saved.trangThai, "Chuẩn bị");
  assert.equal(pkg.isLatest, 0);
  assert.deepEqual(controller.model.state.hopdong[0].goiThauIds, ["gt-00"]);
  assert.equal(controller.model.state.thongtinmothau.length, 1);
  assert.deepEqual(calls, ["persist:goithau", "sync"]);
});

test("package preparation updates an unpublished package without creating a version", async () => {
  const calls = [];
  const pkg = { id: "gt-00", rootId: "gt-00", phienBan: "00", isLatest: 1, keHoachId: "kh-00" };
  const controller = {
    model: {
      state: { goithau: [pkg] },
      getLatestPlan: () => ({ id: "kh-01" }),
      getCurrentDateTimeString: () => "2026-07-13 09:00:00",
      persistData: async table => calls.push(`persist:${table}`)
    },
    autoSync: async () => calls.push("sync")
  };
  const saved = await savePackagePreparation(controller, pkg, {
    thoiGianDangTai: "2026-07-13 08:00:00"
  }, { generateRecordId: () => "unused" });
  assert.equal(saved, pkg);
  assert.equal(pkg.keHoachId, "kh-01");
  assert.equal(controller.model.state.goithau.length, 1);
  assert.deepEqual(calls, ["persist:goithau", "sync"]);
});
