import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

import { renderChangedState } from "../../frontend/app/SyncRenderCoordinator.js";
import {
  completePackageWorkspaceEdit,
  packageWorkspaceFor,
} from "../../frontend/packages/detail/PackageWorkspaceState.js";
import {
  capturePackageDetailNavigationIntent,
  markRenderedDetail,
  shouldAbortPackageDetailRefreshForNewDraft,
} from "../../frontend/packages/GoiThauDetail.js";
import { completePackageInvitationEdit } from "../../frontend/packages/detail/PackageOpeningPanel.js";

test("explicit package workflow navigation is captured before asynchronous hydration", () => {
  const view = {
    _currentWorkflowPackageId: "package-old",
    _currentWorkflowTab: "eval_tech",
  };

  assert.equal(capturePackageDetailNavigationIntent(view, "package-new", "result"), true);
  assert.equal(view._currentWorkflowPackageId, "package-new");
  assert.equal(view._currentWorkflowTab, "result");
});

test("completed package renders expose authoritative status and row version", () => {
  const previousDocument = globalThis.document;
  const dataset = { pendingRenderVersion: "7" };
  globalThis.document = {
    getElementById: () => ({ dataset }),
  };
  try {
    markRenderedDetail({
      _currentWorkflowPackageId: "package-1",
      _currentWorkflowTab: "result",
    }, {
      trangThai: "Đã có kết quả",
      rowVersion: 14,
    }, 7);
    assert.deepEqual(dataset, {
      pendingRenderVersion: "7",
      renderedWorkflowTab: "result",
      renderedPackageId: "package-1",
      renderedPackageStatus: "Đã có kết quả",
      renderedPackageRowVersion: "14",
      renderedRenderVersion: "7",
    });
  } finally {
    if (previousDocument === undefined) delete globalThis.document;
    else globalThis.document = previousDocument;
  }
});

test("package refresh preserves a dirty form unless navigation is explicit", () => {
  assert.equal(shouldAbortPackageDetailRefreshForNewDraft({
    isDirty: true,
    currentPackageId: "package-1",
    targetPackageId: "package-1",
  }), true);
  assert.equal(shouldAbortPackageDetailRefreshForNewDraft({
    isDirty: true,
    currentPackageId: "package-1",
    targetPackageId: "package-2",
  }), false);
  assert.equal(shouldAbortPackageDetailRefreshForNewDraft({
    isDirty: true,
    currentPackageId: "package-1",
    targetPackageId: "package-1",
  }), true);
  assert.equal(shouldAbortPackageDetailRefreshForNewDraft({
    isDirty: true,
    currentPackageId: "package-1",
    targetPackageId: "package-1",
    hasExplicitNavigation: true,
  }), false);
});

test("successful invitation save releases the dirty refresh guard", () => {
  const view = { _biddingInfoEditMode: true };
  const workspace = packageWorkspaceFor(view);
  workspace.transition({ type: "SET_DIRTY", dirty: true });

  completePackageInvitationEdit(view);

  assert.equal(view._biddingInfoEditMode, false);
  assert.equal(workspace.isDirty(), false);
});

test("successful package detail mutations release the dirty refresh guard", () => {
  const view = {};
  const workspace = packageWorkspaceFor(view);
  workspace.transition({ type: "SET_DIRTY", dirty: true });

  completePackageWorkspaceEdit(view);

  assert.equal(workspace.isDirty(), false);
});

test("package detail checks draft state before clearing the live panel", () => {
  const source = readFileSync(
    fileURLToPath(new URL("../../frontend/packages/GoiThauDetail.js", import.meta.url)),
    "utf8",
  );
  const contentStart = source.indexOf(
    'const contentWrapper = document.getElementById("detail-workflow-content-wrapper");',
  );
  const clearPanel = source.indexOf('contentWrapper.innerHTML = trustedHTML("");', contentStart);
  const draftGuard = source.indexOf(
    "shouldAbortPackageDetailRefreshForNewDraft({",
    contentStart,
  );
  assert.ok(contentStart >= 0);
  assert.ok(draftGuard >= 0 && draftGuard < clearPanel);
});

test("a package delta renders only the active list and marks hidden projections dirty", async () => {
  const previousDocument = globalThis.document;
  globalThis.document = { getElementById: () => ({}) };
  const calls = [];
  const controller = {
    model: { state: { activetab: "goithau" } },
    view: {
      renderDashboard: () => calls.push("dashboard"),
      renderKeHoachTable: () => calls.push("kehoach"),
      renderGoiThauTable: () => calls.push("goithau"),
      renderPackageTimeline: () => calls.push("timeline"),
      renderNhaThauTable: () => calls.push("nhathau"),
      renderHopDongTable: () => calls.push("hopdong"),
    },
  };
  try {
    await renderChangedState(controller, new Set(["goithau"]));
    assert.deepEqual(calls, ["goithau"]);
    assert.ok(controller._dirtyRouteProjections.has("dashboard"));
    assert.ok(controller._dirtyRouteProjections.has("goithau-timeline"));
    assert.ok(controller._dirtyRouteProjections.has("nhathau"));
  } finally {
    if (previousDocument === undefined) delete globalThis.document;
    else globalThis.document = previousDocument;
  }
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

test("background_render_scheduled_in_workspace_a_does_not_render_after_switch_to_b", async () => {
  const previousDocument = globalThis.document;
  const previousAnimationFrame = globalThis.requestAnimationFrame;
  let animationFrame = null;
  let token = "user:org-a@1";
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
      workspaceScope: { key: "user:org-a", organizationId: "org-a" },
      workspaceStorage: {},
      getWorkspaceToken: () => token,
      isWorkspaceCurrent: (candidate) => candidate === token,
      state: { activetab: "goithau-detail", activeaction: "package-a" },
    },
    view: {},
    renderTabData(...args) { calls.push(args); },
  };

  try {
    await renderChangedState(controller, new Set(["goithau"]), { isBackground: true });
    token = "user:org-a@2";
    controller.model.state = {
      activetab: "hopdong-detail",
      activeaction: "contract-b",
    };
    animationFrame();

    assert.deepEqual(calls, []);
  } finally {
    if (previousDocument === undefined) delete globalThis.document;
    else globalThis.document = previousDocument;
    if (previousAnimationFrame === undefined) delete globalThis.requestAnimationFrame;
    else globalThis.requestAnimationFrame = previousAnimationFrame;
  }
});

test("background detail reconciliation preserves background semantics through tab renderer", async () => {
  const previousDocument = globalThis.document;
  const previousAnimationFrame = globalThis.requestAnimationFrame;
  let animationFrame = null;
  globalThis.document = {
    getElementById() { return null; },
    querySelector() { return null; },
  };
  globalThis.requestAnimationFrame = (callback) => { animationFrame = callback; return 1; };
  const calls = [];
  const controller = {
    model: { state: { activetab: "goithau-detail", activeaction: "package-1" } },
    view: { showPackageDetails(...args) { calls.push(args); } },
    renderTabData(tab, action, options) {
      return this.view.showPackageDetails(action, false, "", options);
    },
  };
  try {
    await renderChangedState(controller, new Set(["goithau"]), { isBackground: true });
    animationFrame();
    assert.deepEqual(calls, [["package-1", false, "", { isBackground: true }]]);
  } finally {
    if (previousDocument === undefined) delete globalThis.document;
    else globalThis.document = previousDocument;
    if (previousAnimationFrame === undefined) delete globalThis.requestAnimationFrame;
    else globalThis.requestAnimationFrame = previousAnimationFrame;
  }
});
