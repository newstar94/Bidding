import assert from "node:assert/strict";
import test from "node:test";

import { toastDeduplicationKey } from "../../frontend/app/BiddingView.js";

test("identical toast content has one stable deduplication key", () => {
  const first = toastDeduplicationKey(
    "Phiên đăng nhập hết hạn",
    "Vui lòng đăng nhập lại.",
    "warning"
  );
  const duplicate = toastDeduplicationKey(
    "Phiên đăng nhập hết hạn",
    "Vui lòng đăng nhập lại.",
    "warning"
  );
  const different = toastDeduplicationKey(
    "Phiên đăng nhập hết hạn",
    "Vui lòng đăng nhập lại.",
    "error"
  );

  assert.equal(first, duplicate);
  assert.notEqual(first, different);
});
