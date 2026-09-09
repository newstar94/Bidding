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
