import assert from "node:assert/strict";
import fs from "node:fs";
import test from "node:test";

const source = fs.readFileSync(new URL("../../views/service-worker.js", import.meta.url), "utf8");

test("service worker caches only content-hashed build assets", () => {
  assert.match(source, /HASHED_ASSET/);
  assert.match(source, /\/dist\\\/assets/);
  assert.doesNotMatch(source, /APP_SHELL|biddingflow-shell/);
  assert.doesNotMatch(source, /url\.pathname\.startsWith\("\/api\/"\)/);
});

test("service worker versions caches per build and removes old releases", () => {
  assert.match(source, /searchParams\.get\("build"\)/);
  assert.match(source, /name\.startsWith\(CACHE_PREFIX\)/);
  assert.match(source, /caches\.delete\(name\)/);
});
