import assert from "node:assert/strict";
import fs from "node:fs";
import test from "node:test";

test("Google sign-in fallback cannot expand its SVG to the full login card", () => {
  const css = fs.readFileSync("views/css/views.css", "utf8");
  assert.match(css, /\.google-signin-container \[role="button"\][^{]*\{[^}]*height:\s*40px/s);
  assert.match(css, /\.google-signin-container \[role="button"\] svg[^{]*\{[^}]*width:\s*18px[^}]*height:\s*18px/s);
  assert.match(css, /\.google-signin-container \[role="button"\] > div:last-child[^{]*\{[^}]*display:\s*flex/s);
  assert.match(css, /\.google-signin-container #button-label[^{]*\{[^}]*position:\s*absolute/s);
});
