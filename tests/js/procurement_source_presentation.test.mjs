import assert from "node:assert/strict";
import test from "node:test";

import {
  presentAutomaticDataMessage,
} from "../../frontend/procurement/sourcePresentation.js";

test("procurement presentation hides upstream names without changing message details", () => {
  assert.equal(
    presentAutomaticDataMessage("Không tìm thấy mã IB trên Mua Sắm Công."),
    "Không tìm thấy mã IB trên dịch vụ lấy dữ liệu tự động.",
  );
  assert.equal(
    presentAutomaticDataMessage("MSC quá thời gian tại https://muasamcong.mpi.gov.vn/path?q=1"),
    "dịch vụ lấy dữ liệu tự động quá thời gian tại dịch vụ lấy dữ liệu tự động",
  );
});

test("procurement presentation preserves source-neutral messages", () => {
  const message = "Không thể lấy dữ liệu tự động. Vui lòng thử lại.";
  assert.equal(presentAutomaticDataMessage(message), message);
});
