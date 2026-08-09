import assert from "node:assert/strict";
import test from "node:test";

import {
  checkJsCriticalCoverage,
  parseJsCoverageTable,
} from "../../scripts/check_js_critical_coverage.mjs";

const report = `
ℹ frontend                         |        |          |         |
ℹ  app                             |        |          |         |
ℹ   BiddingModel.js                |  68.29 |    68.89 |   72.26 |
ℹ  shared                          |        |          |         |
ℹ   trustedTypes.js                |  69.61 |    58.57 |   60.87 |
ℹ all files                        |  46.38 |    61.93 |   62.14 |
`;


test("JS coverage parser reconstructs nested frontend module paths", () => {
  assert.deepEqual(parseJsCoverageTable(report), {
    "frontend/app/BiddingModel.js": { line: 68.29, branch: 68.89, functions: 72.26 },
    "frontend/shared/trustedTypes.js": { line: 69.61, branch: 58.57, functions: 60.87 },
  });
});


test("critical JS coverage gate reports missing and below-floor modules", () => {
  const errors = checkJsCriticalCoverage(report, {
    "frontend/app/BiddingModel.js": { line: 70, branch: 65, functions: 70 },
    "frontend/app/BrowserDB.js": { line: 70, branch: 55, functions: 75 },
  });

  assert.deepEqual(errors, [
    "frontend/app/BiddingModel.js: line 68.29% < 70.00%",
    "frontend/app/BrowserDB.js: missing from coverage report",
  ]);
});
