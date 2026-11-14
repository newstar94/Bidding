import assert from "node:assert/strict";
import test from "node:test";

import { runWordPublicationExportJob } from "../../frontend/documents/WordPublicationJob.js";
import {
  REQUIRED_VARIABLES_CODE,
  openComputedVariableForm,
  presentRequiredVariablesWarning,
  requiredVariablesWarning,
} from "../../frontend/documents/requiredWordVariables.js";

// ADR 0106 — letter deadlines are workspace result variables required at export.
const serverPayload = {
  code: REQUIRED_VARIABLES_CODE,
  error: "Biểu mẫu Word đang dùng biến kết quả chưa được cấu hình: Hạn cuối hoàn thiện {ngay_han_hoan_thien_hd}.",
  missingVariables: [{ name: "ngay_han_hoan_thien_hd", label: "Hạn cuối hoàn thiện" }],
  canConfigure: true,
};

async function blockedExport(payload = serverPayload) {
  return runWordPublicationExportJob({ createJobUrl: "/api/document-jobs/package/p", filename: "a.docx" }, {
    request: async () => {
      const error = new Error(payload.error);
      error.status = 422;
      error.code = payload.code;
      error.data = payload;
      throw error;
    },
  }).catch((error) => error);
}

test("job creation keeps the server's missing-variable details and message", async () => {
  const error = await blockedExport();
  assert.equal(error.code, REQUIRED_VARIABLES_CODE);
  assert.match(error.message, /ngay_han_hoan_thien_hd/u);
  assert.deepEqual(requiredVariablesWarning(error), {
    message: serverPayload.error,
    missing: [{ name: "ngay_han_hoan_thien_hd", label: "Hạn cuối hoàn thiện" }],
    canConfigure: true,
  });
});

test("other export errors are not treated as missing variables", () => {
  assert.equal(requiredVariablesWarning(Object.assign(new Error("x"), { code: "DOCUMENT_EXPORT_DENIED" })), null);
  assert.equal(requiredVariablesWarning(null), null);
});

test("a wrapped error still exposes the warning through its cause", async () => {
  const cause = await blockedExport();
  const wrapped = new Error("Không thể xuất", { cause });
  assert.equal(requiredVariablesWarning(wrapped).missing[0].name, "ngay_han_hoan_thien_hd");
});

test("managers are offered to configure the variable right away", async () => {
  const calls = [];
  const controller = {
    view: {
      customConfirm: async (...args) => { calls.push(["confirm", ...args]); return true; },
      customAlert: async () => { calls.push(["alert"]); },
    },
  };
  const opened = [];
  const result = await presentRequiredVariablesWarning(controller, requiredVariablesWarning(await blockedExport()), {
    open: (_controller, name) => opened.push(name),
    defer: (task) => task(),
  });
  assert.equal(result, true);
  assert.equal(calls[0][0], "confirm");
  assert.equal(calls[0][4].confirmLabel, "Cấu hình ngay");
  assert.deepEqual(opened, ["ngay_han_hoan_thien_hd"]);
});

test("people who cannot configure Word variables only get the explanation", async () => {
  const calls = [];
  const controller = {
    view: {
      customConfirm: async () => { calls.push("confirm"); return true; },
      customAlert: async (title, message) => { calls.push([title, message]); },
    },
  };
  const warning = requiredVariablesWarning(await blockedExport({ ...serverPayload, canConfigure: false }));
  const opened = [];
  const result = await presentRequiredVariablesWarning(controller, warning, { open: () => opened.push(1), defer: (task) => task() });
  assert.equal(result, false);
  assert.deepEqual(calls, [["Cần cấu hình biến kết quả", serverPayload.error]]);
  assert.deepEqual(opened, []);
});

test("the result-variable form opens with the name filled and an empty formula", async () => {
  const fields = {
    "wmc-id": { value: "old-id" },
    "wmc-ten-bien": { value: "" },
    "wmc-formula": { value: "addDays(x, 1)", focused: false, focus() { this.focused = true; } },
  };
  const previousDocument = globalThis.document;
  globalThis.document = { getElementById: (id) => fields[id] || null };
  const switched = [];
  const groups = [];
  try {
    const opened = await openComputedVariableForm({
      switchTab: async (tab) => { switched.push(tab); },
      setWordDictionaryGroup: (group) => groups.push(group),
    }, "ngay_han_xac_nhan_nl");
    assert.equal(opened, true);
  } finally {
    globalThis.document = previousDocument;
  }
  assert.deepEqual(switched, ["bieumau"]);
  assert.deepEqual(groups, ["computed"]);
  assert.equal(fields["wmc-id"].value, "");
  assert.equal(fields["wmc-ten-bien"].value, "ngay_han_xac_nhan_nl");
  assert.equal(fields["wmc-formula"].value, "");
  assert.equal(fields["wmc-formula"].focused, true);
});
