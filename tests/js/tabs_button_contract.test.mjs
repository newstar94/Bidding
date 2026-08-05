import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

import {
  resolveTabKeyboardTarget,
  tabButtonMarkup,
} from "../../frontend/shared/AccessibleTabs.js";
import { buttonMarkup } from "../../frontend/shared/Button.js";


test("tabs support roving focus with arrows and Home End", () => {
  assert.equal(resolveTabKeyboardTarget({ key: "ArrowRight", index: 0, count: 3 }), 1);
  assert.equal(resolveTabKeyboardTarget({ key: "ArrowLeft", index: 0, count: 3 }), 2);
  assert.equal(resolveTabKeyboardTarget({ key: "Home", index: 2, count: 3 }), 0);
  assert.equal(resolveTabKeyboardTarget({ key: "End", index: 0, count: 3 }), 2);
  assert.equal(resolveTabKeyboardTarget({ key: "ArrowDown", index: 1, count: 3, orientation: "vertical" }), 2);
  assert.equal(resolveTabKeyboardTarget({ key: "ArrowRight", index: 1, count: 3, orientation: "vertical" }), null);
});


test("tab markup links tabs to panels and exposes one roving tab stop", () => {
  const active = tabButtonMarkup({ id: "opening", label: "Mở thầu", icon: "folder" }, true, "package");
  const inactive = tabButtonMarkup({ id: "result", label: "Kết quả", icon: "award" }, false, "package");
  const sharedPanel = tabButtonMarkup(
    { id: "preparation", label: "Chuẩn bị", icon: "folder" },
    true,
    "package-workflow",
    "detail-workflow-content-wrapper",
  );

  assert.match(active, /role="tab"/u);
  assert.match(active, /aria-selected="true"/u);
  assert.match(active, /aria-controls="package-panel-opening"/u);
  assert.match(active, /tabindex="0"/u);
  assert.match(inactive, /tabindex="-1"/u);
  assert.match(sharedPanel, /aria-controls="detail-workflow-content-wrapper"/u);
});


test("button contract is explicit and loading prevents double submit", () => {
  const markup = buttonMarkup({
    variant: "danger",
    icon: "x-circle",
    label: "Hủy thầu",
    loading: true,
    disabled: false,
    ariaLabel: "Hủy gói thầu",
    type: "submit",
  });

  assert.match(markup, /btn-danger/u);
  assert.match(markup, /data-lucide="x-circle"/u);
  assert.match(markup, /aria-busy="true"/u);
  assert.match(markup, /disabled/u);
  assert.match(markup, /type="submit"/u);
  assert.throws(
    () => buttonMarkup({ variant: "secondary", icon: "x", label: "", ariaLabel: "" }),
    /accessible name/u,
  );
});


test("package chrome keeps accessible tabs and explicit buttons while sharing the styled version dropdown", async () => {
  const [coordinator, actions] = await Promise.all([
    readFile(new URL("../../frontend/packages/detail/PackageDetailCoordinator.js", import.meta.url), "utf8"),
    readFile(new URL("../../frontend/packages/detail/WorkflowActions.js", import.meta.url), "utf8"),
  ]);

  assert.match(coordinator, /initCustomSelect/u);
  assert.doesNotMatch(coordinator, /dataset\.noCustom/u);
  assert.match(coordinator, /renderAccessibleTabs/u);
  assert.match(actions, /buttonMarkup/u);
});
