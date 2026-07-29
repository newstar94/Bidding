import assert from "node:assert/strict";
import test from "node:test";

import { assertSafeHTML } from "../../frontend/shared/trustedTypes.js";

test("escaped user text that resembles an event handler remains renderable", () => {
  const escaped = '<span>&lt;img src=x onerror=&quot;window.__xss=1&quot;&gt;</span>';
  assert.equal(assertSafeHTML(escaped), escaped);
});

test("an actual event-handler attribute is still rejected", () => {
  assert.throws(
    () => assertSafeHTML('<img src="x" onerror="window.__xss=1">'),
    /Unsafe HTML rejected/,
  );
});

test("escaped payloads inside ordinary attribute values are treated as text", () => {
  const escaped = '<span title="&lt;img src=x onerror=&quot;window.__xss=1&quot;&gt;">safe</span>';
  assert.equal(assertSafeHTML(escaped), escaped);
});

test("an actual javascript URL is still rejected", () => {
  assert.throws(() => assertSafeHTML('<a href="javascript:alert(1)">bad</a>'), /Unsafe HTML rejected/);
});
