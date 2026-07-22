import assert from "node:assert/strict";
import test from "node:test";

import { handlePhatHanhHsmtSubmit } from "../../frontend/packages/bidProcessTenderLifecycle.js";


test("invalid HSMT release form gives visible feedback and targets the first invalid field", async () => {
  const invalidControl = { id: "phathanh-thoigiandangtai" };
  const form = {
    querySelector(selector) {
      assert.equal(selector, '[aria-invalid="true"]');
      return invalidControl;
    },
  };
  const originalDocument = globalThis.document;
  const alerts = [];
  let prevented = false;

  globalThis.document = {
    getElementById(id) {
      return id === "form-phathanh-hsmt" ? form : null;
    },
  };

  try {
    await handlePhatHanhHsmtSubmit.call(
      {
        view: {
          validateForm: (candidate) => {
            assert.equal(candidate, form);
            return false;
          },
          customAlert: async (...args) => alerts.push(args),
        },
      },
      { preventDefault: () => { prevented = true; } }
    );
  } finally {
    globalThis.document = originalDocument;
  }

  assert.equal(prevented, true);
  assert.equal(alerts.length, 1);
  assert.equal(alerts[0][0], "Thiếu thông tin");
  assert.match(alerts[0][1], /bắt buộc/i);
  assert.equal(alerts[0][2], "alert-triangle");
  assert.equal(alerts[0][3], invalidControl);
});
