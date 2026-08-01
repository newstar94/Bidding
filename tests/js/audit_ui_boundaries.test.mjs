import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";


test("the shared focus token stays thin and adds a soft glow", async () => {
  const [variables, base, redesign] = await Promise.all([
    readFile(new URL("../../views/css/variables.css", import.meta.url), "utf8"),
    readFile(new URL("../../views/css/base.css", import.meta.url), "utf8"),
    readFile(new URL("../../views/css/ui-redesign.css", import.meta.url), "utf8"),
  ]);

  assert.match(variables, /--focus-ring-width:\s*1px;/u);
  assert.match(variables, /--focus-ring-offset:\s*0;/u);
  assert.match(variables, /--focus-ring-glow:\s*0 0 10px rgba\(49, 87, 232, 0\.18\);/u);
  assert.match(
    base,
    /\):focus-visible\s*\{[^}]*outline:\s*var\(--focus-ring-width\)\s+solid\s+var\(--focus-ring\)[^}]*box-shadow:\s*var\(--focus-ring-glow\)\s*!important/su,
  );
  assert.match(
    redesign,
    /\.form-control:focus-visible\s*\{[^}]*outline:\s*var\(--focus-ring-width\)\s+solid\s+var\(--focus-ring\)[^}]*box-shadow:\s*var\(--focus-ring-glow\)/su,
  );
});


test("collapsed sidebar tooltips are available from keyboard focus", async () => {
  const components = await readFile(
    new URL("../../views/css/components.css", import.meta.url),
    "utf8",
  );

  assert.match(
    components,
    /\.sidebar-collapsed\s+\.nav-btn\[data-tooltip\]:focus-visible::before/u,
  );
});


test("stylesheet entrypoint declares and assigns the reviewed cascade layers", async () => {
  const appCss = await readFile(
    new URL("../../views/css/app.css", import.meta.url),
    "utf8",
  );

  assert.match(appCss, /@layer tokens, base, components, features, utilities, legacy;/u);
  assert.match(appCss, /tokens\.css" layer\(tokens\)/u);
  assert.match(appCss, /components\.css" layer\(components\)/u);
  assert.match(appCss, /ui-redesign\.css" layer\(legacy\)/u);
});
