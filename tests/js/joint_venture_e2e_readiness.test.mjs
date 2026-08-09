import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const harnessUrl = new URL("../../scripts/verify_joint_venture_e2e.mjs", import.meta.url);

test("joint-venture relogin readiness tolerates a detached auth overlay", async () => {
  const source = await readFile(harnessUrl, "utf8");

  assert.doesNotMatch(
    source,
    /getComputedStyle\(document\.getElementById\("auth-overlay"\)\)\.display/,
  );
  assert.match(
    source,
    /page\.locator\("#auth-overlay"\)\.waitFor\(\{ state: "hidden", timeout: 20_000 \}\)/,
  );
  assert.doesNotMatch(source, /waitForFunction\(async\s*\(/);
  assert.match(source, /E2E_JV_SCENARIO/);
  assert.match(source, /page\.waitForFunction\(evaluationLotScopeBarrier/);
  assert.match(source, /page\.waitForFunction\(evaluationControlsBarrier/);
  assert.match(source, /globalThis\.__bfE2eController = getAppController\(\)/);
  assert.match(source, /page\.locator\("#btn-danhgiahsdt-save:visible"\)\.click\(\)/);
  assert.doesNotMatch(source, /readinessDeadline|activeButton\.click\(\)|waitForTimeout/);
  assert.match(source, /automaticRanking\.filter\(\{ hasText: "Xếp hạng" \}\)/);
});
