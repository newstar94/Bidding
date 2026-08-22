import test from "node:test";
import assert from "node:assert/strict";

import {
  normalizeStatus,
  presentStatus,
} from "../../frontend/packages/LifecyclePolicy.js";


test("lifecycle policy normalizes legacy labels and presents stable codes", () => {
  assert.equal(normalizeStatus("Chuẩn bị"), "PREPARING");
  assert.equal(normalizeStatus("Chưa xác định"), "UNKNOWN");
  assert.equal(normalizeStatus("Huỷ thầu"), "CANCELLED");
  assert.equal(normalizeStatus("AWARDED"), "AWARDED");
  assert.deepEqual(presentStatus("PARTIALLY_AWARDED"), {
    label: "Đã có kết quả một phần",
    tone: "success",
    icon: "award",
  });
});
