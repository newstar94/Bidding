import assert from "node:assert/strict";
import test from "node:test";

import { OrganizationMembershipCommand } from "../../frontend/admin/OrganizationMembershipCommand.js";

test("membership projection reload is one flight per workspace generation", async () => {
  const controller = { model: { getWorkspaceToken: () => "user:org@1" } };
  const command = new OrganizationMembershipCommand(controller);
  let calls = 0;
  let release;
  const task = () => {
    calls += 1;
    return new Promise((resolve) => { release = resolve; });
  };
  const first = command.reloadProjection(task);
  const second = command.reloadProjection(task);
  assert.equal(first, second);
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(calls, 1);
  release(true);
  assert.equal(await first, true);
});

