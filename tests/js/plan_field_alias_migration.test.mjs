import assert from "node:assert/strict";
import test from "node:test";

import { BiddingModel } from "../../frontend/app/BiddingModel.js";


test("legacy plan field aliases hydrate into canonical keys idempotently", () => {
  const model = new BiddingModel();
  const migrated = model.normalizeRecordKeys({
    id: "plan-1",
    diadiemQuymo: "Legacy location",
    thongtinKhac: "Legacy note",
  }, "kehoach");

  assert.equal(migrated.diaDiemQuyMo, "Legacy location");
  assert.equal(migrated.thongTinKhac, "Legacy note");
  assert.equal(Object.hasOwn(migrated, "diadiemQuymo"), false);
  assert.equal(Object.hasOwn(migrated, "thongtinKhac"), false);
  assert.deepEqual(model.normalizeRecordKeys(migrated, "kehoach"), migrated);
});

test("canonical plan fields take precedence over legacy aliases", () => {
  const model = new BiddingModel();
  const normalized = model.normalizeRecordKeys({
    diadiemQuymo: "Legacy location",
    diaDiemQuyMo: "Canonical location",
    thongtinKhac: "Legacy note",
    thongTinKhac: "Canonical note",
  }, "kehoach");

  assert.equal(normalized.diaDiemQuyMo, "Canonical location");
  assert.equal(normalized.thongTinKhac, "Canonical note");
  assert.equal(Object.hasOwn(normalized, "diadiemQuymo"), false);
  assert.equal(Object.hasOwn(normalized, "thongtinKhac"), false);
});
