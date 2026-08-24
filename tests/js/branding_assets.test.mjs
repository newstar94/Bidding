import assert from "node:assert/strict";
import fs from "node:fs";
import test from "node:test";

const FAVICON_URL = "/assets/favicon.png?v=627f800a6c89ba44b9cc46de81cf01f9cb483e12e7504032e745ab97b04f37dc";
const BRAND_ICON_URL = "/assets/app-brand-icon.webp?v=d308bf4310b5dbba1d17fa6bbd0c1d51eedbcefcc6c3f7034ee223447b9a06f6";

test("BiddingFlow uses the supplied icon for favicon and primary brand marks", () => {
  assert.equal(fs.existsSync("views/assets/favicon.png"), true);
  assert.ok(fs.statSync("views/assets/favicon.png").size <= 50_000);
  assert.equal(fs.existsSync("views/assets/app-brand-icon.webp"), true);
  assert.ok(fs.statSync("views/assets/app-brand-icon.webp").size <= 15_000);

  const index = fs.readFileSync("views/index.html", "utf8");
  assert.equal(index.includes(`<link rel="icon" type="image/png" href="${FAVICON_URL}">`), true);
  assert.equal(index.includes(`<link rel="apple-touch-icon" href="${FAVICON_URL}">`), true);

  for (const file of [
    "views/components/sidebar.html",
    "views/components/header.html",
    "views/components/landing_page.html",
    "views/components/legal_page.html",
    "views/components/auth_overlay.html",
  ]) {
    assert.equal(fs.readFileSync(file, "utf8").includes(`src="${BRAND_ICON_URL}"`), true, file);
  }
});

test("screen-level data loaders render the supplied icon inside a circle", () => {
  const components = fs.readFileSync("views/css/components.css", "utf8");
  const initialRoute = fs.readFileSync("views/css/initial-route.css", "utf8");
  const longTaskLoading = fs.readFileSync("frontend/shared/LongTaskLoading.js", "utf8");
  const planModal = fs.readFileSync("views/modals/modal_kehoach.html", "utf8");
  const packageModal = fs.readFileSync("views/modals/modal_goithau.html", "utf8");

  assert.match(initialRoute, /\.initial-loading-spinner[^}]+app-brand-icon\.webp/s);
  assert.match(components, /\.procurement-lookup-loading__visual[^}]+border-radius:\s*50%/s);
  assert.match(planModal, /procurement-lookup-loading__visual[^>]*>[\s\S]*app-brand-icon\.webp/);
  assert.match(packageModal, /procurement-lookup-loading__visual[^>]*>[\s\S]*app-brand-icon\.webp/);
  assert.match(longTaskLoading, /app-long-task-loading-icon/);
  assert.match(longTaskLoading, /app-brand-image app-long-task-loading-icon/);
  assert.match(longTaskLoading, /\/assets\/app-brand-icon\.webp/);
});
