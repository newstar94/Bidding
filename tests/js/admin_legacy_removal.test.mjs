import assert from "node:assert/strict";
import { access, readFile } from "node:fs/promises";
import test from "node:test";

const root = new URL("../../", import.meta.url);
const source = (path) => readFile(new URL(path, root), "utf8");

test("workspace shell and router no longer expose legacy platform-admin tabs", async () => {
  const [sidebar, initialRoute, controller, controllerUi] = await Promise.all([
    source("views/components/sidebar.html"),
    source("views/vendor/initial-route.js"),
    source("frontend/app/BiddingController.js"),
    source("frontend/app/BiddingControllerUI.js"),
  ]);
  const combined = [sidebar, initialRoute, controller, controllerUi].join("\n");
  for (const legacyTab of ["superadmin-dashboard", "superadmin", "usage-analytics", "commercial-admin"]) {
    assert.doesNotMatch(combined, new RegExp(`(?:data-tab="${legacyTab}"|["']${legacyTab}["']\\s*:)`, "u"));
  }
  for (const partial of ["tab_superadmin_dashboard.html", "tab_superadmin.html", "tab_usage_analytics.html", "tab_commercial_admin.html"]) {
    assert.doesNotMatch(controller, new RegExp(partial.replace(".", "\\."), "u"));
    await assert.rejects(() => access(new URL(`views/tabs/${partial}`, root)));
  }
});

test("all super-admin login and workspace defaults navigate to isolated admin shell", async () => {
  const [authFlow, googleAuth, lifecycle, adminUser, controller] = await Promise.all([
    source("frontend/auth/AuthFlowController.js"),
    source("frontend/auth/GoogleAuthController.js"),
    source("frontend/app/WorkspaceLifecycleController.js"),
    source("frontend/admin/AdminUserController.js"),
    source("frontend/app/BiddingController.js"),
  ]);
  for (const sourceText of [authFlow, googleAuth, lifecycle, adminUser]) {
    assert.match(sourceText, /location[^;\n]*assign[^;\n]*\("\/admin"\)/u);
    assert.doesNotMatch(sourceText, /switchTab\("superadmin-dashboard"\)/u);
  }
  assert.doesNotMatch(controller, /superadmin-dashboard|quan-ly-tai-khoan|phan-tich-su-dung|thuong-mai-thanh-toan/u);
});
