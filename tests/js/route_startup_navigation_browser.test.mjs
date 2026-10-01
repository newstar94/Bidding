import assert from "node:assert/strict";
import fs from "node:fs";
import http from "node:http";
import test from "node:test";
import { chromium } from "playwright";
import { withRouteFixtureNavigation } from "../../scripts/route_fixture_navigation.mjs";
import { routeFixtureCacheControl } from "../../scripts/route_fixture_policy.mjs";
import {
  installRoutePerformanceCollectors,
  waitForRoutePerformanceSnapshot,
} from "../../scripts/route_performance_collectors.mjs";

test("same-origin document-only interception preserves native warm asset cache and long tasks", {
  timeout: 20000,
}, async () => {
  const files = new Map([
    ["/dist/assets/fixture-abcdefgh.css", {
      type: "text/css",
      body: '@font-face{font-family:"FixtureFont";src:url("/dist/assets/fixture-abcdefgh.woff2") format("woff2");font-display:swap}body{font-family:"FixtureFont",sans-serif}',
    }],
    ["/dist/assets/fixture-abcdefgh.js", {
      type: "text/javascript",
      body: 'setTimeout(()=>{performance.mark("controlled-start");const end=performance.now()+125;while(performance.now()<end){}performance.mark("controlled-end");document.body.classList.add("landing-ready")},0);',
    }],
    ["/dist/assets/fixture-abcdefgh.woff2", {
      type: "font/woff2",
      body: fs.readFileSync(new URL("../../views/vendor/fonts/plus-jakarta-sans-latin.woff2", import.meta.url)),
    }],
  ]);
  const counts = new Map();
  const headers = {
    "content-type": "text/html; charset=utf-8",
    "content-security-policy": "default-src 'self'; script-src 'self'; style-src 'self'; font-src 'self'",
  };
  const html = '<!doctype html><html lang="vi"><head>'
    + '<link rel="modulepreload" href="/dist/assets/fixture-abcdefgh.js">'
    + '<link rel="preload" href="/dist/assets/fixture-abcdefgh.woff2" as="font" type="font/woff2" crossorigin>'
    + '<link rel="stylesheet" href="/dist/assets/fixture-abcdefgh.css">'
    + '</head><body>Native cached font and controlled startup task'
    + '<script type="module" src="/dist/assets/fixture-abcdefgh.js"></script></body></html>';
  const server = http.createServer((request, response) => {
    const pathname = new URL(request.url, "http://127.0.0.1").pathname;
    counts.set(pathname, (counts.get(pathname) || 0) + 1);
    const file = files.get(pathname);
    if (!file) {
      response.writeHead(404).end();
      return;
    }
    response.writeHead(200, {
      "content-type": file.type,
      "cache-control": routeFixtureCacheControl(request.url, 200),
    });
    response.end(file.body);
  });
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  let browser;
  try {
    // No security-disabling flags or Playwright request routing.
    browser = await chromium.launch({ headless: true });
    const context = await browser.newContext();
    await context.addInitScript(installRoutePerformanceCollectors);
    const page = await context.newPage();
    const url = `http://127.0.0.1:${server.address().port}/`;
    const measure = async ({ pausedRequests }) => {
      await page.waitForFunction(() => document.body.classList.contains("landing-ready"));
      const snapshot = await page.evaluate(waitForRoutePerformanceSnapshot);
      const state = await page.evaluate(async () => {
        await document.fonts.ready;
        return {
          origin: location.origin,
          secureContext: isSecureContext,
          fontLoaded: document.fonts.check('16px "FixtureFont"'),
          marks: Object.fromEntries(performance.getEntriesByType("mark")
            .map((entry) => [entry.name, entry.startTime])),
          resources: performance.getEntriesByType("resource").map((entry) => ({
            path: new URL(entry.name).pathname,
            transferSize: entry.transferSize,
            decodedBodySize: entry.decodedBodySize,
          })),
        };
      });
      assert.deepEqual(pausedRequests, [{ url, resourceType: "Document" }]);
      assert.equal(state.origin, new URL(url).origin);
      assert.equal(state.secureContext, true);
      assert.equal(state.fontLoaded, true);
      const start = state.marks["controlled-start"];
      const end = state.marks["controlled-end"];
      assert.ok(end - start >= 120);
      assert.equal(snapshot.longTasks.filter((entry) => entry.duration > 100
        && entry.startTime <= start + 2
        && entry.startTime + entry.duration >= end - 2).length, 1);
      return state.resources;
    };
    await withRouteFixtureNavigation(page, { url, html, headers }, measure);
    const coldCounts = new Map(counts);
    for (const pathname of files.keys()) assert.equal(coldCounts.get(pathname), 1);
    assert.equal(counts.get("/"), undefined, "only the document must be fulfilled, not fetched");
    const warmResources = await withRouteFixtureNavigation(page, { url, html, headers }, measure);
    for (const pathname of files.keys()) {
      assert.equal(counts.get(pathname), coldCounts.get(pathname), "warm native cache avoids server requests");
      const resource = warmResources.find((entry) => entry.path === pathname);
      assert.ok(resource, `warm resource timing must include ${pathname}`);
      assert.ok(resource.decodedBodySize > 0, "cached resource must have a real body");
      assert.equal(resource.transferSize, 0, "warm cached resource must not transfer bytes");
    }
  } finally {
    await browser?.close();
    await new Promise((resolve) => server.close(resolve));
  }
});
