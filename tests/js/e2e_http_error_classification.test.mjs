import assert from "node:assert/strict";
import fs from "node:fs";
import test from "node:test";

import {
  isExpectedSyncReset,
  isExpectedTelemetryBackpressure,
} from "../../scripts/lib/e2eHttpErrors.mjs";

const response = ({ status = 429, url = "http://127.0.0.1:8000/api/client-errors", method = "POST" } = {}) => ({
  status: () => status,
  url: () => url,
  request: () => ({ method: () => method }),
});

test("E2E classification ignores only exact client telemetry backpressure", () => {
  assert.equal(isExpectedTelemetryBackpressure(response()), true);
  assert.equal(isExpectedTelemetryBackpressure(response({ status: 500 })), false);
  assert.equal(isExpectedTelemetryBackpressure(response({ method: "GET" })), false);
  assert.equal(isExpectedTelemetryBackpressure(response({ url: "http://127.0.0.1:8000/api/sync" })), false);
  assert.equal(isExpectedTelemetryBackpressure(response({ url: "http://127.0.0.1:8000/api/client-errors/other" })), false);
});

test("E2E classification accepts only handled delta full-sync resets", () => {
  const deltaReset = response({
    status: 409,
    url: "http://127.0.0.1:8000/api/sync/delta?after_version=12",
    method: "GET",
  });

  assert.equal(isExpectedSyncReset(deltaReset, {
    code: "SYNC_VISIBILITY_RESET_REQUIRED",
    requiresFullSync: true,
  }), true);
  assert.equal(isExpectedSyncReset(deltaReset, {
    code: "FULL_SYNC_REQUIRED",
    requiresFullSync: true,
  }), true);
  assert.equal(isExpectedSyncReset(deltaReset, {
    code: "CONFLICT",
    requiresFullSync: false,
  }), false);
  assert.equal(isExpectedSyncReset(response({ status: 409, method: "POST" }), {
    requiresFullSync: true,
  }), false);
  assert.equal(isExpectedSyncReset(response({ status: 409, url: "http://127.0.0.1:8000/api/sync" }), {
    requiresFullSync: true,
  }), false);
});

test("canonical deep E2E suites share the telemetry classifier", () => {
  for (const script of [
    "scripts/verify_bidder_goods_e2e.cjs",
    "scripts/verify_crud_modules_e2e.mjs",
    "scripts/verify_package_pairwise_e2e.mjs",
    "scripts/verify_joint_venture_e2e.mjs",
    "scripts/verify_full_lifecycle.mjs",
  ]) {
    const source = fs.readFileSync(script, "utf8");
    assert.match(source, /isExpectedTelemetryBackpressure/u, script);
    assert.match(source, /isExpectedSyncReset/u, script);
  }
});
