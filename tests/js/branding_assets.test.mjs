import assert from "node:assert/strict";
import fs from "node:fs";
import test from "node:test";

const ICON_URL = "/assets/favicon.png?v=transparent-corners-20260814";

test("BiddingFlow uses the supplied icon for favicon and primary brand marks", () => {
  assert.equal(fs.existsSync("views/assets/favicon.png"), true);
  assert.ok(fs.statSync("views/assets/favicon.png").size > 0);

  const index = fs.readFileSync("views/index.html", "utf8");
  assert.equal(index.includes(`<link rel="icon" type="image/png" href="${ICON_URL}">`), true);
  assert.equal(index.includes(`<link rel="apple-touch-icon" href="${ICON_URL}">`), true);

  for (const file of [
    "views/components/sidebar.html",
    "views/components/header.html",
    "views/components/landing_page.html",
    "views/components/legal_page.html",
    "views/components/auth_overlay.html",
  ]) {
    assert.equal(fs.readFileSync(file, "utf8").includes(`src="${ICON_URL}"`), true, file);
  }
});

test("screen-level data loaders render the supplied icon inside a circle", () => {
  const components = fs.readFileSync("views/css/components.css", "utf8");
  const initialRoute = fs.readFileSync("views/css/initial-route.css", "utf8");
  const excelLoading = fs.readFileSync("frontend/shared/ExcelImportLoading.js", "utf8");
  const planModal = fs.readFileSync("views/modals/modal_kehoach.html", "utf8");
  const packageModal = fs.readFileSync("views/modals/modal_goithau.html", "utf8");

  assert.match(initialRoute, /\.initial-loading-spinner[^}]+favicon\.png/s);
  assert.match(components, /\.procurement-lookup-loading__visual[^}]+border-radius:\s*50%/s);
  assert.match(planModal, /procurement-lookup-loading__visual[^>]*>[\s\S]*favicon\.png/);
  assert.match(packageModal, /procurement-lookup-loading__visual[^>]*>[\s\S]*favicon\.png/);
  assert.match(excelLoading, /excel-import-loading-icon/);
  assert.match(excelLoading, /\/assets\/favicon\.png/);
});
