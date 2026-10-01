import assert from "node:assert/strict";
import test from "node:test";
import {
  landingFixturePreloadTags,
  resolveLandingFixturePreloads,
  routeFixtureCacheControl,
} from "../../scripts/route_fixture_policy.mjs";

test("route fixture caches only successful content-addressed assets immutably", () => {
  for (const extension of ["js", "css", "png", "webp", "woff2", "woff", "ttf"]) {
    for (const statusCode of [200, 206, 304]) {
      assert.equal(
        routeFixtureCacheControl(`/dist/assets/product-aB_12-xy.${extension}`, statusCode),
        "public, max-age=31536000, immutable",
      );
    }
  }
  for (const statusCode of [301, 400, 403, 404, 500]) {
    assert.equal(routeFixtureCacheControl("/dist/assets/app-abcdefgh.js", statusCode), "no-store");
  }
  assert.equal(
    routeFixtureCacheControl(`/vendor/route-shell.js?v=${"a".repeat(64)}`),
    "public, max-age=31536000, immutable",
  );
  assert.equal(
    routeFixtureCacheControl(`/vendor/route-shell.js?v=${"a".repeat(64)}`, 404),
    "no-store",
  );
  assert.equal(
    routeFixtureCacheControl(`/vendor/route-shell.js?v=development&v=${"a".repeat(64)}`),
    "public, max-age=31536000, immutable",
  );
  assert.equal(
    routeFixtureCacheControl(`/vendor/route-shell.js?v=${"a".repeat(64)}&v=development`),
    "public, max-age=0, must-revalidate",
  );
});

test("route fixture retains production revalidation and protected API rules", () => {
  for (const url of [
    "/dist/assets/app.js",
    "/dist/assets/app-abcdefg.js",
    "/dist/assets/app-abcdefghi.js",
    "/vendor/route-shell.js?v=development",
    `/vendor/route-shell.js?v=${"A".repeat(64)}`,
    "/css/app.css",
  ]) {
    assert.equal(routeFixtureCacheControl(url), "public, max-age=0, must-revalidate");
  }
  for (const url of [
    "/api/public/packages",
    "/api/assets/app-abcdefgh.js",
    `/api/public/packages.js?v=${"a".repeat(64)}`,
    "/ws/events",
  ]) {
    assert.equal(routeFixtureCacheControl(url), "no-store, no-cache, must-revalidate");
  }
  for (const url of ["/", "/dist/assets/font.woff2", "/assets/image.svg", "/dist/assets/app-abcdefgh.map"]) {
    assert.equal(routeFixtureCacheControl(url), null);
  }
});

function preloadManifest() {
  return {
    "frontend/app/app.js": {
      file: "assets/app-abcdefgh.js",
      imports: ["_shared.js"],
      dynamicImports: ["_not-startup.js"],
    },
    "frontend/landing/LandingPage.js": {
      file: "assets/landing-abcdefgh.js",
      imports: ["frontend/app/app.js", "_catalog.js"],
    },
    "_shared.js": { file: "assets/shared-abcdefgh.js", imports: ["frontend/app/app.js"] },
    "_catalog.js": { file: "assets/catalog-abcdefgh.js", imports: ["_shared.js"] },
    "_not-startup.js": { file: "assets/not-startup-abcdefgh.js" },
    "views/vendor/fonts/plus-jakarta-sans-latin.woff2": {
      file: "assets/plus-jakarta-sans-latin-abcdefgh.woff2",
    },
    "views/vendor/fonts/plus-jakarta-sans-vietnamese.woff2": {
      file: "assets/plus-jakarta-sans-vietnamese-abcdefgh.woff2",
    },
  };
}

test("landing fixture resolves exact product fonts and static startup graph in production order", () => {
  const manifest = preloadManifest();
  const result = resolveLandingFixturePreloads(manifest, (asset) => !asset.includes("not-startup"));
  assert.deepEqual(result, {
    fontFiles: [
      "assets/plus-jakarta-sans-latin-abcdefgh.woff2",
      "assets/plus-jakarta-sans-vietnamese-abcdefgh.woff2",
    ],
    moduleFiles: [
      "assets/app-abcdefgh.js",
      "assets/landing-abcdefgh.js",
      "assets/shared-abcdefgh.js",
      "assets/catalog-abcdefgh.js",
    ],
  });
  const tags = landingFixturePreloadTags(result, "http://biddingflow.test:8012/");
  assert.ok(tags.includes('<link rel="preload" href="http://biddingflow.test:8012/dist/assets/plus-jakarta-sans-latin-abcdefgh.woff2" as="font" type="font/woff2" crossorigin>'));
  assert.ok(tags.includes('<link rel="preload" href="http://biddingflow.test:8012/dist/assets/plus-jakarta-sans-vietnamese-abcdefgh.woff2" as="font" type="font/woff2" crossorigin>'));
  assert.equal((tags.match(/rel="modulepreload"/g) || []).length, 4);
  assert.ok(tags.lastIndexOf('rel="modulepreload"') < tags.indexOf('as="font"'));
  assert.ok(tags.indexOf("plus-jakarta-sans-latin") < tags.indexOf("plus-jakarta-sans-vietnamese"));
});

test("landing fixture rejects missing, malformed, unsafe, or unhashed manifest assets", () => {
  assert.throws(() => resolveLandingFixturePreloads(preloadManifest()), /existence check/);
  assert.throws(() => resolveLandingFixturePreloads(preloadManifest(), () => false), /Missing landing fixture asset/);
  for (const file of ["../font.woff2", "assets/font.woff2", "assets/font-abcdefg.woff2"]) {
    const manifest = preloadManifest();
    manifest["views/vendor/fonts/plus-jakarta-sans-latin.woff2"].file = file;
    assert.throws(() => resolveLandingFixturePreloads(manifest, () => true), /Unsafe or unhashed/);
  }
  const wrongFont = preloadManifest();
  wrongFont["views/vendor/fonts/plus-jakarta-sans-latin.woff2"].file = "assets/font-abcdefgh.js";
  assert.throws(() => resolveLandingFixturePreloads(wrongFont, () => true), /must reference WOFF2/);
  const missingImport = preloadManifest();
  delete missingImport["_shared.js"];
  assert.throws(() => resolveLandingFixturePreloads(missingImport, () => true), /Missing landing fixture static import/);
  const malformedImports = preloadManifest();
  malformedImports["frontend/app/app.js"].imports = "_shared.js";
  assert.throws(() => resolveLandingFixturePreloads(malformedImports, () => true), /Invalid landing fixture static imports/);
});

test("landing fixture preserves legacy manifests without font preload entries", () => {
  const manifest = preloadManifest();
  delete manifest["views/vendor/fonts/plus-jakarta-sans-latin.woff2"];
  delete manifest["views/vendor/fonts/plus-jakarta-sans-vietnamese.woff2"];
  assert.deepEqual(resolveLandingFixturePreloads(manifest, () => true).fontFiles, []);
});
