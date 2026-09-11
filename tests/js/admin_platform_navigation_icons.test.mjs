import assert from "node:assert/strict";
import test from "node:test";
import { readFile } from "node:fs/promises";

import { ADMIN_ROUTE_ICONS, adminIconMarkup } from "../../frontend/admin-platform/AdminIcons.js";
import { ADMIN_ROUTES } from "../../frontend/admin-platform/AdminRouter.js";

test("every admin sidebar route has a code-owned accessible decorative icon", () => {
  assert.deepEqual(Object.keys(ADMIN_ROUTE_ICONS), ADMIN_ROUTES.map(([path]) => path));
  for (const [path] of ADMIN_ROUTES) {
    const markup = adminIconMarkup(ADMIN_ROUTE_ICONS[path]);
    assert.match(markup, /^<svg/u);
    assert.match(markup, /aria-hidden="true"/u);
    assert.match(markup, /focusable="false"/u);
    assert.match(markup, /class="nav-link-icon"/u);
    assert.match(markup, /<path|<circle/u);
  }
});

test("admin shell renders icons for sidebar and top navigation", async () => {
  const [appSource, navigationSource] = await Promise.all([
    readFile(new URL("../../frontend/admin-platform/AdminApp.js", import.meta.url), "utf8"),
    readFile(new URL("../../frontend/admin-platform/AdminNavigation.js", import.meta.url), "utf8"),
  ]);
  assert.match(navigationSource, /adminIconMarkup\(ADMIN_ROUTE_ICONS\[path\]\)/u);
  assert.match(appSource, /adminIconMarkup\("account"\)/u);
  assert.match(appSource, /adminIconMarkup\("workspace"\)/u);
});

test("unknown admin icon names fail closed", () => {
  assert.equal(adminIconMarkup("untrusted-icon"), "");
});
