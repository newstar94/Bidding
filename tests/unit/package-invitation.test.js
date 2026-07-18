import test from "node:test";
import assert from "node:assert/strict";

import { savePackageInvitationInfo } from "../../frontend/packages/packageInvitation.js";

test("invitation info updates the latest extension and persists before sync", async () => {
  const calls = [];
  const pkg = { id: "gt-1" };
  const controller = {
    model: { persistData: async table => calls.push(`persist:${table}`) },
    autoSync: async () => calls.push("sync")
  };
  await savePackageInvitationInfo(controller, pkg, {
    extensions: [
      { thoiGianDongThau: "13/07/2026 08:00" },
      { thoiGianDongThau: "14/07/2026 09:30" }
    ],
    clarificationRequests: [{ noiDung: "A" }],
    clarificationResponses: [{ noiDung: "B" }],
    convertDateTime: value => `converted:${value}`
  });
  assert.equal(pkg.thoiGianDongThau, "converted:14/07/2026 09:30");
  assert.equal(pkg.thoiGianMoThau, pkg.thoiGianDongThau);
  assert.equal(pkg.yeuCauLamRoList.length, 1);
  assert.deepEqual(calls, ["persist:goithau", "sync"]);
});
