import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { fileURLToPath } from "node:url";
import postcss from "postcss";
import { collectConsoleTokens, purgeTablerCss } from "../../scripts/purge_tabler_css.mjs";

test("Tabler purge retains the open drawer transform with an absent hiding class", async () => {
  const css = await readFile(new URL("../../node_modules/@tabler/core/dist/css/tabler.min.css", import.meta.url), "utf8");
  const used = { tokens: new Set(["offcanvas", "offcanvas-end", "show"]), prefixes: [] };
  const result = postcss.parse(purgeTablerCss(css, used));
  let hasOpenTransform = false;
  result.walkRules((rule) => {
    if (!rule.selectors.includes(".offcanvas.show:not(.hiding)")) return;
    rule.walkDecls("transform", (declaration) => {
      if (declaration.value === "none") hasOpenTransform = true;
    });
  });
  assert.equal(hasOpenTransform, true);
});

test("purge conservatively retains functional selectors but drops unused simple branches", () => {
  const css = ".used:not(.missing){transform:none}.used:is(.used,.absent){color:red}.unused,.used{display:block}";
  const result = purgeTablerCss(css, { tokens: new Set(["used"]), prefixes: [] });
  assert.match(result, /\.used:not\(\.missing\)/u);
  assert.match(result, /\.used:is\(\.used,\.absent\)/u);
  assert.doesNotMatch(result, /\.unused/u);
});

test("actual console tokens preserve Tabler open drawer state", () => {
  const used = collectConsoleTokens(fileURLToPath(new URL("../..", import.meta.url)));
  assert.match(purgeTablerCss(".offcanvas.show:not(.hiding){transform:none}", used), /transform:none/u);
});
