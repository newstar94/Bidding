import test from "node:test";
import assert from "node:assert/strict";
import { savePackageCancellation } from "../../frontend/packages/packageCancellation.js";

test("package cancellation preserves previous status and persists before refresh", async () => {
  const calls = [];
  const pkg = { id: "gt-1", trangThai: "Đang chấm thầu", danhGiaHsdtMetadata: "{}" };
  const controller = {
    model: {
      state: { goithau: [pkg] },
      normalizeRecordKeys: record => record,
      persistData: async (key) => calls.push(`persist:${key}`)
    },
    view: { renderGoiThauTable: () => calls.push("render") },
    autoSync: async () => { calls.push("sync"); return { ok: true }; }
  };
  await savePackageCancellation(controller, pkg, {
    decisionNumber: "1/QĐ", decisionDate: "2026-07-13", reason: "Không có nhà thầu đạt"
  });
  const updated = controller.model.state.goithau[0];
  const metadata = JSON.parse(updated.danhGiaHsdtMetadata);
  assert.equal(updated.trangThai, "Hủy thầu");
  assert.equal(metadata.cancelDetails.trangThaiTruocHuy, "Đang chấm thầu");
  assert.deepEqual(calls, ["persist:goithau", "render", "sync"]);
});
