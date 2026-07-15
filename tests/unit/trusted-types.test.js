import assert from "node:assert/strict";
import test from "node:test";

import { assertSafeHTML, assertSafeScriptURL, trustedHTML, trustedScriptURL } from "../../frontend/shared/trustedTypes.js";

test("Trusted HTML accepts escaped application markup", () => {
  assert.equal(trustedHTML('<span class="badge">Đã lưu</span>'), '<span class="badge">Đã lưu</span>');
});

test("Trusted HTML rejects executable markup and URL handlers", () => {
  for (const payload of [
    "<script>alert(1)</script>",
    '<img src=x onerror="alert(1)">',
    '<a href="javascript:alert(1)">x</a>',
    '<iframe srcdoc="x"></iframe>',
  ]) assert.throws(() => assertSafeHTML(payload), /Unsafe HTML/);
});

test("Trusted Types only permits pinned application and Google script URLs", () => {
  assert.equal(assertSafeScriptURL("/vendor/lucide/lucide.min.js?v=1"), "/vendor/lucide/lucide.min.js?v=1");
  assert.equal(assertSafeScriptURL("https://accounts.google.com/gsi/client"), "https://accounts.google.com/gsi/client");
  assert.throws(() => assertSafeScriptURL("https://evil.example/app.js"), /Unapproved script URL/);
  assert.equal(trustedScriptURL("https://accounts.google.com/gsi/client"), "https://accounts.google.com/gsi/client");
});
