import assert from "node:assert/strict";
import test from "node:test";

import { BiddingModel } from "../../frontend/app/BiddingModel.js";
import { getJvData, setJvData } from "../../frontend/packages/jvDataStore.js";
import { getLotWinners, setLotWinners } from "../../frontend/shared/runtimeState.js";
import { beginWorkspaceRender } from "../../frontend/shared/workspaceRenderCache.js";

const workspace = (key) => ({ workspaceScope: { key } });

test("render caches isolate identical keys between workspaces", () => {
  const workspaceA = workspace("user:org-a");
  const workspaceB = workspace("user:org-b");

  setJvData(workspaceA, "package-1", { leadName: "Org A" });
  setJvData(workspaceB, "package-1", { leadName: "Org B" });
  setLotWinners(workspaceA, "package-1", [{ tenNhaThau: "Winner A" }]);
  setLotWinners(workspaceB, "package-1", [{ tenNhaThau: "Winner B" }]);

  assert.equal(getJvData(workspaceA, "package-1").leadName, "Org A");
  assert.equal(getJvData(workspaceB, "package-1").leadName, "Org B");
  assert.equal(getLotWinners(workspaceA, "package-1")[0].tenNhaThau, "Winner A");
  assert.equal(getLotWinners(workspaceB, "package-1")[0].tenNhaThau, "Winner B");
});

test("starting a replacement render disposes its old cache entries", () => {
  const currentWorkspace = workspace("user:org-render");
  const owner = "package-list";

  beginWorkspaceRender(currentWorkspace, owner);
  setJvData(currentWorkspace, "old-jv", { leadName: "Old" }, { owner });
  setLotWinners(currentWorkspace, "old-package", [{ tenNhaThau: "Old" }], { owner });

  beginWorkspaceRender(currentWorkspace, owner);
  setJvData(currentWorkspace, "new-jv", { leadName: "New" }, { owner });

  assert.equal(getJvData(currentWorkspace, "old-jv"), null);
  assert.equal(getLotWinners(currentWorkspace, "old-package"), null);
  assert.equal(getJvData(currentWorkspace, "new-jv").leadName, "New");
});

test("a workspace render cache evicts its least-recently-used entry at the hard cap", () => {
  const currentWorkspace = workspace("user:org-bounded");
  const owner = "large-render";

  beginWorkspaceRender(currentWorkspace, owner);
  for (let index = 0; index <= 256; index += 1) {
    setJvData(currentWorkspace, `jv-${index}`, { index }, { owner });
  }

  assert.equal(getJvData(currentWorkspace, "jv-0"), null);
  assert.equal(getJvData(currentWorkspace, "jv-256").index, 256);
});

test("workspace memory reset releases all render cache references", () => {
  const model = new BiddingModel();
  model.workspaceScope = { key: "user:org-reset" };
  const retainedJv = { leadName: "Private JV" };
  const retainedWinners = [{ tenNhaThau: "Private Winner" }];

  setJvData(model, "package-private", retainedJv);
  setLotWinners(model, "package-private", retainedWinners);

  model._resetWorkspaceMemory();

  assert.equal(getJvData(model, "package-private"), null);
  assert.equal(getLotWinners(model, "package-private"), null);
});

test("the process-wide render cache registry evicts the oldest workspace", () => {
  const workspaces = Array.from(
    { length: 5 },
    (_, index) => workspace(`user:bounded-org-${index}`),
  );

  workspaces.forEach((currentWorkspace, index) => {
    setJvData(currentWorkspace, "same-key", { index });
  });

  assert.equal(getJvData(workspaces[0], "same-key"), null);
  assert.equal(getJvData(workspaces[4], "same-key").index, 4);
});
