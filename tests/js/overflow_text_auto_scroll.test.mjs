import assert from "node:assert/strict";
import fs from "node:fs";
import test from "node:test";

import {
  OVERFLOW_SCROLL_DEFAULTS,
  overflowScrollPosition,
  shouldAutoScrollTextControl,
  textControlOverflowDistance,
} from "../../frontend/shared/overflowTextAutoScroll.js";

function textControl(overrides = {}) {
  return {
    clientWidth: 120,
    isConnected: true,
    matches: () => true,
    scrollWidth: 280,
    value: "Công ty có tên dài hơn không gian hiển thị",
    ...overrides,
  };
}

test("overflow distance only includes the hidden portion of a text control", () => {
  assert.equal(textControlOverflowDistance(textControl()), 160);
  assert.equal(textControlOverflowDistance(textControl({ scrollWidth: 100 })), 0);
});

test("overflow text waits, moves left, pauses at the end, then restarts", () => {
  const { endDelayMs, speedPxPerSecond, startDelayMs } = OVERFLOW_SCROLL_DEFAULTS;
  const distance = 68;
  const travelDuration = distance / speedPxPerSecond * 1000;

  assert.equal(overflowScrollPosition(startDelayMs - 1, distance), 0);
  assert.equal(
    overflowScrollPosition(startDelayMs + travelDuration / 2, distance),
    distance / 2,
  );
  assert.equal(
    overflowScrollPosition(startDelayMs + travelDuration + endDelayMs - 1, distance),
    distance,
  );
  assert.equal(
    overflowScrollPosition(startDelayMs + travelDuration + endDelayMs, distance),
    0,
  );
});

test("only connected, overflowing, unfocused text controls auto-scroll", () => {
  const control = textControl();
  assert.equal(shouldAutoScrollTextControl(control), true);
  assert.equal(shouldAutoScrollTextControl(control, control), false);
  assert.equal(shouldAutoScrollTextControl(textControl({ value: "" })), false);
  assert.equal(shouldAutoScrollTextControl(textControl({ scrollWidth: 120 })), false);
  assert.equal(shouldAutoScrollTextControl(textControl({ isConnected: false })), false);
  assert.equal(shouldAutoScrollTextControl(textControl({ matches: () => false })), false);
});

test("application installs overflow scrolling during shared UI bootstrap", () => {
  const source = fs.readFileSync("frontend/app/app.js", "utf8");
  const behaviorSource = fs.readFileSync(
    "frontend/shared/overflowTextAutoScroll.js",
    "utf8",
  );
  assert.match(source, /installOverflowTextAutoScroll\(document\)/u);
  assert.match(behaviorSource, /detectProgrammaticValueChanges/u);
  assert.match(behaviorSource, /:not\(\.mt-ma-nha-thau\)/u);
});

test("package detail contractor code column is wide and does not auto-scroll", () => {
  const workflowSource = fs.readFileSync(
    "frontend/packages/BidProcessWorkflow.js",
    "utf8",
  );
  const styles = fs.readFileSync("views/css/views.css", "utf8");
  assert.equal(
    (workflowSource.match(/package-contractor-code-column/g) || []).length,
    7,
  );
  assert.match(
    styles,
    /#tab-goithau-detail #mothau-table td:has\(\.mt-ma-nha-thau\)[\s\S]*min-width: 13rem/u,
  );
});
