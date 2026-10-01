import assert from "node:assert/strict";
import test from "node:test";

import { BiddingController } from "../../frontend/app/BiddingController.js";
import { createFeatureServices } from "../../frontend/app/FeatureServices.js";

function controllerWithRoutes() {
  const controller = Object.create(BiddingController.prototype);
  controller.routeMap = {
    dashboard: "dashboard",
    "goithau-detail": "goi-thau-chi-tiet",
    hopdong: "hop-dong",
    "hopdong-detail": "hop-dong-chi-tiet",
  };
  return controller;
}

test("selectively hydrated editors load permission matrix before evaluating controls", async () => {
  const controller = controllerWithRoutes();
  const calls = [];
  controller.model = { loadStorageKeys: async (keys) => calls.push(keys) };
  for (const method of ["editChuDauTu", "editNhaThau", "editKeHoach", "editGoiThau"]) {
    await controller.ensureWorkflowData(method);
    assert.ok(calls.at(-1).includes("PERMISSIONMATRIX"), method);
  }
});

test("contractor feature dispatch waits for delayed permission hydration", async () => {
  const controller = controllerWithRoutes();
  let release;
  const hydration = new Promise((resolve) => { release = resolve; });
  let opened = false;
  controller.ensureWorkflowRequirement = async () => {};
  controller.preloadLazyPartial = async () => "";
  controller.model = {
    state: { permissionmatrix: [] },
    loadStorageKeys: async (keys) => {
      if (keys.includes("PERMISSIONMATRIX")) {
        await hydration;
        controller.model.state.permissionmatrix = [{ empId: "employee", nhathau: "view" }];
      }
    },
  };
  controller.editNhaThau = () => {
    assert.equal(controller.model.state.permissionmatrix[0]?.nhathau, "view");
    opened = true;
  };
  const opening = createFeatureServices(controller).partners.editContractor(null);
  await Promise.resolve();
  assert.equal(opened, false);
  release();
  await opening;
  assert.equal(opened, true);
});

test("editor HTML starts with code and scoped data but dispatch waits for all dependencies", async () => {
  const controller = controllerWithRoutes();
  const started = [];
  const releases = {};
  const pending = (key) => {
    started.push(key);
    return new Promise((resolve) => { releases[key] = resolve; });
  };
  controller.ensureWorkflowRequirement = () => pending("code");
  controller.model = { loadStorageKeys: () => pending("data") };
  controller.preloadLazyPartial = (kind, id) => {
    assert.equal(kind, "modal");
    assert.equal(id, "modal-kehoach");
    return pending("html");
  };
  let opened = false;
  controller.editKeHoach = () => { opened = true; };
  const opening = createFeatureServices(controller).plans.edit(null);
  assert.deepEqual(started, ["code", "data", "html"]);
  releases.code();
  releases.html();
  await Promise.resolve();
  assert.equal(opened, false);
  releases.data();
  await opening;
  assert.equal(opened, true);
});

test("failed editor preload prevents opening and allows a later retry", async () => {
  const controller = controllerWithRoutes();
  controller.ensureWorkflowRequirement = async () => {};
  controller.model = { loadStorageKeys: async () => {} };
  let opened = 0;
  let failed = true;
  controller.editKeHoach = () => { opened += 1; };
  controller.preloadLazyPartial = async () => {
    if (failed) throw new Error("form unavailable");
    return "form";
  };
  const service = createFeatureServices(controller).plans;
  await assert.rejects(service.edit(null), /form unavailable/);
  assert.equal(opened, 0);
  failed = false;
  await service.edit(null);
  assert.equal(opened, 1);
});

test("manual plan editor does not load the import workflow without a pending resume", () => {
  const controller = controllerWithRoutes();
  controller.model = { workspaceStorage: { getItem: () => null } };
  controller.schedulePostStartupTask = () => assert.fail("no pending import");
  assert.equal(controller.scheduleProcurementImportResume("plan-editor"), false);
});

test("plan editor schedules an existing import resume once and rejects a workspace change during import", async () => {
  const controller = controllerWithRoutes();
  let token = "workspace-a";
  let release;
  let resumed = false;
  let imports = 0;
  controller.model = {
    getWorkspaceToken: () => token,
    workspaceStorage: { getItem: () => JSON.stringify({ sessionId: "pending-session" }) },
  };
  let task;
  controller.schedulePostStartupTask = (callback) => { task = callback; };
  controller.ensureWorkflowRequirement = async (requirement) => {
    assert.equal(requirement, "bidding");
    imports += 1;
    await new Promise((resolve) => { release = resolve; });
  };
  controller.resumeProcurementImportSession = () => { resumed = true; };
  assert.equal(controller.scheduleProcurementImportResume("plan-editor"), true);
  assert.equal(controller.scheduleProcurementImportResume("plan-editor"), false);
  const pending = task();
  assert.equal(imports, 1);
  token = "workspace-b";
  release();
  assert.equal(await pending, false);
  assert.equal(resumed, false);
});

