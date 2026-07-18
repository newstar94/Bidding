import test from "node:test";
import assert from "node:assert/strict";

import { reopenPackageAwardResult } from "../../frontend/packages/packageAwardResult.js";

test("reopening award result clears generated reasons and commits both tables", async () => {
  const calls = [];
  const pkg = { id: "gt-1", trangThai: "Đã có kết quả" };
  const controller = {
    model: {
      state: {
        goithau: [pkg],
        thongtinmothau: [
          { id: "bid-1", goiThauId: "gt-1", lyDoTruot: "Nhà thầu xếp hạng 1 trúng thầu" },
          { id: "bid-2", goiThauId: "gt-1", lyDoTruot: "Lý do nhập thủ công" },
          { id: "bid-3", goiThauId: "gt-2", lyDoTruot: "Không đạt yêu cầu kỹ thuật" }
        ]
      },
      persistData: async table => calls.push(`persist:${table}`)
    },
    autoSync: async () => calls.push("sync")
  };
  await reopenPackageAwardResult(controller, pkg);
  assert.equal(pkg.trangThai, "Đang chấm thầu");
  assert.equal(controller.model.state.thongtinmothau[0].lyDoTruot, "");
  assert.equal(controller.model.state.thongtinmothau[1].lyDoTruot, "Lý do nhập thủ công");
  assert.equal(controller.model.state.thongtinmothau[2].lyDoTruot, "Không đạt yêu cầu kỹ thuật");
  assert.deepEqual(calls, ["persist:thongtinmothau", "persist:goithau", "sync"]);
});
