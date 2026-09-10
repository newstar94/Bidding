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

test("admin API encodes server-side directory query values", async () => {
  let requestedUrl = "";
  await getAdminJson("/api/admin/users", {
    query: { page: 2, search: "Minh & An", status: "active" },
    fetchImpl: async (url) => {
      requestedUrl = url;
      return new Response(JSON.stringify({ items: [] }), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      });
    },
  });
  assert.equal(requestedUrl, "/api/admin/users?page=2&search=Minh%20%26%20An&status=active");
});
