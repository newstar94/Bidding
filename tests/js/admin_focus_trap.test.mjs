import assert from "node:assert/strict";
import test from "node:test";

import { trapAdminDialogFocus } from "../../frontend/admin-platform/AdminFocusTrap.js";

test("admin dialog focus trap registers and releases one keyboard handler", () => {
  const calls = [];
  const container = {
    addEventListener(type, handler) { calls.push(["add", type, handler]); },
    removeEventListener(type, handler) { calls.push(["remove", type, handler]); },
  };
  const release = trapAdminDialogFocus(container);
  release();
  assert.equal(calls[0][0], "add");
  assert.equal(calls[0][1], "keydown");
  assert.deepEqual(calls[1], ["remove", "keydown", calls[0][2]]);
});
