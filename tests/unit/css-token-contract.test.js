import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

test("avatar gradients have a declared accent token and resilient fallbacks", async () => {
  const [variables, components, views] = await Promise.all([
    readFile(new URL("../../views/css/variables.css", import.meta.url), "utf8"),
    readFile(new URL("../../views/css/components.css", import.meta.url), "utf8"),
    readFile(new URL("../../views/css/views.css", import.meta.url), "utf8")
  ]);

  assert.match(variables, /--accent:\s*#[0-9a-f]{6}/i);
  assert.match(components, /var\(--accent,\s*#[0-9a-f]{6}\)/i);
  assert.match(views, /var\(--accent,\s*#[0-9a-f]{6}\)/i);
});

test("keyboard focus uses the branded ring instead of the browser black outline", async () => {
  const base = await readFile(new URL("../../views/css/base.css", import.meta.url), "utf8");

  assert.match(base, /:focus\s*\{/);
  assert.match(base, /outline:\s*2px solid var\(--primary\)/);
  assert.match(base, /outline-offset:\s*2px/);
  assert.match(base, /:focus:not\(:focus-visible\)\s*\{\s*outline:\s*none/);
});

test("form checkboxes are not stretched by shared text-input dimensions", async () => {
  const components = await readFile(new URL("../../views/css/components.css", import.meta.url), "utf8");
  const checkboxRule = components.match(/\.form-group input\[type=checkbox\]\s*\{([^}]*)\}/)?.[1] || "";

  assert.match(checkboxRule, /width:\s*18px/);
  assert.match(checkboxRule, /height:\s*18px/);
  assert.match(checkboxRule, /min-height:\s*18px/);
  assert.match(checkboxRule, /padding:\s*0/);
});

test("the final modal close-button override remains circular", async () => {
  const redesign = await readFile(new URL("../../views/css/ui-redesign.css", import.meta.url), "utf8");
  const closeButtonRule = redesign.match(/\.modal-close\s*\{([^}]*)\}/)?.[1] || "";

  assert.match(closeButtonRule, /width:\s*40px/);
  assert.match(closeButtonRule, /height:\s*40px/);
  assert.match(closeButtonRule, /border-radius:\s*50%/);
  assert.match(closeButtonRule, /align-items:\s*center/);
  assert.match(closeButtonRule, /justify-content:\s*center/);
  assert.match(closeButtonRule, /font-size:\s*0/);
  const closeIconRule = redesign.match(/\.modal-close::before\s*\{([^}]*)\}/)?.[1] || "";
  assert.match(closeIconRule, /width:\s*14px/);
  assert.match(closeIconRule, /height:\s*14px/);
  assert.match(closeIconRule, /linear-gradient\(45deg/);
});

test("timeline controls use one standard two-pixel focus ring", async () => {
  const views = await readFile(new URL("../../views/css/views.css", import.meta.url), "utf8");
  const focusRule = views.match(/\.timeline-field \.custom-select-search:focus,[\s\S]*?\.timeline-restore-source:focus\s*\{([^}]*)\}/)?.[1] || "";

  assert.match(focusRule, /border-color:\s*var\(--brand\)/);
  assert.match(focusRule, /outline:\s*none !important/);
  assert.match(focusRule, /box-shadow:\s*0 0 0 2px var\(--focus-ring\)/);
  assert.doesNotMatch(focusRule, /outline:\s*3px/);
});
