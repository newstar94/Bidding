import assert from "node:assert/strict";
import test from "node:test";

import { paginatedSearchHasChanged } from "../../frontend/shared/tableDataUtils.js";

test("a delayed search debounce does not reset a page rendered by sync", () => {
  const model = {
    useServerSidePagination: true,
    _lastPaginatedQueries: new Map([
      ["chuyengia", { page: 1, search: "phân trang thử nghiệm" }],
    ]),
  };

  assert.equal(
    paginatedSearchHasChanged(model, "chuyengia", "PHÂN TRANG THỬ NGHIỆM"),
    false,
  );
  assert.equal(
    paginatedSearchHasChanged(model, "chuyengia", "tìm kiếm mới"),
    true,
  );
  assert.equal(paginatedSearchHasChanged(model, "nhathau", "bất kỳ"), true);
  assert.equal(
    paginatedSearchHasChanged({ useServerSidePagination: false }, "chuyengia", "x"),
    true,
  );
});
