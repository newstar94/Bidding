import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import test from "node:test";
import { parse } from "espree";

const scriptsRoot = path.resolve("scripts");
const canonicalE2eScripts = fs.readdirSync(scriptsRoot)
  .filter((name) => (
    /^verify_.+e2e\.mjs$/.test(name)
      || name === "verify_full_lifecycle.mjs"
  ))
  .sort();

function walkSyntax(node, visit) {
  if (!node || typeof node !== "object") return;
  visit(node);
  for (const value of Object.values(node)) {
    if (Array.isArray(value)) value.forEach((item) => walkSyntax(item, visit));
    else if (value?.type) walkSyntax(value, visit);
  }
}

function hasDomClickInsideEvaluate(source) {
  const syntax = parse(source, { ecmaVersion: "latest", sourceType: "module" });
  let violation = false;
  walkSyntax(syntax, (node) => {
    const property = node?.callee?.property;
    if (
      node.type !== "CallExpression"
      || node.callee?.type !== "MemberExpression"
      || (property?.name || property?.value) !== "evaluate"
    ) return;
    const callback = node.arguments?.[0];
    walkSyntax(callback, (child) => {
      const childProperty = child?.callee?.property;
      if (
        child.type === "CallExpression"
        && child.callee?.type === "MemberExpression"
        && (childProperty?.name || childProperty?.value) === "click"
      ) violation = true;
    });
  });
  return violation;
}


