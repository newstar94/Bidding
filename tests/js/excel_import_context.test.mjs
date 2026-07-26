import assert from "node:assert/strict";
import test from "node:test";

import { parseBidEvaluationImport } from "../../frontend/documents/excelImportAdapters.js";
import { saveBusinessExcelImport } from "../../frontend/documents/excelSaveAdapters.js";
import {
  excelImportContextIsCurrent,
  saveExcelImport,
} from "../../frontend/documents/ExcelIntegration.js";


function installDocumentWithPackage(packageId) {
  const originalDocument = globalThis.document;
  Object.defineProperty(globalThis, "document", {
    configurable: true,
    value: {
      getElementById(id) {
        if (id.endsWith("-goithau-select")) return { value: packageId };
        return null;
      },
    },
  });
  return () => {
    if (originalDocument === undefined) delete globalThis.document;
    else Object.defineProperty(globalThis, "document", {
      configurable: true,
      value: originalDocument,
    });
  };
}


test("evaluation parser uses the captured package instead of a changed selector", async () => {
  const restore = installDocumentWithPackage("package-b");
  const controller = {
    currentDanhGiaTab: "technical",
    model: {
      state: {
        goithau: [
          { id: "package-a", phanLo: "Không" },
          { id: "package-b", phanLo: "Không" },
        ],
        thongtinmothau: [
          { id: "bid-a", goiThauId: "package-a", maNhaThau: "NT-01" },
          { id: "bid-b", goiThauId: "package-b", maNhaThau: "NT-01" },
        ],
      },
    },
    view: { customAlert: async () => {} },
  };
  try {
    const parsed = await parseBidEvaluationImport(
      controller,
      [{ "Mã nhà thầu": "NT-01", "Đánh giá kỹ thuật": "Đạt" }],
      { packageId: "package-a", evaluationTab: "technical" },
    );
    assert.equal(parsed[0].id, "bid-a");
  } finally {
    restore();
  }
});


test("opening import saves to the captured package instead of a changed selector", async () => {
  const restore = installDocumentWithPackage("package-b");
  const originalLucide = globalThis.lucide;
  globalThis.lucide = { createIcons() {} };
  const controller = {
    model: {
      state: {
        goithau: [
          { id: "package-a", phanLo: "Không" },
          { id: "package-b", phanLo: "Không" },
        ],
        nhathau: [{
          id: "contractor-1",
          maNhaThau: "NT-01",
          tenNhaThau: "Nhà thầu 01",
          loaiNhaThau: "Độc lập",
        }],
        thongtinmothau: [],
      },
      async persistData() {},
    },
    addMoThauRow() {},
  };
  try {
    const count = await saveBusinessExcelImport(
      controller,
      "mothau",
      [{
        _valid: true,
        id: "bid-imported",
        nhaThauId: "contractor-1",
        tenNhaThau: "Nhà thầu 01",
        loaiNhaThau: "Độc lập",
      }],
      { packageId: "package-a" },
    );
    assert.equal(count, 1);
    assert.equal(controller.model.state.thongtinmothau[0].goiThauId, "package-a");
  } finally {
    globalThis.lucide = originalLucide;
    restore();
  }
});


test("save is aborted when the package changed after preview", async () => {
  const restore = installDocumentWithPackage("package-b");
  const alerts = [];
  const context = {
    type: "mothau",
    packageId: "package-a",
    evaluationTab: "",
    workspaceToken: "",
    epoch: 1,
  };
  const controller = {
    _excelImportType: "mothau",
    _excelImportContext: context,
    _excelImportData: [{
      _valid: true,
      id: "bid-imported",
      nhaThauId: "contractor-1",
      tenNhaThau: "Nhà thầu 01",
      loaiNhaThau: "Độc lập",
    }],
    model: {
      state: {
        goithau: [
          { id: "package-a", phanLo: "Không" },
          { id: "package-b", phanLo: "Không" },
        ],
        nhathau: [],
        thongtinmothau: [],
      },
    },
    view: {
      customAlert: async (...args) => { alerts.push(args); },
    },
  };
  try {
    assert.equal(excelImportContextIsCurrent(controller, context), false);
    await saveExcelImport.call(controller);
    assert.deepEqual(controller.model.state.thongtinmothau, []);
    assert.equal(alerts[0][0], "Ngữ cảnh nhập Excel đã thay đổi");
  } finally {
    restore();
  }
});
