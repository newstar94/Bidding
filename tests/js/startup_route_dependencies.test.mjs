import assert from "node:assert/strict";
import test from "node:test";

import { BiddingController } from "../../frontend/app/BiddingController.js";

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
