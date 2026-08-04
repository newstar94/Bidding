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


function harness({ validationResult, exportResponse, onError } = {}) {
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
  const status = new FakeElement();
  const summary = new FakeElement();
  const close = new FakeElement();
  root.selectors.set("#btn-export-award-result-excel", openButton);
  root.selectors.set("#award-result-excel-panel", panel);
  panel.selectors.set("#award-result-excel-file", input);
  panel.selectors.set("[data-award-excel-file-name]", filename);
  panel.selectors.set("[data-award-excel-validate]", validateButton);
  panel.selectors.set("[data-award-excel-confirm]", confirmButton);
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
      return validationResult;
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


test("export sends only validationToken and downloads the returned filename", async () => {
  const originalDocument = globalThis.document;
  const clicked = [];
  const appended = [];
  globalThis.document = {
    createElement() {
      return {
        href: "",
        download: "",
        hidden: false,
        click() { clicked.push(this.download); },
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
    assert.match(ui.status.textContent, /Đã tạo và tải/);
    assert.equal(ui.confirmButton.disabled, true);
  } finally {
    globalThis.document = originalDocument;
  }
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
