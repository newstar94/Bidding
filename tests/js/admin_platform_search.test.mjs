import assert from "node:assert/strict";
import test from "node:test";

import {
  adminSearchMarkup,
  adminSearchResultsMarkup,
  createAdminSearchController,
} from "../../frontend/admin-platform/AdminSearch.js";

test("admin global search renders an accessible bounded result surface", () => {
  const markup = adminSearchMarkup();
  assert.match(markup, /role="search"/u);
  assert.match(markup, /name="admin_global_search"/u);
  assert.match(markup, /minlength="2"/u);
  assert.match(markup, /maxlength="100"/u);
  assert.match(markup, /aria-controls="admin-global-search-results"/u);

  const results = adminSearchResultsMarkup({ items: [{
    kind: "user", title: '<script>alert("x")</script>',
    description: "safe@example.test", status: "active",
    href: "/admin/users?search=user-1",
  }] });
  assert.doesNotMatch(results, /<script/u);
  assert.match(results, /&lt;script/u);
  assert.match(results, /href="\/admin\/users\?search=user-1"/u);
  assert.doesNotMatch(adminSearchResultsMarkup({ items: [{
    kind: "user", title: "Unsafe", href: "javascript:alert(1)",
  }] }), /javascript:/u);
});

test("admin global search debounces and prevents stale results from winning", async () => {
  const scheduled = [];
  const requests = [];
  const rendered = [];
  const controller = createAdminSearchController({
    schedule: (callback) => { scheduled.push(callback); return scheduled.length; },
    cancelSchedule: () => {},
    search: (query, { signal }) => new Promise((resolve, reject) => {
      requests.push({ query, signal, resolve, reject });
    }),
    render: (state) => rendered.push(state),
    setBusy: () => {},
  });

  controller.query("bravo");
  const firstRun = scheduled.shift()();
  controller.query("alpha");
  assert.equal(requests[0].signal.aborted, true);
  const secondRun = scheduled.shift()();
  requests[1].resolve({ items: [{ title: "Alpha" }] });
  await secondRun;
  requests[0].resolve({ items: [{ title: "Bravo" }] });
  await firstRun;

  assert.deepEqual(rendered.at(-1), { kind: "results", payload: { items: [{ title: "Alpha" }] } });
  assert.equal(rendered.some((state) => state.payload?.items?.[0]?.title === "Bravo"), false);
});
