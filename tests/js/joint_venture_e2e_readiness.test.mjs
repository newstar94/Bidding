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
  // The lot scope must settle against visible controls and rows, not against
  // an implementation-private controller cache.
  assert.match(source, /#danhgiahsdt-clear-all-lots:visible/);
  assert.match(source, /await target\.check\(\)/);
  assert.match(source, /checkedLotIds\.length === 1/);
  assert.match(source, /rows\.every\(\(row\) => row\.textContent\?\.includes\(expectedLotCode\)\)/);
  assert.match(source, /page\.waitForFunction\(evaluationControlsBarrier/);
  assert.doesNotMatch(source, /__bfE2eController|getAppController/);
  assert.match(source, /qualified: \["#qualified-so-bctd"\]/);
  assert.match(source, /await saveEvaluationAndWait\(page, httpErrors, pageErrors\);\s+await activateWorkflowTab\(page, "qualified"\);/);
  assert.match(source, /function initialJointVentureEvaluationBarrier/);
  assert.match(source, /await waitForInitialJointVentureEvaluation\(page\);\s+await page\.locator\("#btn-danhgiahsdt-save"\)\.click\(\)/);
  assert.match(source, /function twoEnvelopeTechnicalEvaluationBarrier/);
  assert.match(source, /await waitForTwoEnvelopeTechnicalEvaluation\(page\);\s+await saveEvaluationAndWait\(page, httpErrors, pageErrors\)/);
  assert.match(source, /page\.locator\("#btn-danhgiahsdt-save:visible"\)\.click\(\)/);
  assert.doesNotMatch(source, /readinessDeadline|activeButton\.click\(\)|waitForTimeout/);
  assert.match(source, /automaticRanking\.filter\(\{ hasText: "Xếp hạng" \}\)/);
});
