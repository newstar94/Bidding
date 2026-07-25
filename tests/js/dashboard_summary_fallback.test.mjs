import assert from "node:assert/strict";
import test from "node:test";

import {
  renderSuperAdminDashboard,
  shouldUseServerDashboardSummary,
} from "../../frontend/app/DashboardView.js";

test("dashboard rejects an empty server summary when scoped package data is already available", () => {
  const emptySummary = {
    counts: { goithau: 0 },
    statusCounts: {},
    recentPackages: [],
  };

  assert.equal(
    shouldUseServerDashboardSummary(emptySummary, [{ id: "pkg-1" }, { id: "pkg-2" }]),
    false,
  );
  assert.equal(
    shouldUseServerDashboardSummary(emptySummary, []),
    true,
  );
  assert.equal(
    shouldUseServerDashboardSummary({
      counts: { goithau: 2 },
      statusCounts: { completed: 2 },
      recentPackages: [{ id: "pkg-1" }, { id: "pkg-2" }],
    }, [{ id: "pkg-1" }, { id: "pkg-2" }]),
    true,
  );
});

test("first super-admin dashboard render waits for package prices before showing revenue", async () => {
  const previousDocument = globalThis.document;
  const previousFetch = globalThis.fetch;
  const previousLocation = globalThis.location;
  const revenueElement = { textContent: "" };
  const requestedPaths = [];
  const users = [{
    id: "user-1",
    name: "Administrator",
    organizations: [{
      id: "org-1",
      name: "HTD",
      scope_type: "organization",
      role: "manager",
      status: "active",
      subscription: { package_id: "diamond" },
    }],
  }];
  const packages = [{ id: "diamond", price: 75_000_000 }];
  const model = {
    state: { systempackages: [] },
    formatCurrency: (value) => String(value),
  };

  globalThis.location = { origin: "http://localhost" };
  globalThis.document = {
    cookie: "",
    getElementById: (id) => id === "sad-stat-revenue" ? revenueElement : null,
  };
  globalThis.fetch = async (url) => {
    requestedPaths.push(String(url));
    const body = url === "/api/system-packages" ? packages : users;
    return new Response(JSON.stringify(body), {
      status: 200,
      headers: { "content-type": "application/json" },
    });
  };

  try {
    await renderSuperAdminDashboard.call({
      model,
      createIconsScoped: () => {},
    });
    await new Promise((resolve) => setImmediate(resolve));

    assert.deepEqual(requestedPaths.sort(), [
      "/api/auth/users",
      "/api/system-packages",
    ]);
    assert.equal(revenueElement.textContent, "75000000");
    assert.deepEqual(model.state.systempackages, packages);
  } finally {
    if (previousDocument === undefined) delete globalThis.document;
    else globalThis.document = previousDocument;
    if (previousFetch === undefined) delete globalThis.fetch;
    else globalThis.fetch = previousFetch;
    if (previousLocation === undefined) delete globalThis.location;
    else globalThis.location = previousLocation;
  }
});
