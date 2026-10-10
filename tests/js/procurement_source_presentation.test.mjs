import assert from "node:assert/strict";
import test from "node:test";

import {
  presentAutomaticDataMessage,
  presentAutomaticDataLabel,
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


test("automatic-data labels preserve links and avoid repeated data wording", () => {
  assert.equal(presentAutomaticDataLabel("100 lượt Mua Sắm Công"), "100 lượt lấy dữ liệu tự động");
  assert.equal(presentAutomaticDataLabel("Quản lý công việc và kết nối dữ liệu Mua Sắm Công."), "Quản lý công việc và kết nối dữ liệu tự động.");
  const link = "https://muasamcong.mpi.gov.vn/path?q=1";
  assert.equal(presentAutomaticDataLabel(link), link);
});
