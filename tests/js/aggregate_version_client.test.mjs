import assert from "node:assert/strict";
import test, { beforeEach } from "node:test";

import { ApiError } from "../../frontend/shared/apiClient.js";
import { createOfficialAggregateVersion } from "../../frontend/shared/AggregateVersionClient.js";
import {
  invalidateServerCapabilities,
  updateServerCapabilitiesFromSession,
} from "../../frontend/auth/serverCapabilities.js";
import { beginExplicitLogout } from "../../frontend/auth/authRuntimeState.js";

beforeEach(() => invalidateServerCapabilities());


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
      if (url === "/api/auth/check-session") {
        return jsonResponse({
          valid: true,
          user: { id: "user-1" },
          serverCapabilities: ["aggregate-version-v1"],
        });
      }
      return jsonResponse({ status: "success", syncVersion: 13 });
    },
  });

  assert.equal(result.authoritative, true);
  assert.equal(refreshCount, 1);
  assert.equal(requests[0].url, "/api/auth/check-session");
  assert.equal(requests[1].url, "/api/versioning/aggregate");
  assert.equal(requests[1].options.headers.get("Idempotency-Key"), "version-command-1");
  assert.deepEqual(JSON.parse(requests[1].options.body), command);
});


test("legacy snapshot fallback is selected before POST when capability is absent", async () => {
  const command = {
    kind: "plan",
    sourceId: "plan-1",
    expectedRowVersion: 3,
    changes: {},
    clientMutationId: "version-command-plan",
  };
  const requests = [];
  const diagnostics = [];

  const unsupported = await createOfficialAggregateVersion({}, command, {
    fetchImpl: async (url) => {
      requests.push(url);
      return jsonResponse({ valid: true, user: { id: "legacy-user" } });
    },
    reportFallback: (reason) => diagnostics.push(reason),
  });
  assert.deepEqual(unsupported, {
    authoritative: false,
    fallbackRequired: true,
  });
  assert.deepEqual(requests, ["/api/auth/check-session"]);
  assert.deepEqual(diagnostics, ["capability_missing"]);
});


test("capable backend errors are not mistaken for endpoint incompatibility", async () => {
  const command = {
    kind: "plan",
    sourceId: "plan-1",
    expectedRowVersion: 3,
    changes: {},
    clientMutationId: "version-command-plan",
  };
  const fetchImpl = async (url) => url === "/api/auth/check-session"
    ? jsonResponse({ valid: true, user: { id: "user-1" }, serverCapabilities: ["aggregate-version-v1"] })
    : jsonResponse({ code: "NOT_FOUND" }, 404);

  await assert.rejects(
    createOfficialAggregateVersion({}, command, {
      fetchImpl,
    }),
    (error) => error instanceof ApiError && error.status === 404,
  );
});


test("aggregate conflicts emit a bounded diagnostic and remain rejected", async () => {
  const diagnostics = [];
  const command = {
    kind: "package",
    sourceId: "package-1",
    expectedRowVersion: 8,
    changes: {},
    clientMutationId: "version-command-conflict",
  };

  await assert.rejects(
    createOfficialAggregateVersion({}, command, {
      fetchImpl: async (url) => url === "/api/auth/check-session"
        ? jsonResponse({ valid: true, user: { id: "user-1" }, serverCapabilities: ["aggregate-version-v1"] })
        : jsonResponse({ code: "ROW_VERSION_CONFLICT" }, 409),
      reportConflict: () => diagnostics.push("conflict"),
    }),
    (error) => error instanceof ApiError && error.status === 409,
  );
  assert.deepEqual(diagnostics, ["conflict"]);
});


test("two aggregate actions discover capabilities only once per authenticated session", async () => {
  const requests = [];
  const fetchImpl = async (url) => {
    requests.push(url);
    if (url === "/api/auth/check-session") {
      return jsonResponse({
        valid: true,
        user: { id: "user-1" },
        serverCapabilities: ["aggregate-version-v1"],
      });
    }
    return jsonResponse({ status: "success" });
  };

  for (const suffix of ["one", "two"]) {
    await createOfficialAggregateVersion({}, {
      kind: "package",
      sourceId: "package-1",
      expectedRowVersion: 1,
      changes: {},
      clientMutationId: `version-${suffix}`,
    }, { fetchImpl });
  }

  assert.equal(requests.filter((url) => url === "/api/auth/check-session").length, 1);
  assert.equal(requests.filter((url) => url === "/api/versioning/aggregate").length, 2);
});


test("session bootstrap and refresh update capabilities without action-time discovery", async () => {
  updateServerCapabilitiesFromSession({
    valid: true,
    user: { id: "user-1" },
    serverCapabilities: ["aggregate-version-v1"],
  });
  const requests = [];
  const command = {
    kind: "plan",
    sourceId: "plan-1",
    expectedRowVersion: 1,
    changes: {},
    clientMutationId: "version-from-bootstrap",
  };

  await createOfficialAggregateVersion({}, command, {
    fetchImpl: async (url) => {
      requests.push(url);
      return jsonResponse({ status: "success" });
    },
  });
  updateServerCapabilitiesFromSession({
    valid: true,
    user: { id: "user-1" },
    serverCapabilities: [],
  });
  const fallback = await createOfficialAggregateVersion({}, {
    ...command,
    clientMutationId: "version-after-refresh",
  }, {
    fetchImpl: async (url) => {
      requests.push(url);
      throw new Error("legacy capability fallback must not issue a request");
    },
  });

  assert.deepEqual(requests, ["/api/versioning/aggregate"]);
  assert.equal(fallback.fallbackRequired, true);
});


test("logout and user changes cannot reuse another session capability cache", async () => {
  updateServerCapabilitiesFromSession({
    valid: true,
    user: { id: "user-a" },
    serverCapabilities: ["aggregate-version-v1"],
  });
  beginExplicitLogout({ setItem() {} }, 1);
  let sessionChecks = 0;
  const fallback = await createOfficialAggregateVersion({}, {
    kind: "package",
    sourceId: "package-1",
    expectedRowVersion: 1,
    changes: {},
    clientMutationId: "version-user-b",
  }, {
    fetchImpl: async (url) => {
      assert.equal(url, "/api/auth/check-session");
      sessionChecks += 1;
      return jsonResponse({ valid: true, user: { id: "user-b" } });
    },
  });

  assert.equal(sessionChecks, 1);
  assert.equal(fallback.fallbackRequired, true);
});
