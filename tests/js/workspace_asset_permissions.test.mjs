import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";

import {
  applyAccessContext,
  canManageWorkspaceWordVariables,
  canUploadWorkspaceAssets,
} from "../../frontend/auth/accessContext.js";


test("workspace asset uploads follow personal and organization manager scope", () => {
  const organizations = [
    { id: "personal:user-a", name: "Cá nhân", scope_type: "personal", role: "employee" },
    { id: "org-a", name: "Tổ chức A", scope_type: "organization", role: "manager" },
    { id: "org-b", name: "Tổ chức B", scope_type: "organization", role: "employee" },
  ];

  assert.equal(canUploadWorkspaceAssets({ organizations }, "employee", "personal:user-a"), true);
  assert.equal(canUploadWorkspaceAssets({ organizations }, "manager", "org-a"), true);
  assert.equal(canUploadWorkspaceAssets({ organizations }, "employee", "org-a"), false);
  assert.equal(canUploadWorkspaceAssets({ organizations }, "manager", "org-b"), false);
});


test("organization Word variables are editable only by its manager", () => {
  const organizations = [
    { id: "personal:user-a", name: "Cá nhân", scope_type: "personal", role: "employee" },
    { id: "org-a", name: "Tổ chức A", scope_type: "organization", role: "manager" },
    { id: "org-b", name: "Tổ chức B", scope_type: "organization", role: "employee" },
  ];

  assert.equal(canManageWorkspaceWordVariables({ organizations }, "employee", "personal:user-a"), true);
  assert.equal(canManageWorkspaceWordVariables({ organizations }, "manager", "org-a"), true);
  assert.equal(canManageWorkspaceWordVariables({ organizations }, "employee", "org-a"), false);
  assert.equal(canManageWorkspaceWordVariables({ organizations }, "manager", "org-b"), false);
});


test("platform Word entitlement overrides an organization without a subscription", () => {
  const button = {
    disabled: false,
    title: "",
    setAttribute() {},
  };
  const previousDocument = globalThis.document;
  globalThis.document = { getElementById: () => button };
  try {
    const target = {};
    applyAccessContext(target, {
      platform_role: "super_admin",
      active_org_id: "org-a",
      entitlements: { word_export: true, source: "platform" },
      organizations: [{
        id: "org-a",
        name: "Tổ chức A",
        scope_type: "organization",
        role: "manager",
        entitlements: { word_export: false, source: "organization_subscription" },
      }],
    });

    assert.equal(target.wordExportEnabled, true);
    assert.equal(button.disabled, false);
  } finally {
    globalThis.document = previousDocument;
  }
});


test("Word mapping UI distinguishes sparse overrides and can restore defaults", () => {
  const workflow = fs.readFileSync("frontend/documents/WordIntegration.js", "utf8");
  const view = fs.readFileSync("frontend/partners/PartnerView.js", "utf8");

  assert.match(workflow, /word-mappings\?includeDisabled=true/);
  assert.match(workflow, /disabledWordMappings/);
  assert.match(workflow, /registerCommand\("resetWordMapping"/);
  assert.match(workflow, /encodeURIComponent\(id\)/);
  assert.match(view, /m\.origin === "override"/);
  assert.match(view, /data-fn="resetWordMapping"/);
  assert.match(view, /Đã ẩn/);
});
