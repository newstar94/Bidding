import test from "node:test";
import assert from "node:assert/strict";
import { renderTableEmpty, renderTableError, renderTableLoading } from "../../frontend/shared/EntityTable.js";

function body(children = []) {
  return { children, innerHTML: "" };
}

test("entity table states share safe loading, empty and error markup", () => {
  const tableBody = body();
  assert.equal(renderTableLoading(tableBody, 8), true);
  assert.match(tableBody.innerHTML, /data-table-state="loading"/);
  assert.match(tableBody.innerHTML, /colspan="8"/);

  const pagination = { innerHTML: "old" };
  renderTableEmpty(tableBody, { colspan: 8, message: "Không có dữ liệu", icon: "archive", pagination });
  assert.match(tableBody.innerHTML, /Không có dữ liệu/);
  assert.equal(pagination.innerHTML, "");

  renderTableError(tableBody, { colspan: 8, message: "Lỗi tải" });
  assert.match(tableBody.innerHTML, /data-table-state="error"/);
  assert.match(tableBody.innerHTML, /Lỗi tải/);
});

test("table error state exposes one retry action", () => {
  let handler = null;
  let retryCount = 0;
  const tableBody = {
    children: [],
    innerHTML: "",
    querySelector: () => ({
      addEventListener: (_event, callback, options) => {
        handler = callback;
        assert.deepEqual(options, { once: true });
      }
    })
  };

  renderTableError(tableBody, {
    colspan: 4,
    message: "Mất kết nối",
    onRetry: () => { retryCount += 1; }
  });

  assert.match(tableBody.innerHTML, /data-table-retry/);
  handler();
  assert.equal(retryCount, 1);
});
