import assert from "node:assert/strict";
import test from "node:test";

import { ApiError } from "../../frontend/shared/apiClient.js";
import { createOfficialAggregateVersion } from "../../frontend/shared/AggregateVersionClient.js";


function jsonResponse(body, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  });
}


test("official aggregate version command refreshes authoritative server state", async () => {
  const requests = [];
  let refreshCount = 0;
  const controller = {
    forceSyncData: async (isBackground) => {
      assert.equal(isBackground, true);
      refreshCount += 1;
      return { ok: true };
    },
  };
  const command = {
    kind: "package",
    sourceId: "package-1",
    expectedRowVersion: 5,
    changes: { tenGoiThau: "Gói mới" },
    clientMutationId: "version-command-1",
  };

  const result = await createOfficialAggregateVersion(controller, command, {
    fetchImpl: async (url, options) => {
      requests.push({ url, options });
      return jsonResponse({ status: "success", syncVersion: 13 });
    },
  });

  assert.equal(result.authoritative, true);
  assert.equal(refreshCount, 1);
  assert.equal(requests[0].url, "/api/versioning/aggregate");
  assert.equal(requests[0].options.headers.get("Idempotency-Key"), "version-command-1");
  assert.deepEqual(JSON.parse(requests[0].options.body), command);
});


test("legacy snapshot fallback is allowed only when the endpoint is unsupported", async () => {
  const command = {
    kind: "plan",
    sourceId: "plan-1",
    expectedRowVersion: 3,
    changes: {},
    clientMutationId: "version-command-plan",
  };

  const unsupported = await createOfficialAggregateVersion({}, command, {
    fetchImpl: async () => jsonResponse({ code: "NOT_FOUND" }, 404),
  });
  assert.deepEqual(unsupported, {
    authoritative: false,
    fallbackRequired: true,
  });

  await assert.rejects(
    createOfficialAggregateVersion({}, command, {
      fetchImpl: async () => jsonResponse({ code: "ROW_VERSION_CONFLICT" }, 409),
    }),
    (error) => error instanceof ApiError && error.status === 409,
  );
});
