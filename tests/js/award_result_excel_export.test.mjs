import assert from "node:assert/strict";
import test from "node:test";

import {
  bindAwardResultExcelExport,
  buildAwardResultValidationMarkup,
} from "../../frontend/packages/detail/AwardResultExcelExport.js";


class FakeElement {
  constructor() {
    this.disabled = false;
    this.hidden = false;
    this.files = [];
    this.innerHTML = "";
    this.textContent = "";
    this.listeners = new Map();
    this.selectors = new Map();
  }

  querySelector(selector) {
    return this.selectors.get(selector) || null;
  }

  addEventListener(type, listener) {
    this.listeners.set(type, listener);
  }

  dispatch(type) {
    return this.listeners.get(type)?.({ target: this });
  }

  focus() {}
}


function harness({ validationResult, previewResult, exportResponse, onError } = {}) {
  const root = new FakeElement();
  const openButton = new FakeElement();
  const panel = new FakeElement();
  panel.hidden = true;
  const input = new FakeElement();
  const filename = new FakeElement();
  const validateButton = new FakeElement();
  validateButton.disabled = true;
  const confirmButton = new FakeElement();
  confirmButton.disabled = true;
  const reconciliationButton = new FakeElement();
  reconciliationButton.disabled = true;
  const status = new FakeElement();
  const summary = new FakeElement();
  const close = new FakeElement();
  root.selectors.set("#btn-export-award-result-excel", openButton);
  root.selectors.set("#award-result-excel-panel", panel);
  panel.selectors.set("#award-result-excel-file", input);
  panel.selectors.set("[data-award-excel-file-name]", filename);
  panel.selectors.set("[data-award-excel-validate]", validateButton);
  panel.selectors.set("[data-award-excel-confirm]", confirmButton);
  panel.selectors.set("[data-award-excel-reconciliation]", reconciliationButton);
  panel.selectors.set("[data-award-excel-status]", status);
  panel.selectors.set("[data-award-excel-summary]", summary);
  panel.selectors.set("[data-award-excel-close]", close);

  const validationCalls = [];
  const exportCalls = [];
  const binding = bindAwardResultExcelExport(root, {
    packageId: "pkg/01",
    packageCode: "IB-01",
    requestJsonImpl: async (...args) => {
      validationCalls.push(args);
      return String(args[0]).includes("/preview?") ? previewResult : validationResult;
    },
    apiFetchImpl: async (...args) => {
      exportCalls.push(args);
      return exportResponse;
    },
    setMarkupImpl: (element, value) => { element.innerHTML = value; },
    onError,
  });
  return {
    binding,
    input,
    filename,
    validateButton,
    confirmButton,
    reconciliationButton,
    status,
    summary,
    validationCalls,
    exportCalls,
  };
}


function xlsxFile(name = "sample.xlsx", size = 2_048) {
  const file = new Blob([new Uint8Array(size)], {
    type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  });
  Object.defineProperty(file, "name", { value: name });
  return file;
}


test("file selection enables validation and renders warning-only reconciliation", async () => {
  const ui = harness({
    validationResult: {
      validationToken: "token-1",
      totalRows: 3,
      exactMatches: 2,
      fallbackMatches: 0,
      unmatchedRows: 1,
      blockingErrors: [],
      warnings: [{ excelRow: 4, message: "Không tìm thấy kết quả." }],
    },
  });
  ui.input.files = [xlsxFile()];
  ui.input.dispatch("change");

  assert.match(ui.filename.textContent, /sample\.xlsx · 2\.0 KB/);
  assert.equal(ui.validateButton.disabled, false);
  await ui.binding.validateSelectedFile();

  assert.equal(ui.validationCalls.length, 1);
  assert.equal(ui.validationCalls[0][0], "/api/packages/pkg%2F01/award-result-excel/validate");
  assert.equal(ui.validationCalls[0][1].method, "POST");
  assert.ok(ui.validationCalls[0][1].body instanceof FormData);
  assert.match(String(ui.summary.innerHTML), /Tổng dòng/);
  assert.match(String(ui.summary.innerHTML), /Dòng 4/);
  assert.equal(ui.confirmButton.disabled, false);
});


