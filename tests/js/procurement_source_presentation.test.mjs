import assert from "node:assert/strict";
import test from "node:test";

import {
  presentAutomaticDataMessage,
  presentAutomaticDataLabel,
} from "../../frontend/procurement/sourcePresentation.js";

test("procurement presentation renders server-normalized messages without provider rules", () => {
  assert.equal(
    presentAutomaticDataMessage("Không tìm thấy mã IB trên dịch vụ lấy dữ liệu tự động."),
    "Không tìm thấy mã IB trên dịch vụ lấy dữ liệu tự động.",
  );
  assert.equal(
    presentAutomaticDataMessage(null, "Không thể lấy dữ liệu tự động."),
    "Không thể lấy dữ liệu tự động.",
  );
  assert.equal(
    presentAutomaticDataMessage(0),
    "0",
  );
});

test("procurement presentation preserves source-neutral messages", () => {
  const message = "Không thể lấy dữ liệu tự động. Vui lòng thử lại.";
  assert.equal(presentAutomaticDataMessage(message), message);
});


test("automatic-data labels preserve links and avoid repeated data wording", () => {
  assert.equal(presentAutomaticDataLabel("100 lượt lấy dữ liệu tự động"), "100 lượt lấy dữ liệu tự động");
  assert.equal(presentAutomaticDataLabel("Quản lý công việc và kết nối dữ liệu tự động."), "Quản lý công việc và kết nối dữ liệu tự động.");
  const link = "https://example.org/path?q=1";
  assert.equal(presentAutomaticDataLabel(link), link);
  const newLink = "https://example.org/other?q=1";
  assert.equal(presentAutomaticDataLabel(newLink), newLink);
});
