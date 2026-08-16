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
  assert.equal(
    shouldAutoScrollTextControl(textControl({
      matches: (selector) => !selector.includes(".bf-money-control"),
    })),
    false,
    "monetary controls keep their full value visible instead of auto-scrolling",
  );
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
  assert.match(behaviorSource, /MONEY_CONTROL_SELECTORS/u);
  assert.match(behaviorSource, /:not\(\.mt-ma-nha-thau\)/u);
});

test("money controls reserve enough width for a 14-digit VND amount", () => {
  const styles = fs.readFileSync("views/css/views.css", "utf8");
  assert.match(
    styles,
    /input#edit-pkg-price\s*\{[^}]*min-width:\s*calc\(18ch\s*\+\s*2rem\)\s*;/su,
  );
  assert.doesNotMatch(
    styles,
    /input#edit-pkg-price\s*\{[^}]*min-width:[^;}]*!important/su,
  );
  assert.match(styles, /\.bf-money-display/u);
});

test("package detail gives contractor names more room than contractor codes", () => {
  const workflowSource = fs.readFileSync(
    "frontend/packages/BidProcessWorkflow.js",
    "utf8",
  );
  const styles = fs.readFileSync("views/css/views.css", "utf8");
  assert.equal(
    (workflowSource.match(/package-contractor-code-column/g) || []).length,
    7,
  );
  assert.equal(
    (workflowSource.match(/package-contractor-name-column/g) || []).length,
    7,
  );
  assert.match(
    styles,
    /#tab-goithau-detail #mothau-table td:has\(\.mt-ma-nha-thau\)[\s\S]*min-width: 10rem/u,
  );
  assert.match(
    styles,
    /#tab-goithau-detail #mothau-table td:has\(\.mt-ten-nha-thau\)[\s\S]*min-width: 18rem/u,
  );
});

test("package detail gives lot codes a fixed full-display column width", () => {
  const workflowSource = fs.readFileSync(
    "frontend/packages/BidProcessWorkflow.js",
    "utf8",
  );
  const styles = fs.readFileSync("views/css/views.css", "utf8");

  assert.equal(
    (workflowSource.match(/package-lot-code-column/g) || []).length,
    3,
  );
  assert.equal(
    (workflowSource.match(/package-lot-name-column/g) || []).length,
    3,
  );
  assert.match(
    styles,
    /\.package-lot-code-column,[\s\S]*td:has\(\.mt-ma-phan-lo\)[\s\S]*width: 14rem !important;[\s\S]*min-width: 14rem !important;/u,
  );
  assert.match(
    styles,
    /\.package-lot-name-column,[\s\S]*td:has\(\.mt-ten-phan-lo\)[\s\S]*width: 14\.4rem;[\s\S]*min-width: 14\.4rem;/u,
  );
});
