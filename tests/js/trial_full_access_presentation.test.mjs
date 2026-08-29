import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

import {
  applyTrialCommercialPresentation,
  isTrialFullAccess,
  resolveTrialVisibleTab,
} from "../../frontend/commercial-policy/trialMode.js";


function trialDocument(enabled = true) {
  const commercialNodes = [
    { hidden: false, setAttribute(name, value) { this[name] = value; } },
    { hidden: false, setAttribute(name, value) { this[name] = value; } },
  ];
  return {
    commercialNodes,
    documentElement: {
      dataset: { trialFullAccess: enabled ? "true" : "false" },
    },
    querySelectorAll(selector) {
      return selector === "[data-commercial-only]" ? commercialNodes : [];
    },
  };
}


test("trial presentation hides every marked commercial surface", () => {
  const documentRef = trialDocument(true);

  assert.equal(isTrialFullAccess(documentRef), true);
  assert.equal(applyTrialCommercialPresentation(documentRef), 2);
  documentRef.commercialNodes.forEach((node) => {
    assert.equal(node.hidden, true);
    assert.equal(node["aria-hidden"], "true");
  });
});


test("normal presentation preserves commercial surfaces", () => {
  const documentRef = trialDocument(false);

  assert.equal(isTrialFullAccess(documentRef), false);
  assert.equal(applyTrialCommercialPresentation(documentRef), 0);
  assert.equal(documentRef.commercialNodes.every((node) => node.hidden === false), true);
});


test("trial mode redirects commercial routes but preserves business routes", () => {
  assert.equal(resolveTrialVisibleTab("commercial-admin", "dashboard", true), "dashboard");
  assert.equal(resolveTrialVisibleTab("commercial-storefront", "dashboard", true), "dashboard");
  assert.equal(resolveTrialVisibleTab("goithau", "dashboard", true), "goithau");
  assert.equal(resolveTrialVisibleTab("commercial-admin", "dashboard", false), "commercial-admin");
});


test("application templates mark every primary paid surface for trial hiding", () => {
  const source = (path) => readFileSync(new URL(`../../${path}`, import.meta.url), "utf8");
  const index = source("views/index.html");
  const landing = source("views/components/landing_page.html");
  const sidebar = source("views/components/sidebar.html");
  const profile = source("views/tabs/tab_profile.html");
  const manager = source("views/tabs/tab_managernhanvien.html");
  const superAdmin = source("views/tabs/tab_superadmin.html");
  const superAdminDashboard = source("views/tabs/tab_superadmin_dashboard.html");

  assert.match(index, /data-trial-full-access="__TRIAL_FULL_ACCESS_ENABLED__"/);
  assert.match(landing, /href="#bang-gia" data-commercial-only/);
  assert.match(landing, /id="bang-gia"[^>]*data-commercial-only/);
  assert.match(sidebar, /data-commercial-only>[\s\S]*?data-tab="commercial-admin"/);
  assert.match(profile, /profile-purchase-history" data-commercial-only/);
  assert.match(manager, /bf-s-6acd22af4f" data-commercial-only/);
  assert.match(superAdmin, /id="sa-stat-revenue"[\s\S]*?data-commercial-only/);
  assert.match(superAdmin, /<th data-commercial-only>Gói đăng ký<\/th>/);
  assert.match(superAdminDashboard, /id="sad-stat-revenue"[\s\S]*?data-commercial-only/);
  assert.match(superAdminDashboard, /<th data-commercial-only>Gói cước<\/th>/);
});
