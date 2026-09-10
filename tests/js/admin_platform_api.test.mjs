import assert from "node:assert/strict";
import test from "node:test";

import { AdminApiError, getAdminJson, postAdminJson } from "../../frontend/admin-platform/AdminApi.js";

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
  await assert.rejects(() => getAdminJson("/api/commercial/drafts"), TypeError);
});

test("admin API permits the exact read-only commercial overview endpoint", async () => {
  let request;
  await getAdminJson("/api/commercial/admin/overview", {
    fetchImpl: async (url, options) => {
      request = { url, options };
      return new Response(JSON.stringify({ drafts: [] }), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      });
    },
  });
  assert.equal(request.url, "/api/commercial/admin/overview");
  assert.equal(request.options.method, "GET");
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

test("admin API permits only approved billing mutations and sends CSRF and idempotency headers", async () => {
  const requests = [];
  const previousDocument = globalThis.document;
  globalThis.document = { cookie: "csrf_token=csrf-test-token" };
  const fetchImpl = async (url, options = {}) => {
    requests.push({ url, options });
    return new Response(JSON.stringify({ replayed: false }), {
      status: 201,
      headers: { "Content-Type": "application/json" },
    });
  };
  try {
    await postAdminJson("/api/billing/admin/orders/order-public-1/refund", {
      body: { amount: 1000, reason: "Đã kiểm tra" },
      idempotencyKey: "admin-refund:test-1234",
      fetchImpl,
    });
    const mutation = requests.at(-1);
    assert.equal(mutation.url, "/api/billing/admin/orders/order-public-1/refund");
    assert.equal(mutation.options.method, "POST");
    assert.equal(new Headers(mutation.options.headers).get("X-CSRF-Token"), "csrf-test-token");
    assert.equal(new Headers(mutation.options.headers).get("Idempotency-Key"), "admin-refund:test-1234");
    assert.equal(new Headers(mutation.options.headers).has("X-Active-Org"), false);
    await assert.rejects(() => postAdminJson("/api/billing/admin/orders/order-public-1/delete", { fetchImpl }), TypeError);
  } finally {
    if (previousDocument === undefined) delete globalThis.document;
    else globalThis.document = previousDocument;
  }
});
