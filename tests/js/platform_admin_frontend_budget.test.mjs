import assert from "node:assert/strict";
import test from "node:test";

import {
  ADMIN_ENTRY,
  BUDGETS,
  collectAdminManifestAssets,
  enforceBudgets,
} from "../../scripts/verify_platform_admin_frontend_budget.mjs";

test("Platform Admin budget manifest traversal includes transitive assets once", () => {
  const manifest = {
    [ADMIN_ENTRY]: {
      isEntry: true,
      file: "assets/admin-abcdef.js",
      css: ["assets/admin-abcdef.css"],
      imports: ["_shared.js", "_feature.js"],
    },
    "_shared.js": { file: "assets/shared-abcdef.js" },
    "_feature.js": {
      file: "assets/feature-abcdef.js",
      css: ["assets/feature-abcdef.css"],
      imports: ["_shared.js"],
    },
  };

  assert.deepEqual(collectAdminManifestAssets(manifest), {
    javascript: [
      "assets/admin-abcdef.js",
      "assets/feature-abcdef.js",
      "assets/shared-abcdef.js",
    ],
    stylesheets: ["assets/admin-abcdef.css", "assets/feature-abcdef.css"],
  });
});

test("Platform Admin frontend budgets are explicit and enforced", () => {
  assert.deepEqual(BUDGETS, {
    adminJsBytes: 425_000,
    adminCssBytes: 575_000,
    initialRequests: 12,
    dashboardLoadMs: 1_500,
  });
  assert.doesNotThrow(() => enforceBudgets({ ...BUDGETS }));
  assert.throws(
    () => enforceBudgets({ ...BUDGETS, initialRequests: BUDGETS.initialRequests + 1 }),
    /initialRequests=13 exceeds 12/u,
  );
});

test("Platform Admin budget traversal rejects unsafe build paths", () => {
  assert.throws(
    () => collectAdminManifestAssets({
      [ADMIN_ENTRY]: { isEntry: true, file: "../admin.js" },
    }),
    /Unsafe manifest asset path/u,
  );
});