test("blocking template mismatch is displayed and keeps export disabled", async () => {
  const ui = harness({
    validationResult: {
      validationToken: "must-not-be-used",
      blockingErrors: [{
        code: "TEMPLATE_PACKAGE_TYPE_MISMATCH",
        message: "Biểu mẫu Excel thuốc không phù hợp loại gói thầu hiện tại.",
      }],
      warnings: [],
    },
  });
  ui.input.files = [xlsxFile("medicine.xlsx")];
  ui.input.dispatch("change");
  await ui.binding.validateSelectedFile();

  assert.match(String(ui.summary.innerHTML), /Biểu mẫu Excel thuốc/);
  assert.match(ui.status.textContent, /lỗi chặn xuất/);
  assert.equal(ui.confirmButton.disabled, true);
  assert.equal(await ui.binding.exportValidatedFile(), false);
});


test("preview pagination fetches filters and renders per-column old/new/source diff", async () => {
  const ui = harness({
    validationResult: {
      validationToken: "token-page",
      writableRows: 2,
      blockingErrors: [],
      warnings: [],
      rows: [],
      page: 1,
      totalPages: 2,
    },
    previewResult: {
      writableRows: 2,
      blockingErrors: [],
      warnings: [],
      page: 2,
      totalPages: 2,
      filteredRows: 1,
      rows: [{
        excelRow: 102,
        lotCode: "L01",
        bidderName: "Nhà thầu A",
        matchMethod: "lot_code_and_bidder_identifier",
        changes: [{
          field: "award_price",
          oldValue: 900,
          newValue: 850,
          source: "approved_result.award_price",
        }],
        warnings: [],
      }],
    },
  });
  ui.input.files = [xlsxFile()];
  ui.input.dispatch("change");
  await ui.binding.validateSelectedFile();

  const result = await ui.binding.loadPreview({ page: 2, writable: "true" });

  assert.equal(result.page, 2);
  assert.equal(ui.validationCalls.length, 2);
  const previewUrl = new URL(ui.validationCalls[1][0], "https://example.test");
  assert.equal(previewUrl.pathname, "/api/packages/pkg%2F01/award-result-excel/preview");
  assert.equal(previewUrl.searchParams.get("validationToken"), "token-page");
  assert.equal(previewUrl.searchParams.get("page"), "2");
  assert.equal(previewUrl.searchParams.get("writable"), "true");
  assert.equal(ui.validationCalls[1][1].method, "GET");
  assert.match(String(ui.summary.innerHTML), /Giá trị cũ/);
  assert.match(String(ui.summary.innerHTML), /approved_result\.award_price/);
  assert.match(String(ui.summary.innerHTML), />900</);
  assert.match(String(ui.summary.innerHTML), />850</);
});


