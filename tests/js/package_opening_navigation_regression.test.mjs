import assert from "node:assert/strict";
import test from "node:test";
import DOMPurify from "dompurify";
import { showPackageDetails } from "../../frontend/packages/GoiThauDetail.js";
import { setHolidays } from "../../frontend/shared/runtimeState.js";
import { packageWorkspaceFor } from "../../frontend/packages/detail/PackageWorkspaceState.js";

test("opening navigation A to B replaces A content even when A workspace is dirty", async () => {
  const previousDocument = globalThis.document;
  const previousWindow = globalThis.window;
  const previousSanitize = DOMPurify.sanitize;
  const previousSupported = DOMPurify.isSupported;
  DOMPurify.isSupported = true;
  DOMPurify.sanitize = (value) => value;
  const replacement = new Error("panel replacement reached");
  const content = {
    dataset: { renderedPackageId: "A" },
    set innerHTML(value) {
      assert.equal(String(value), "");
      throw replacement;
    },
  };
  const pane = { classList: { contains: () => true } };
  globalThis.document = {
    getElementById: (id) => id === "detail-workflow-content-wrapper" ? content
      : id === "tab-goithau-detail" ? pane : null,
    querySelector: () => null,
  };
  globalThis.window = { location: { search: "", pathname: "/goi-thau" } };
  setHolidays({});
  const view = {
    _currentWorkflowPackageId: "A",
    _currentWorkflowTab: "opening",
    model: {
      state: { goithau: [], thongtinmothau: [] },
      getLatestPackage: () => ({ id: "B", trangThai: "Đã mở thầu" }),
    },
    _packageDetailModule: { mount() {} },
  };
  packageWorkspaceFor(view).transition({ type: "SET_DIRTY", dirty: true });
  try {
    await assert.rejects(showPackageDetails.call(view, "B"), (error) => error === replacement);
  } finally {
    globalThis.document = previousDocument;
    globalThis.window = previousWindow;
    DOMPurify.sanitize = previousSanitize;
    DOMPurify.isSupported = previousSupported;
  }
});
