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

test("submit revalidation performs a second authoritative candidate lookup after prefetch", async () => {
  const responses = [
    { candidate: { id: "user-1", status: "prefetched" } },
    { candidate: { id: "user-1", status: "confirmed" } },
  ];
  const calls = [];
  const command = new OrganizationMembershipCommand(
    { model: { getWorkspaceToken: () => "user:org@1" } },
    {
      request: async (url) => {
        calls.push(url);
        return new Response(JSON.stringify(responses.shift()), {
          status: 200,
          headers: { "content-type": "application/json" },
        });
      },
    },
  );

  const prefetched = await command.prefetchCandidate(" USER@example.test ");
  const confirmed = await command.lookupCandidate("user@example.test", { revalidate: true });

  assert.equal(prefetched.status, "prefetched");
  assert.equal(confirmed.status, "confirmed");
  assert.equal(calls.length, 2);
  assert.equal(calls[0], calls[1]);
});

test("mandatory revalidation waits for an in-flight prefetch then performs exactly one fresh lookup", async () => {
  let releasePrefetch;
  let calls = 0;
  const command = new OrganizationMembershipCommand(
    { model: { getWorkspaceToken: () => "user:org@1" } },
    {
      request: async () => {
        calls += 1;
        if (calls === 1) await new Promise((resolve) => { releasePrefetch = resolve; });
        return new Response(JSON.stringify({ candidate: { id: "user-1", revision: calls } }), {
          status: 200,
          headers: { "content-type": "application/json" },
        });
      },
    },
  );

  const prefetch = command.prefetchCandidate("user@example.test");
  await new Promise((resolve) => setImmediate(resolve));
  const revalidation = command.lookupCandidate("user@example.test", { revalidate: true });
  releasePrefetch();

  assert.equal((await prefetch).revision, 1);
  assert.equal((await revalidation).revision, 2);
  assert.equal(calls, 2);
});

test("candidate cache is isolated by exact workspace generation", async () => {
  let workspaceToken = "user:org-a@1";
  let calls = 0;
  const command = new OrganizationMembershipCommand(
    { model: { getWorkspaceToken: () => workspaceToken } },
    {
      request: async () => {
        calls += 1;
        return new Response(JSON.stringify({ candidate: { id: `candidate-${calls}` } }), {
          status: 200,
          headers: { "content-type": "application/json" },
        });
      },
    },
  );

  assert.equal((await command.lookupCandidate("user@example.test")).id, "candidate-1");
  workspaceToken = "user:org-b@2";
  assert.equal((await command.lookupCandidate("user@example.test")).id, "candidate-2");
  assert.equal(calls, 2);
});
