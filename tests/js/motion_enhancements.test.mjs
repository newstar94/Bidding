import assert from "node:assert/strict";
import fs from "node:fs";
import test from "node:test";

import {
  countingNumberValue,
  parseCountingText,
  rippleGeometry,
  tabIndicatorGeometry,
} from "../../frontend/shared/motionEnhancements.js";

test("tab indicator geometry is relative to the scrolled tablist", () => {
  const geometry = tabIndicatorGeometry(
    { left: 100, top: 40 },
    { left: 260, top: 48, width: 120, height: 36 },
    { scrollLeft: 30, scrollTop: 0, clientLeft: 1, clientTop: 1 },
  );
  assert.deepEqual(geometry, { x: 189, y: 7, width: 120, height: 36 });
});

test("tab indicator hides for collapsed or missing tabs", () => {
  assert.equal(tabIndicatorGeometry({ left: 0, top: 0 }, { left: 0, top: 0, width: 0, height: 20 }), null);
  assert.equal(tabIndicatorGeometry({ left: 0, top: 0 }, null), null);
});

test("ripple covers the farthest corner from the pointer", () => {
  const { x, y, size } = rippleGeometry({ left: 10, top: 10, width: 100, height: 40 }, 20, 20);
  assert.equal(x, 10);
  assert.equal(y, 10);
  assert.equal(size, Math.hypot(90, 30) * 2);
});

test("ripple origin is clamped inside the button", () => {
  const { x, y } = rippleGeometry({ left: 0, top: 0, width: 50, height: 20 }, -15, 99);
  assert.equal(x, 0);
  assert.equal(y, 20);
});

test("counting number eases from zero to the exact target", () => {
  assert.equal(countingNumberValue(68, 0), 0);
  assert.equal(countingNumberValue(68, 1), 68);
  assert.equal(countingNumberValue(68, 2), 68);
  const halfway = countingNumberValue(68, 0.5);
  assert.ok(halfway > 34 && halfway < 68, "ease-out runs ahead of linear progress");
});

test("counting text keeps its unit suffix", () => {
  assert.deepEqual(parseCountingText("31 tỷ"), { target: 31, suffix: " tỷ" });
  assert.deepEqual(parseCountingText(" 24 "), { target: 24, suffix: "" });
  assert.equal(parseCountingText("Hôm nay"), null);
});

test("motion layer stays presentation-only and honours reduced motion", () => {
  const css = fs.readFileSync(new URL("../../views/css/motion.css", import.meta.url), "utf8");
  const source = fs.readFileSync(new URL("../../frontend/shared/motionEnhancements.js", import.meta.url), "utf8");
  assert.match(css, /@media \(prefers-reduced-motion: reduce\)/);
  // Fill "both" would pin a transform on existing menus after the animation.
  assert.doesNotMatch(css, /animation:[^;]*\bboth\b/u);
  assert.match(source, /prefers-reduced-motion: reduce/);
  assert.match(source, /setAttribute\("aria-hidden", "true"\)/);
  assert.doesNotMatch(source, /innerHTML|insertAdjacentHTML/);
  const appCss = fs.readFileSync(new URL("../../views/css/app.css", import.meta.url), "utf8");
  assert.ok(
    appCss.indexOf('"./motion.css"') > appCss.indexOf('"./ui-redesign.css"'),
    "motion layer loads after the redesign overrides",
  );
});