test("canonical E2E harnesses use actionability and condition barriers", () => {
  const violations = [];
  for (const name of canonicalE2eScripts) {
    const source = fs.readFileSync(path.join(scriptsRoot, name), "utf8");
    if (/\.waitForTimeout\s*\(/.test(source)) violations.push(`${name}: waitForTimeout`);
    if (hasDomClickInsideEvaluate(source)) {
      violations.push(`${name}: DOM click through evaluate`);
    }
  }
  assert.deepEqual(violations, []);
});

test("canonical E2E auth barriers tolerate an overlay detached during navigation", () => {
  const violations = [];
  for (const name of canonicalE2eScripts) {
    const source = fs.readFileSync(path.join(scriptsRoot, name), "utf8");
    if (/getComputedStyle\(document\.getElementById\("auth-overlay"\)\)\.display\s*===\s*"none"/u.test(source)) {
      violations.push(`${name}: detached auth overlay can throw`);
    }
  }
  assert.deepEqual(violations, []);
});


test("canonical E2E harnesses derive calendar values from the test clock", () => {
  const violations = [];
  for (const name of canonicalE2eScripts) {
    const source = fs.readFileSync(path.join(scriptsRoot, name), "utf8")
      .replace(/\\u[0-9a-f]{4}/gi, "");
    if (/(?<!\d)(?:19|20)\d{2}(?!\d)/.test(source)) {
      violations.push(`${name}: raw calendar year`);
    }
  }
  assert.deepEqual(violations, []);
});

test("isolated E2E runs use the deterministic contractor-risk fixture from CI", () => {
  const source = fs.readFileSync(
    path.join(scriptsRoot, "run_isolated_audit_e2e.ps1"),
    "utf8",
  );
  assert.match(
    source,
    /VNEPS_VIOLATION_FIXTURE_PATH\s*=\s*"tests\/fixtures\/vneps_contractor_violations\.json"/u,
  );
});

test("isolated E2E runs scope browser origins to their selected local port", () => {
  const source = fs.readFileSync(
    path.join(scriptsRoot, "run_isolated_audit_e2e.ps1"),
    "utf8",
  );
  assert.match(source, /\$env:CSRF_TRUSTED_ORIGINS\s*=\s*\$baseUrl/u);
  assert.match(source, /\$env:CORS_ORIGINS\s*=\s*\$baseUrl/u);
  assert.match(source, /\$env:ALLOWED_WS_ORIGINS\s*=\s*\$baseUrl/u);
  assert.match(source, /\$testUrl\s*=\s*\[string\]\$env:TEST_DATABASE_URL/u);
});

test("isolated browser E2E exercises the secure production asset path", () => {
  const source = fs.readFileSync(
    path.join(scriptsRoot, "run_isolated_audit_e2e.ps1"),
    "utf8",
  );
  assert.match(source, /\$env:APP_DEBUG\s*=\s*"false"/u);
  assert.doesNotMatch(
    source,
    /\$env:APP_DEBUG\s*=\s*if\s*\(\$Suite\s+-eq\s+"performance"/u,
  );
});


test("plan approval E2E selections use the stable stored value, not its display label", () => {
  for (const name of [
    "verify_crud_modules_e2e.mjs",
    "verify_full_lifecycle.mjs",
  ]) {
    const source = fs.readFileSync(path.join(scriptsRoot, name), "utf8");
    assert.match(
      source,
      /#kh-pheduyet", \{ value: "Dự toán và kế hoạch" \}/u,
      name,
    );
    assert.doesNotMatch(
      source,
      /#kh-pheduyet", \{ label: "Dự toán và kế hoạch" \}/u,
      name,
    );
  }
});

test("lifecycle E2E creates portable Excel fixtures when paths are not configured", () => {
  const source = fs.readFileSync(
    path.join(scriptsRoot, "verify_full_lifecycle.mjs"),
    "utf8",
  );
  assert.match(source, /function createLifecycleExcelFixtures\(/u);
  assert.match(source, /Generated CI Excel fixtures/u);
  assert.match(source, /rmSync\(generatedExcelFixtures\.directory/u);
  assert.doesNotMatch(source, /OneDrive/u);
});

test("lifecycle E2E does not accumulate Windows headless GPU state", () => {
  const source = fs.readFileSync(
    path.join(scriptsRoot, "verify_full_lifecycle.mjs"),
    "utf8",
  );

  assert.match(
    source,
    /args: \[[\s\S]*"--disable-gpu"[\s\S]*"--no-proxy-server"[\s\S]*\]/u,
  );
  assert.doesNotMatch(source, /"--disable-software-rasterizer"/u);
  assert.doesNotMatch(source, /"--disable-gpu-compositing"/u);
  assert.doesNotMatch(source, /"--in-process-gpu"/u);
});

test("lifecycle E2E does not inherit an intercepting host proxy", () => {
  const source = fs.readFileSync(
    path.join(scriptsRoot, "verify_full_lifecycle.mjs"),
    "utf8",
  );

  assert.match(source, /"--no-proxy-server"/u);
});

test("lifecycle E2E renews Chromium cleanly between persisted workflow phases", () => {
  const source = fs.readFileSync(
    path.join(scriptsRoot, "verify_full_lifecycle.mjs"),
    "utf8",
  );

  assert.match(source, /async function renewBrowserSession\(/u);
  assert.match(
    source,
    /createBrowserSessionManager[\s\S]*restartPreservingStorage/u,
  );
  assert.match(source, /async function restartBrowserSession[\s\S]*await renewBrowserSession\(\)/u);
  assert.match(
    source,
    /mark\("supplied-excel-goods-imported"[\s\S]*await restartBrowserSession\(\)/u,
  );
  for (const boundary of [
    "award-persisted",
    "contract-persisted",
    "two-envelope-technical-evaluation-saved",
    "two-envelope-award-approved",
    "lot-second-batch-approved",
  ]) {
    assert.match(
      source,
      new RegExp(`mark\\("${boundary}"[\\s\\S]*?await restartBrowserSession\\(\\)`, "u"),
    );
  }
  assert.match(
    source,
    /suffix: "GT-CANCEL"[\s\S]*await restartBrowserSession\(\);[\s\S]*suffix: "GT-EXCEL-1I"/u,
  );
  assert.match(
    source,
    /suffix: "GT-EXCEL-1I"[\s\S]*?await restartBrowserSession\(\);[\s\S]*?suffix: "GT-EXCEL-MI"/u,
  );
  assert.match(source, /serviceWorkers: "block"/u);
  assert.match(source, /nextPage\.setDefaultNavigationTimeout\(20_000\)/u);
});

test("lifecycle lot approval waits for the persisted finalization and rendered state", () => {
  for (const name of [
    "verify_full_lifecycle.mjs",
    "verify_joint_venture_e2e.mjs",
  ]) {
    const source = fs.readFileSync(path.join(scriptsRoot, name), "utf8");
    assert.match(
      source,
      /const roundsBefore = await page\.locator\("\.evaluation-round-card"\)\.count\(\)/u,
      name,
    );
    assert.match(source, /finalizeLotAndWaitForRender\(\{/u, name);
    assert.match(source, /expectedPackageStatus: "PARTIALLY_COMPLETED"/u, name);
    assert.match(source, /expectedPackageStatus: "COMPLETED"/u, name);
  }
});

test("lifecycle E2E waits for visible-content enhancement before rerendering invitation", () => {
  const source = fs.readFileSync(
    path.join(scriptsRoot, "verify_full_lifecycle.mjs"),
    "utf8",
  );

  assert.match(source, /const waitForVisibleContentEnhancements = async/u);
  assert.match(
    source,
    /page\.waitForFunction\(predicate, argument, \{ polling: 100, \.\.\.options \}\)/u,
  );
  assert.match(source, /const waitForVisibleRowText = async/u);
  assert.match(
    source,
    /#chuyengia-table tbody tr", `Chuyên gia \$\{ordinal\} \$\{runId\}`/u,
  );
  assert.match(
    source,
    /mark\("cancellable-opening-action-visible"\);[\s\S]*await waitForVisibleContentEnhancements\(page\);[\s\S]*#btn-luu-thongtinmoithau/u,
  );
  assert.match(
    source,
    /#btn-luu-thongtinmoithau"\)\.click\(\{ force: true, noWaitAfter: true \}\)/u,
  );
  assert.match(
    source,
    /#btn-them-giahan"\)\.press\("Enter", \{ noWaitAfter: true \}\)/u,
  );
  assert.doesNotMatch(
    source,
    /#btn-continue-lot-evaluation"\)\.click\(\{ force: true, noWaitAfter: true \}\)/u,
  );
  assert.doesNotMatch(source, /LifecycleDiagnosticMutationObserver/u);
  assert.match(
    source,
    /const submitModal = async[\s\S]*button\[type='submit'\][\s\S]*force: true,[\s\S]*noWaitAfter: true/u,
  );
});

test("lifecycle E2E fills only editable visible package-lot rows", () => {
  const source = fs.readFileSync(
    path.join(scriptsRoot, "verify_full_lifecycle.mjs"),
    "utf8",
  );
  assert.match(
    source,
    /#phanlo-tbody tr:has\(\.pl-code-input\)/u,
  );
  assert.match(source, /if \(!await row\.isVisible\(\)\) continue;/u);
  assert.doesNotMatch(source, /#phanlo-tbody tr:not\(\[hidden\]\)/u);
});

test("lifecycle E2E waits for the two-envelope evaluation row before editing", () => {
  const source = fs.readFileSync(
    path.join(scriptsRoot, "verify_full_lifecycle.mjs"),
    "utf8",
  );
  assert.match(
    source,
    /const technicalEvaluationRow[\s\S]*technicalEvaluationRow\.waitFor\(\{ state: "visible", timeout: 20_000 \}\)[\s\S]*#danhgiahsdt-table-tbody \.mt-dg-hop-le/u,
  );
  assert.match(
    source,
    /ensureSelectedValue\(page, "#danhgiahsdt-table-tbody \.mt-dg-hop-le", "Đạt"\)/u,
  );
  assert.match(
    source,
    /data-workflow-tab="qualified"[\s\S]*waitForRenderedWorkflowTab\(page, "qualified"\)[\s\S]*qualified-so-bctd/u,
  );
});

test("lifecycle E2E waits for opening acknowledgement before package cancellation", () => {
  const source = fs.readFileSync(
    path.join(scriptsRoot, "verify_full_lifecycle.mjs"),
    "utf8",
  );
  assert.match(
    source,
    /const cancelOpeningRow[\s\S]*#btn-mothau-save[\s\S]*data-workflow-tab="eval_tech"[\s\S]*#btn-workflow-cancel-package/u,
  );
  assert.match(
    source,
    /#btn-luu-thongtinmoithau"\)\.press\("Enter", \{ noWaitAfter: true \}\)[\s\S]*savedExtensionReason\.waitFor/u,
  );
  assert.match(
    source,
    /#btn-save-cancel-details"\)\.click\(\{ force: true, noWaitAfter: true \}\)[\s\S]*dialogTitle === "Thành công"[\s\S]*#cancel-dec-no\[disabled\]/u,
  );
  assert.match(
    source,
    /await cancelOpeningSync;[\s\S]*?await restartBrowserSession\(\);[\s\S]*?openPackageWorkflow\(cancellablePackage, "opening"\)/u,
  );
});

test("production E2E harnesses do not import development source modules", () => {
  const harnesses = [
    "verify_bidder_goods_e2e.cjs",
    "verify_joint_venture_e2e.mjs",
    "verify_low_price_conflict_e2e.mjs",
    "verify_offline_sync_e2e.mjs",
  ].map((name) => path.join(scriptsRoot, name));
  harnesses.push(...fs.readdirSync(path.resolve("e2e/specs"))
    .filter((name) => name.endsWith(".spec.mjs"))
    .map((name) => path.resolve("e2e/specs", name)));
  for (const harness of harnesses) {
    const source = fs.readFileSync(harness, "utf8");
    assert.doesNotMatch(source, /import\(["']\/frontend\//u, harness);
  }
});

test("joint-venture E2E exports Word through explicit publication assignments", () => {
  const source = fs.readFileSync(
    path.join(scriptsRoot, "verify_joint_venture_e2e.mjs"),
    "utf8",
  );
  assert.doesNotMatch(source, /#btn-export-docx-report/u);
  assert.match(source, /\/api\/word-publication-template-assignments/u);
  assert.match(source, /award_result_appraisal_report/u);
  assert.match(source, /\/xuat-ban-word/u);
});

test("fixture-backed specs use the current package and inline procurement flows", () => {
  const contractorSource = fs.readFileSync(
    path.resolve("e2e/specs/contractor-violation.spec.mjs"),
    "utf8",
  );
  assert.match(contractorSource, /data-bf-action=\\?"show-package/u);
  assert.doesNotMatch(contractorSource, /\?evaluationPackage=/u);

  const procurementSource = fs.readFileSync(
    path.resolve("e2e/specs/procurement-plan-import.spec.mjs"),
    "utf8",
  );
  assert.match(procurementSource, /#procurement-lookup-plan-enabled/u);
  assert.doesNotMatch(procurementSource, /#btn-open-procurement-import/u);
});
