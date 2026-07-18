import assert from "node:assert/strict";
import test from "node:test";

import {
  loadBreakdownPackageDetails,
  renderBreakdownPackagesList
} from "../../frontend/plans/KeHoachWorkflow.js";

test("plan breakdown loads full package records before recalculating totals", async () => {
  const planId = "plan-1";
  const packages = [{
    id: "package-1",
    keHoachId: planId,
    maGoiThau: "IB01",
    tenGoiThau: "Gói thầu tham chiếu",
    referenceOnly: true
  }];
  const calls = [];
  let renderCount = 0;
  let totalCount = 0;
  const previousDocument = globalThis.document;
  const previousLucide = globalThis.lucide;
  globalThis.document = {
    getElementById(id) {
      return id === "breakdown-plan-id" ? { value: planId } : null;
    }
  };
  globalThis.lucide = { createIcons() {} };
  try {
    const context = {
      model: { getLatestPackagesForPlan: () => packages },
      async fetchRecordByLookup(table, lookup) {
        calls.push([table, lookup]);
        Object.assign(packages[0], {
          referenceOnly: false,
          giaGoiThau: 25_000_000_000,
          hinhThucLuaChon: "Chào hàng cạnh tranh"
        });
      },
      renderBreakdownPackagesList() { renderCount += 1; },
      updateBreakdownTotal() { totalCount += 1; }
    };
    await loadBreakdownPackageDetails.call(context, planId);
    assert.deepEqual(calls, [["goithau", "package-1"]]);
    assert.equal(renderCount, 1);
    assert.equal(totalCount, 1);
  } finally {
    globalThis.document = previousDocument;
    globalThis.lucide = previousLucide;
  }
});

test("plan breakdown uses the shared package status badge", () => {
  const tbody = { innerHTML: "" };
  const previousDocument = globalThis.document;
  globalThis.document = {
    getElementById(id) {
      return id === "tbody-breakdown-goithau" ? tbody : null;
    }
  };
  try {
    const context = {
      model: {
        getLatestPackagesForPlan: () => [{
          id: "package-1",
          maGoiThau: "IB01",
          tenGoiThau: "Gói thầu 1",
          giaGoiThau: 25_000_000_000,
          hinhThucLuaChon: "Chào hàng cạnh tranh",
          trangThai: "Đã có kết quả"
        }],
        getPackageBaseCode: (value) => value,
        formatCurrency: () => "25.000.000.000 đ"
      },
      view: {
        getStatusBadge: (status) => `<span class="badge badge-success">${status}</span>`
      }
    };
    renderBreakdownPackagesList.call(context, "plan-1");
    assert.match(tbody.innerHTML, /25\.000\.000\.000 đ/);
    assert.match(tbody.innerHTML, /Chào hàng cạnh tranh/);
    assert.match(tbody.innerHTML, /badge badge-success/);
    assert.match(tbody.innerHTML, /data-close-before="modal-plan-breakdown"/);
  } finally {
    globalThis.document = previousDocument;
  }
});
