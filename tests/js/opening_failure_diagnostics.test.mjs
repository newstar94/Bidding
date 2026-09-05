import assert from "node:assert/strict";
import test from "node:test";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { reportOpeningFailure } from "../../scripts/lib/openingFailureDiagnostics.mjs";

test("opening failure preserves the original timeout and records dialog and traffic", async () => {
  const directory = await mkdtemp(join(tmpdir(), "opening-diagnostics-"));
  const cause = new Error("locator.waitFor: Timeout 15000ms exceeded");
  const state = { dialog: { title: "Trạng thái đã thay đổi" }, packages: [{ status: "Chuẩn bị" }] };
  let disposed = false;
  let screenshotOptions;
  try {
    await assert.rejects(reportOpeningFailure({
      directory, runId: "test", packageName: "Gói 1G2T", error: cause,
      recentApiTraffic: ["<-200 GET /api/record"],
      page: {
        async waitForFunction(_fn, name, options) {
          assert.equal(name, "Gói 1G2T");
          assert.equal(options.timeout, 5000);
          return { async jsonValue() { return state; }, async dispose() { disposed = true; } };
        },
        async screenshot(options) { screenshotOptions = options; },
      },
    }), (error) => error.cause === cause && error.message.includes("Trạng thái đã thay đổi"));
    assert.equal(disposed, true);
    assert.equal(screenshotOptions.timeout, 5000);
    const saved = JSON.parse(await readFile(join(directory, "test-opening.json"), "utf8"));
    assert.deepEqual(saved.state, state);
    assert.deepEqual(saved.recentApiTraffic, ["<-200 GET /api/record"]);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

test("an unresponsive renderer or failed screenshot cannot hide the original failure", async () => {
  const directory = await mkdtemp(join(tmpdir(), "opening-diagnostics-"));
  const cause = new Error("opening timeout");
  try {
    await assert.rejects(reportOpeningFailure({
      directory, runId: "test", error: cause,
      page: {
        async waitForFunction() { throw new Error("renderer unavailable"); },
        async screenshot() { throw new Error("screenshot unavailable"); },
      },
    }), (error) => error.cause === cause
      && error.message.includes("renderer unavailable")
      && error.message.includes("screenshot unavailable"));
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});
