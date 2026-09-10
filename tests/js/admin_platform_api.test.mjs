import assert from "node:assert/strict";
import test from "node:test";

import { AdminApiError, getAdminJson } from "../../frontend/admin-platform/AdminApi.js";

test("admin API uses same-origin credentials without workspace organization headers", async () => {
  let request;
  const payload = await getAdminJson("/api/admin/overview", {
    fetchImpl: async (url, options) => {
      request = { url, options };
      return new Response(JSON.stringify({ metrics: {} }), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      });
    },
  });
  assert.deepEqual(payload, { metrics: {} });
  assert.equal(request.url, "/api/admin/overview");
  assert.equal(request.options.credentials, "same-origin");
  assert.equal(new Headers(request.options.headers).has("X-Active-Org"), false);
});

test("admin API rejects paths outside the platform boundary", async () => {
  await assert.rejects(() => getAdminJson("/api/auth/users"), TypeError);
});

test("admin API classifies permission denial", async () => {
  await assert.rejects(
    () => getAdminJson("/api/admin/overview", {
      fetchImpl: async () => new Response(JSON.stringify({ code: "FORBIDDEN" }), {
        status: 403,
        headers: { "Content-Type": "application/json" },
      }),
    }),
    (error) => error instanceof AdminApiError && error.status === 403 && error.code === "FORBIDDEN",
  );
});
