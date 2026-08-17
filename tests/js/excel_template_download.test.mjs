import assert from "node:assert/strict";
import test from "node:test";

import { triggerExcelTemplateDownload } from "../../frontend/documents/excelTemplateAdapter.js";
import {
  buildPhanLoExportPayload,
  buildTuyChonMuaThemExportPayload,
  triggerExcelTemplateDownload as triggerExcelDownloadWorkflow,
} from "../../frontend/documents/ExcelIntegration.js";
import * as workflowHelpers from "../../frontend/shared/workflow_helpers.js";


test("lot Excel export uses the backend phanLoList contract", () => {
  const rows = [{ maPhanLo: "L01", tenPhanLo: "Lot 01" }];

  assert.deepEqual(buildPhanLoExportPayload(rows), { phanLoList: rows });
});


test("optional-purchase Excel export uses the backend tuyChonList contract", () => {
  const rows = [{ hangMuc: "Option 01", soLuong: 1 }];

  assert.deepEqual(buildTuyChonMuaThemExportPayload(rows), { tuyChonList: rows });
});


test("evaluation template download returns its promise to the UI caller", async () => {
  const previousDocument = globalThis.document;
  const previousFetch = globalThis.fetch;
  const previousCreateObjectURL = globalThis.URL.createObjectURL;
  const previousRevokeObjectURL = globalThis.URL.revokeObjectURL;
  globalThis.document = {
    getElementById(id) {
      return id === "danhgiahsdt-goithau-select" ? { value: "gt-1" } : null;
    },
    createElement() {
      return { click() {}, remove() {} };
    },
    body: { appendChild() {} },
  };
  globalThis.fetch = async () => new Response(new Blob(["xlsx"]), { status: 200 });
  globalThis.URL.createObjectURL = () => "blob:test";
  globalThis.URL.revokeObjectURL = () => {};
  const controller = {
    currentDanhGiaTab: "technical",
    model: {
      state: {
        goithau: [{ id: "gt-1", maGoiThau: "IB-1" }],
      },
    },
  };

  try {
    const result = triggerExcelTemplateDownload(controller, "danhgiahsdt");
    await new Promise((resolve) => setTimeout(resolve, 50));
    assert.equal(typeof result?.then, "function");
  } finally {
    globalThis.document = previousDocument;
    globalThis.fetch = previousFetch;
    globalThis.URL.createObjectURL = previousCreateObjectURL;
    globalThis.URL.revokeObjectURL = previousRevokeObjectURL;
  }
});

test("evaluation template download sends the selected lot scope", async () => {
  const previousDocument = globalThis.document;
  const previousFetch = globalThis.fetch;
  const previousCreateObjectURL = globalThis.URL.createObjectURL;
  const previousRevokeObjectURL = globalThis.URL.revokeObjectURL;
  let requestedUrl = "";
  globalThis.document = {
    getElementById(id) {
      return id === "danhgiahsdt-goithau-select" ? { value: "gt-1" } : null;
    },
    createElement() {
      return { click() {}, remove() {} };
    },
    body: { appendChild() {} },
  };
  globalThis.fetch = async (url) => {
    requestedUrl = String(url);
    return new Response(new Blob(["xlsx"]), { status: 200 });
  };
  globalThis.URL.createObjectURL = () => "blob:test";
  globalThis.URL.revokeObjectURL = () => {};
  const controller = {
    currentDanhGiaTab: "technical",
    _evaluationLotScopes: {
      "gt-1:technical": {
        mode: "selected",
        selectedLotIds: ["lot-1"],
        availableLotIds: ["lot-1", "lot-2"],
      },
    },
    model: {
      state: {
        goithau: [{
          id: "gt-1",
          maGoiThau: "IB-1",
          phanLo: "Có",
          phanLoList: [
            { id: "lot-1", maPhanLo: "PL1" },
            { id: "lot-2", maPhanLo: "PL2" },
          ],
        }],
      },
    },
  };

  try {
    await triggerExcelTemplateDownload(controller, "danhgiahsdt");
    assert.match(requestedUrl, /(?:\?|&)lot_codes=PL1(?:&|$)/);
    assert.doesNotMatch(requestedUrl, /PL2/);
  } finally {
    globalThis.document = previousDocument;
    globalThis.fetch = previousFetch;
    globalThis.URL.createObjectURL = previousCreateObjectURL;
    globalThis.URL.revokeObjectURL = previousRevokeObjectURL;
  }
});

