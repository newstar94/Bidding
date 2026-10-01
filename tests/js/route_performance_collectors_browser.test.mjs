import assert from "node:assert/strict";
import test from "node:test";
import { chromium } from "playwright";
import {
  installRoutePerformanceCollectors,
  waitForRoutePerformanceSnapshot,
} from "../../scripts/route_performance_collectors.mjs";

const taskDocument = (durationMs = 0) => (
  '<!doctype html><html><head><meta name="viewport" content="width=device-width,initial-scale=1">'
  + '</head><body><div>Collector regression fixture</div><script>'
  + 'setTimeout(() => {'
  + 'performance.mark("controlled-task-start");'
  + `const deadline = performance.now() + ${durationMs};`
  + 'while (performance.now() < deadline) {}'
  + 'performance.mark("controlled-task-end");'
  + 'document.body.classList.add("landing-ready");'
  + '}, 0);</script></body></html>'
);

async function measureFixture(page, durationMs) {
  // Keep the real harness's navigation and readiness protocol, including
  // document.open/write/close inside Playwright's setContent implementation.
  await page.goto("about:blank");
  await page.setContent(taskDocument(durationMs), { waitUntil: "domcontentloaded" });
  await page.waitForFunction(() => document.body.classList.contains("landing-ready"));
  const snapshot = await page.evaluate(waitForRoutePerformanceSnapshot);
  const marks = await page.evaluate(() => Object.fromEntries(
    performance.getEntriesByType("mark").map((entry) => [entry.name, entry.startTime]),
  ));
  return { ...snapshot, marks };
}

function assertControlledTaskDetected(snapshot) {
  const start = snapshot.marks["controlled-task-start"];
  const end = snapshot.marks["controlled-task-end"];
  assert.ok(end - start >= 120, "the fixture must actually execute its >100 ms task");
  const matching = snapshot.longTasks.filter((entry) => (
    entry.duration > 100
    && entry.startTime <= start + 2
    && entry.startTime + entry.duration >= end - 2
  ));
  assert.equal(matching.length, 1, "the controlled task must be measured exactly once");
  assert.equal(snapshot.observerStatus.longtask.installed, true);
  assert.equal(snapshot.observerStatus["long-animation-frame"].installed, true);
}

test("route collectors detect >100 ms tasks across cold and warm setContent lifecycles", {
  timeout: 20000,
}, async () => {
  const browser = await chromium.launch({ headless: true });
  try {
    const context = await browser.newContext();
    await context.addInitScript(installRoutePerformanceCollectors);
    const page = await context.newPage();
    assertControlledTaskDetected(await measureFixture(page, 125));
    assertControlledTaskDetected(await measureFixture(page, 165));
    const clean = await measureFixture(page, 0);
    assert.equal(
      clean.longTasks.filter((entry) => entry.duration > 100).length,
      0,
      "a warm navigation must not inherit prior controlled tasks",
    );
  } finally {
    await browser.close();
  }
});