test("export sends only validationToken and downloads the returned filename", async () => {
  const originalDocument = globalThis.document;
  const originalSetTimeout = globalThis.setTimeout;
  const originalCreateObjectURL = URL.createObjectURL;
  const originalRevokeObjectURL = URL.revokeObjectURL;
  const clicked = [];
  const appended = [];
  const lifecycle = [];
  const deferred = [];
  URL.createObjectURL = () => "blob:award-result";
  URL.revokeObjectURL = (value) => lifecycle.push(`revoke:${value}`);
  globalThis.setTimeout = (callback) => {
    lifecycle.push("scheduled");
    deferred.push(callback);
    return 1;
  };
  globalThis.document = {
    createElement() {
      return {
        href: "",
        download: "",
        hidden: false,
        click() { clicked.push(this.download); lifecycle.push("click"); },
        remove() {},
      };
    },
    body: { appendChild(anchor) { appended.push(anchor); } },
  };
  try {
    const ui = harness({
      validationResult: {
        validationToken: "token-2",
        blockingErrors: [],
        warnings: [],
      },
      exportResponse: {
        ok: true,
        headers: {
          get(name) {
            return name.toLowerCase() === "content-disposition"
              ? "attachment; filename*=UTF-8''ket-qua_da_dien_ket_qua.xlsx"
              : "";
          },
        },
        blob: async () => new Blob(["xlsx"]),
      },
    });
    ui.input.files = [xlsxFile()];
    ui.input.dispatch("change");
    await ui.binding.validateSelectedFile();
    const exported = await ui.binding.exportValidatedFile();

    assert.equal(exported, true);
    assert.equal(ui.exportCalls.length, 1);
    assert.equal(ui.exportCalls[0][0], "/api/packages/pkg%2F01/award-result-excel/export");
    assert.deepEqual(JSON.parse(ui.exportCalls[0][1].body), {
      validationToken: "token-2",
    });
    assert.deepEqual(Object.keys(JSON.parse(ui.exportCalls[0][1].body)), [
      "validationToken",
    ]);
    assert.equal(appended.length, 1);
    assert.deepEqual(clicked, ["ket-qua_da_dien_ket_qua.xlsx"]);
    assert.deepEqual(lifecycle, ["click", "scheduled"]);
    assert.equal(deferred.length, 1);
    deferred[0]();
    assert.deepEqual(lifecycle, ["click", "scheduled", "revoke:blob:award-result"]);
    assert.match(ui.status.textContent, /Đã tạo và tải/);
    assert.equal(ui.confirmButton.disabled, true);
  } finally {
    globalThis.document = originalDocument;
    globalThis.setTimeout = originalSetTimeout;
    URL.createObjectURL = originalCreateObjectURL;
    URL.revokeObjectURL = originalRevokeObjectURL;
  }
});


test("zero writable rows keeps export disabled even when a token is present", async () => {
  const ui = harness({
    validationResult: {
      validationToken: "must-not-export",
      writableRows: 0,
      blockingErrors: [],
      warnings: [],
    },
  });
  ui.input.files = [xlsxFile()];
  ui.input.dispatch("change");
  await ui.binding.validateSelectedFile();

  assert.equal(ui.confirmButton.disabled, true);
  assert.equal(ui.reconciliationButton.disabled, true);
  assert.equal(await ui.binding.exportValidatedFile(), false);
});


test("reconciliation request sends only the scoped validation token", async () => {
  const errors = [];
  const ui = harness({
    validationResult: {
      validationToken: "token-report",
      writableRows: 1,
      blockingErrors: [],
      warnings: [],
    },
    exportResponse: {
      ok: false,
      json: async () => ({ message: "report unavailable" }),
    },
    onError: async (error) => errors.push(error.message),
  });
  ui.input.files = [xlsxFile()];
  ui.input.dispatch("change");
  await ui.binding.validateSelectedFile();

  assert.equal(ui.reconciliationButton.disabled, false);
  assert.equal(await ui.binding.downloadReconciliation(), false);
  assert.equal(
    ui.exportCalls[0][0],
    "/api/packages/pkg%2F01/award-result-excel/reconciliation",
  );
  assert.equal(ui.exportCalls[0][1].method, "POST");
  assert.deepEqual(JSON.parse(ui.exportCalls[0][1].body), {
    validationToken: "token-report",
  });
  assert.deepEqual(errors, ["report unavailable"]);
});


test("validation and export errors are reported in Vietnamese", async () => {
  const errors = [];
  const ui = harness({
    validationResult: { validationToken: "token-3", blockingErrors: [], warnings: [] },
    exportResponse: {
      ok: false,
      json: async () => ({ message: "Dữ liệu hiện tại có lỗi chặn xuất file." }),
    },
    onError: async (error) => errors.push(error.message),
  });
  ui.input.files = [xlsxFile()];
  ui.input.dispatch("change");
  await ui.binding.validateSelectedFile();
  const exported = await ui.binding.exportValidatedFile();

  assert.equal(exported, false);
  assert.equal(ui.status.textContent, "Không thể tạo file Excel kết quả.");
  assert.deepEqual(errors, ["Dữ liệu hiện tại có lỗi chặn xuất file."]);
});


test("summary markup escapes issue text", () => {
  const markup = buildAwardResultValidationMarkup({
    blockingErrors: [{ excelRow: 2, message: "<img src=x onerror=alert(1)>" }],
  });
  assert.doesNotMatch(markup, /<img/);
  assert.match(markup, /&lt;img/);
});
