import assert from "node:assert/strict";
import { access, readFile } from "node:fs/promises";
import test from "node:test";

import { draftEditorMarkup, plansMarkup } from "../../frontend/admin-platform/AdminPlans.js";

const root = new URL("../../", import.meta.url);

test("Tabler plans replaces the retired commercial control center", async () => {
  await assert.rejects(() => access(new URL("views/tabs/tab_commercial_admin.html", root)));
  await assert.rejects(() => access(new URL("frontend/commercial-policy/CommercialControlCenter.js", root)));
  const controller = await readFile(new URL("frontend/app/BiddingController.js", root), "utf8");
  assert.doesNotMatch(controller, /CommercialControlCenter|commercial-admin/u);
  const markup = plansMarkup({ currentRelease: { id: "r1", versionLabel: "v1", nonSellable: false }, drafts: [] });
  assert.match(markup, /data-admin-plan-action="(?:create|clone|stop-sales)"/u);
});

test("replacement draft editor preserves validation and publish gates", () => {
  const markup = draftEditorMarkup({ id: "d1", revision: 2, document: { offers: [] } }, {
    errors: [], validationDigest: "a".repeat(64), readinessExpiresAt: 9_999_999_999,
  });
  assert.match(markup, /data-admin-plan-action="save"/u);
  assert.match(markup, /data-admin-plan-action="validate"/u);
  assert.doesNotMatch(markup, /data-admin-plan-action="publish" disabled/u);
});
