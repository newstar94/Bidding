import assert from "node:assert/strict";
import test from "node:test";

import { renderChangedState } from "../../frontend/app/SyncRenderCoordinator.js";
import { packageWorkspaceFor } from "../../frontend/packages/detail/PackageWorkspaceState.js";
import { capturePackageDetailNavigationIntent } from "../../frontend/packages/GoiThauDetail.js";

test("explicit package workflow navigation is captured before asynchronous hydration", () => {
  const view = {
    _currentWorkflowPackageId: "package-old",
    _currentWorkflowTab: "eval_tech",
  };

  assert.equal(capturePackageDetailNavigationIntent(view, "package-new", "result"), true);
  assert.equal(view._currentWorkflowPackageId, "package-new");
  assert.equal(view._currentWorkflowTab, "result");
});

test("background reconciliation renders the current route after navigation", async () => {
  const previousDocument = globalThis.document;
  const previousAnimationFrame = globalThis.requestAnimationFrame;
  let animationFrame = null;
  globalThis.document = {
    getElementById() { return null; },
    querySelector() { return null; },
  };
  globalThis.requestAnimationFrame = (callback) => {
    animationFrame = callback;
    return 1;
  };
  const calls = [];
  const controller = {
    model: {
      state: {
        activetab: "goithau-detail",
        activeaction: "package-old",
      },
    },
    view: {},
    renderTabData(tab, action) {
      calls.push([tab, action]);
    },
  };

  try {
    await renderChangedState(controller, new Set(["goithau"]), { isBackground: true });
    controller.model.state.activetab = "hopdong-detail";
    controller.model.state.activeaction = "contract-new";
    animationFrame();

    assert.deepEqual(calls, [["hopdong-detail", "contract-new"]]);
  } finally {
    if (previousDocument === undefined) delete globalThis.document;
    else globalThis.document = previousDocument;
    if (previousAnimationFrame === undefined) delete globalThis.requestAnimationFrame;
    else globalThis.requestAnimationFrame = previousAnimationFrame;
  }
});

test("background reconciliation does not reopen a detail behind an active modal", async () => {
  const previousDocument = globalThis.document;
  const previousAnimationFrame = globalThis.requestAnimationFrame;
  let animationFrame = null;
  globalThis.document = {
    getElementById() { return null; },
    querySelector(selector) {
      return selector.includes("modal-overlay") ? {} : null;
    },
  };
  globalThis.requestAnimationFrame = (callback) => {
    animationFrame = callback;
    return 1;
  };
  const calls = [];
  const controller = {
    model: { state: { activetab: "goithau-detail", activeaction: "package-old" } },
    view: {},
    renderTabData(...args) { calls.push(args); },
  };

  try {
    await renderChangedState(controller, new Set(["goithau"]), { isBackground: true });
    animationFrame();
    assert.deepEqual(calls, []);
  } finally {
    if (previousDocument === undefined) delete globalThis.document;
    else globalThis.document = previousDocument;
    if (previousAnimationFrame === undefined) delete globalThis.requestAnimationFrame;
    else globalThis.requestAnimationFrame = previousAnimationFrame;
  }
});

test("background reconciliation preserves an editable package workflow draft", async () => {
  const previousDocument = globalThis.document;
  const previousAnimationFrame = globalThis.requestAnimationFrame;
  let animationFrame = null;
  globalThis.document = {
    getElementById() { return null; },
    querySelector() { return null; },
  };
  globalThis.requestAnimationFrame = (callback) => {
    animationFrame = callback;
    return 1;
  };
  const calls = [];
  const controller = {
    model: { state: { activetab: "goithau-detail", activeaction: "package-old" } },
    view: {},
    renderTabData(...args) { calls.push(args); },
  };
  packageWorkspaceFor(controller.view).load({
    packageId: "package-old",
    workflowTab: "eval_tech",
  });
  packageWorkspaceFor(controller.view).transition({ type: "SET_DIRTY", dirty: true });

  try {
    await renderChangedState(controller, new Set(["goithau"]), { isBackground: true });
    animationFrame();
    assert.deepEqual(calls, []);
  } finally {
    if (previousDocument === undefined) delete globalThis.document;
    else globalThis.document = previousDocument;
    if (previousAnimationFrame === undefined) delete globalThis.requestAnimationFrame;
    else globalThis.requestAnimationFrame = previousAnimationFrame;
  }
});
