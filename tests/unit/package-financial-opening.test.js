import test from "node:test";
import assert from "node:assert/strict";

import { savePackageFinancialOpening, validateFinancialOpeningTime } from "../../frontend/packages/packageFinancialOpening.js";

test("financial opening commits bid prices and package opening time together", async () => {
  const calls = [];
  const pkg = { id: "gt-1", linhVuc: "Tư vấn" };
  const controller = {
    model: {
      state: { thongtinmothau: [
        { id: "bid-1", hieuLucHsdt: 90 },
        { id: "bid-2", hieuLucHsdt: 60 }
      ] },
      getCurrentDateTimeString: () => "2026-07-13 10:00:00",
      persistData: async table => calls.push(`persist:${table}`)
    },
    autoSync: async () => calls.push("sync")
  };
  await savePackageFinancialOpening(controller, pkg, [
    { id: "bid-1", giaDuThau: 100, tyLeGiamGia: 5, giaSauGiamGia: 95, hieuLucHsdt: null }
  ]);
  assert.equal(controller.model.state.thongtinmothau[0].giaSauGiamGia, 95);
  assert.equal(controller.model.state.thongtinmothau[0].hieuLucHsdt, 90);
  assert.equal(controller.model.state.thongtinmothau[1].giaDuThau, undefined);
  assert.equal(pkg.thoiGianMoEhsdxtc, "2026-07-13 10:00:00");
  assert.deepEqual(calls, ["persist:thongtinmothau", "persist:goithau", "sync"]);
});

test("financial opening time is required, valid and not before technical opening", () => {
  assert.equal(validateFinancialOpeningTime({ required: true }).valid, false);
  assert.equal(validateFinancialOpeningTime({
    required: true,
    rawValue: "31/02/2026 10:00",
    convertedValue: "2026-02-31 10:00:00"
  }).valid, false);
  assert.equal(validateFinancialOpeningTime({
    required: true,
    rawValue: "13/07/2026 09:00",
    convertedValue: "2026-07-13 09:00:00",
    technicalOpeningTime: "2026-07-13 10:00:00"
  }).valid, false);
  assert.equal(validateFinancialOpeningTime({
    required: true,
    rawValue: "13/07/2026 10:30",
    convertedValue: "2026-07-13 10:30:00",
    technicalOpeningTime: "2026-07-13 10:00:00"
  }).valid, true);
});