test("pending plan resume retries a failed workflow import on a later explicit action", async () => {
  const controller = controllerWithRoutes();
  const tasks = [];
  let imports = 0;
  let resumes = 0;
  controller.model = {
    getWorkspaceToken: () => "workspace-a",
    workspaceStorage: { getItem: () => JSON.stringify({ sessionId: "pending-session" }) },
  };
  controller.schedulePostStartupTask = (callback) => tasks.push(callback);
  controller.ensureWorkflowRequirement = async (requirement) => {
    assert.equal(requirement, "bidding");
    imports += 1;
    if (imports === 1) throw new Error("temporary workflow load failure");
    // Successful workflow installation also tries to schedule the resume.
    assert.equal(controller.scheduleProcurementImportResume("bidding"), false);
  };
  controller.resumeProcurementImportSession = () => { resumes += 1; return true; };

  assert.equal(controller.scheduleProcurementImportResume("plan-editor"), true);
  assert.equal(controller.scheduleProcurementImportResume("plan-editor"), false);
  await assert.rejects(tasks[0](), /temporary workflow load failure/u);
  assert.equal(resumes, 0);
  assert.equal(tasks.length, 1, "failure must not auto-replay the task");

  assert.equal(controller.scheduleProcurementImportResume("plan-editor"), true);
  assert.equal(controller.scheduleProcurementImportResume("plan-editor"), false);
  assert.equal(await tasks[1](), true);
  assert.equal(imports, 2);
  assert.equal(resumes, 1);
  assert.equal(controller.scheduleProcurementImportResume("plan-editor"), false);
});

test("old plan resume import failure cannot clear a newer workspace resume stamp", async () => {
  const controller = controllerWithRoutes();
  const tasks = [];
  let token = "workspace-a";
  let rejectOldImport;
  let imports = 0;
  let resumes = 0;
  controller.model = {
    getWorkspaceToken: () => token,
    workspaceStorage: { getItem: () => JSON.stringify({ sessionId: "pending-session" }) },
  };
  controller.schedulePostStartupTask = (callback) => tasks.push(callback);
  controller.ensureWorkflowRequirement = () => {
    imports += 1;
    return imports === 1
      ? new Promise((_resolve, reject) => { rejectOldImport = reject; })
      : Promise.resolve();
  };
  controller.resumeProcurementImportSession = () => { resumes += 1; return true; };
  assert.equal(controller.scheduleProcurementImportResume("plan-editor"), true);
  const oldTask = tasks[0]();
  const oldFailure = assert.rejects(oldTask, /old import rejected/u);

  token = "workspace-b";
  assert.equal(controller.scheduleProcurementImportResume("plan-editor"), true);
  rejectOldImport(new Error("old import rejected"));
  await oldFailure;
  assert.equal(controller._procurementImportResumeWorkspaceToken, "workspace-b");
  assert.equal(controller.scheduleProcurementImportResume("plan-editor"), false);
  assert.equal(await tasks[1](), true);
  assert.equal(resumes, 1);
});

test("pending plan resume keeps existing once-per-workspace behavior for resume API failure", async () => {
  const controller = controllerWithRoutes();
  const tasks = [];
  let resumes = 0;
  controller.model = {
    getWorkspaceToken: () => "workspace-a",
    workspaceStorage: { getItem: () => JSON.stringify({ sessionId: "pending-session" }) },
  };
  controller.schedulePostStartupTask = (callback) => tasks.push(callback);
  controller.ensureWorkflowRequirement = async () => {};
  controller.resumeProcurementImportSession = async () => {
    resumes += 1;
    throw new Error("resume API unavailable");
  };
  assert.equal(controller.scheduleProcurementImportResume("plan-editor"), true);
  await assert.rejects(tasks[0](), /resume API unavailable/u);
  assert.equal(controller._procurementImportResumeWorkspaceToken, "workspace-a");
  assert.equal(controller.scheduleProcurementImportResume("plan-editor"), false);
  assert.equal(tasks.length, 1);
  assert.equal(resumes, 1);
});

test("contract routes preload the organization contract-status catalog", () => {
  const controller = controllerWithRoutes();

  assert.ok(controller.getStartupPriorityKeys("/hop-dong").includes("CUSTOMCONTRACTSTATUSES"));
  assert.ok(controller.getStartupPriorityKeys("/hop-dong-chi-tiet/contract-1").includes("CUSTOMCONTRACTSTATUSES"));
  assert.ok(controller.getSyncTableKeysForPath("/hop-dong").includes("customcontractstatuses"));
});

test("package detail reload hydrates authoritative bidder goods", () => {
  const controller = controllerWithRoutes();

  assert.ok(
    controller
      .getStartupPriorityKeys("/goi-thau-chi-tiet/package-1")
      .includes("HANGHOADUTHAUNHATHAU"),
  );
  assert.ok(
    controller
      .getSyncTableKeysForPath("/goi-thau-chi-tiet/package-1")
      .includes("hanghoaduthaunhathau"),
  );
});