test("evaluation template download keeps the client filename short for many lots", async () => {
  const previousDocument = globalThis.document;
  const previousFetch = globalThis.fetch;
  const previousCreateObjectURL = globalThis.URL.createObjectURL;
  const previousRevokeObjectURL = globalThis.URL.revokeObjectURL;
  let requestedFilename = "";
  globalThis.document = {
    getElementById(id) {
      return id === "danhgiahsdt-goithau-select" ? { value: "gt-1" } : null;
    },
    createElement() {
      return {
        set download(value) { requestedFilename = value; },
        click() {},
        remove() {},
      };
    },
    body: { appendChild() {} },
  };
  globalThis.fetch = async () => new Response(new Blob(["xlsx"]), { status: 200 });
  globalThis.URL.createObjectURL = () => "blob:test";
  globalThis.URL.revokeObjectURL = () => {};
  const lots = Array.from({ length: 21 }, (_, index) => ({
    id: `lot-${index + 1}`,
    maPhanLo: `PP2600239${String(575 + index).padStart(3, "0")}`,
  }));
  const controller = {
    currentDanhGiaTab: "technical",
    _evaluationLotScopes: {
      "gt-1:technical": {
        mode: "selected",
        selectedLotIds: lots.map((lot) => lot.id),
        availableLotIds: lots.map((lot) => lot.id),
      },
    },
    model: {
      state: {
        goithau: [{
          id: "gt-1",
          maGoiThau: "IB2600291864",
          phanLo: "Có",
          phanLoList: lots,
        }],
      },
    },
  };

  try {
    await triggerExcelTemplateDownload(controller, "danhgiahsdt");
    assert.equal(requestedFilename, "DanhGia_HSDT_IB2600291864.xlsx");
  } finally {
    globalThis.document = previousDocument;
    globalThis.fetch = previousFetch;
    globalThis.URL.createObjectURL = previousCreateObjectURL;
    globalThis.URL.revokeObjectURL = previousRevokeObjectURL;
  }
});


test("download workflow reports server errors instead of leaking a rejection", async () => {
  const previousDocument = globalThis.document;
  const previousFetch = globalThis.fetch;
  const alerts = [];
  globalThis.document = {
    getElementById(id) {
      return id === "danhgiahsdt-goithau-select" ? { value: "gt-1" } : null;
    },
  };
  globalThis.fetch = async () => new Response(
    JSON.stringify({ error: "Dịch vụ xử lý tài liệu tạm thời không khả dụng." }),
    {
      status: 503,
      headers: {
        "content-type": "application/json",
        "retry-after": "0",
      },
    },
  );
  const controller = {
    currentDanhGiaTab: "technical",
    model: {
      state: {
        goithau: [{ id: "gt-1", maGoiThau: "IB-1" }],
      },
    },
    view: {
      customAlert(...args) {
        alerts.push(args);
        return Promise.resolve();
      },
    },
  };

  try {
    await triggerExcelDownloadWorkflow.call(controller, "danhgiahsdt");
    await new Promise((resolve) => setTimeout(resolve, 50));
    assert.equal(alerts.length, 1);
    assert.equal(alerts[0][0], "Lỗi tải mẫu");
    assert.match(alerts[0][1], /tạm thời không khả dụng/);
  } finally {
    globalThis.document = previousDocument;
    globalThis.fetch = previousFetch;
  }
});


test("safe download helper resolves after showing the server error", async () => {
  const previousFetch = globalThis.fetch;
  const alerts = [];
  globalThis.fetch = async () => new Response(
    JSON.stringify({ error: "Dịch vụ tài liệu không khả dụng." }),
    {
      status: 503,
      headers: {
        "content-type": "application/json",
        "retry-after": "0",
      },
    },
  );
  const view = {
    customAlert(...args) {
      alerts.push(args);
      return Promise.resolve();
    },
  };

  try {
    assert.equal(typeof workflowHelpers.authFetchDownloadWithAlert, "function");
    const downloaded = await workflowHelpers.authFetchDownloadWithAlert(
      view,
      "/api/export.xlsx",
      "export.xlsx",
    );
    assert.equal(downloaded, false);
    assert.equal(alerts.length, 1);
    assert.match(alerts[0][1], /không khả dụng/);
  } finally {
    globalThis.fetch = previousFetch;
  }
});
