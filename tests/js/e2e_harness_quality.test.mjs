import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import test from "node:test";
import { parse } from "espree";

const scriptsRoot = path.resolve("scripts");

test("multi-assignee polling revocation gives both editors one full polling cycle", () => {
  const source = fs.readFileSync(
    path.join(scriptsRoot, "verify_multi_assignee_activity_e2e.mjs"),
    "utf8",
  );
  assert.equal(
    source.match(/timeout: pollingRevocation \? 50_000 : 20_000/gu)?.length,
    2,
  );
  assert.match(source, /transport: pollingRevocation \? "polling" : "websocket"/u);
  assert.match(source, /droppedRevocationHints, transferStartedAt/u);
});

test("held conflict request response wait starts after the competing commit and before release", () => {
  const source = fs.readFileSync("e2e/specs/row-conflict-reload.spec.mjs", "utf8");
  const competingCommit = source.indexOf("const clientBResponse = await clientBResponsePromise;");
  const responseWait = source.indexOf("const conflictResponsePromise = pageA.waitForResponse");
  const release = source.indexOf("releaseClientARequest();", responseWait);
  const response = source.indexOf("const conflictResponse = await conflictResponsePromise;", release);
  assert.ok(competingCommit >= 0 && responseWait > competingCommit);
  assert.ok(release > responseWait && response > release);
});
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

test("lifecycle contract edits wait for canonical form identity", () => {
  const source = fs.readFileSync(
    path.join(scriptsRoot, "verify_full_lifecycle.mjs"),
    "utf8",
  );

  assert.match(source, /const expectedContractId = await editButton\.getAttribute\("data-id"\)/u);
  assert.match(
    source,
    /form-hopdong-id"\)\?\.value === contractId[\s\S]*modal-hopdong-title/u,
  );
});

test("lifecycle E2E does not inherit an intercepting host proxy", () => {
  const source = fs.readFileSync(
    path.join(scriptsRoot, "verify_full_lifecycle.mjs"),
    "utf8",
  );

  assert.match(source, /"--no-proxy-server"/u);
});

test("joint-venture E2E does not inherit an intercepting host proxy", () => {
  const source = fs.readFileSync(
    path.join(scriptsRoot, "verify_joint_venture_e2e.mjs"),
    "utf8",
  );

  assert.match(source, /args: \["--no-proxy-server"\]/u);
});

test("joint-venture two-envelope row setup is bounded and checks progress", () => {
  const source = fs.readFileSync(
    path.join(scriptsRoot, "verify_joint_venture_e2e.mjs"),
    "utf8",
  );

  assert.match(source, /async function ensureOpeningRowCount\(/u);
  assert.match(source, /Opening row count did not advance/u);
  assert.doesNotMatch(
    source,
    /while \(await twoEnvelopeRows\.count\(\) < 2\)/u,
  );
});

test("joint-venture low-price prompt asserts semantic dialog state", () => {
  const source = fs.readFileSync(
    path.join(scriptsRoot, "verify_joint_venture_e2e.mjs"),
    "utf8",
  );

  assert.match(source, /async function assertActiveDialog\(/u);
  assert.match(
    source,
    /await initialSaveButton\.click\(\);[\s\S]*await assertActiveDialog\(page, "Mandatory low-price prompt"\)/u,
  );
});

test("CRUD E2E isolates loopback traffic and Windows headless GPU state", () => {
  const source = fs.readFileSync(
    path.join(scriptsRoot, "verify_crud_modules_e2e.mjs"),
    "utf8",
  );

  assert.match(
    source,
    /args: \["--disable-gpu", "--no-proxy-server"\]/u,
  );
  assert.match(source, /page\.setDefaultTimeout\(20_000\)/u);
});

test("low-price conflict E2E isolates loopback traffic from the host proxy", () => {
  const source = fs.readFileSync(
    path.join(scriptsRoot, "verify_low_price_conflict_e2e.mjs"),
    "utf8",
  );

  assert.match(source, /args: \["--no-proxy-server"\]/u);
});

test("low-price conflict E2E waits for the authoritative offline transition before editing", () => {
  const source = fs.readFileSync(
    path.join(scriptsRoot, "verify_low_price_conflict_e2e.mjs"),
    "utf8",
  );

  assert.match(
    source,
    /setOffline\(true\)[\s\S]*#offline-indicator-banner\.visible[\s\S]*for \(const \[selector, value\] of Object\.entries\(changes\)\)/u,
  );
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
  assert.match(
    source,
    /mark\("contract-created"\);\s*await restartBrowserSession\(\);\s*await gotoReady\(page, `\$\{baseURL\}\/hop-dong`\);\s*await waitForInitialReconciliation\(page\);\s*const advanceContractStatus/u,
  );
  assert.equal(
    source.match(/await gotoReady\(page, `\$\{baseURL\}\/hop-dong`\);\s*await waitForInitialReconciliation\(page\);/gu)?.length,
    2,
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
  assert.match(source, /connect: \(\) => chromium\.launch\(launchOptions\)/u);
  assert.doesNotMatch(source, /chromium\.launchServer|wsEndpoint\(\)/u);
});

test("lifecycle E2E uses a per-run organization and always removes its fixture", () => {
  const source = fs.readFileSync(
    path.join(scriptsRoot, "verify_full_lifecycle.mjs"),
    "utf8",
  );
  const fixtureSource = fs.readFileSync(
    path.join(scriptsRoot, "lifecycle_e2e_fixture.py"),
    "utf8",
  );

  assert.match(source, /const organizationId = `__\$\{runId\.toLowerCase\(\)\}-org`/u);
  assert.match(source, /lifecycleFixture\("setup"\)[\s\S]*finally[\s\S]*lifecycleFixture\("cleanup"\)/u);
  assert.match(fixtureSource, /membership_role = str\(data\.get\("membershipRole", "manager"\)\)/u);
  assert.match(fixtureSource, /account\["id"\], organization_id, membership_role, account\["name"\]/u);
  assert.match(fixtureSource, /WHERE organization_id = %s/u);
});

test("lifecycle contract diagnostics cannot hang on an unresponsive renderer", () => {
  const source = fs.readFileSync(
    path.join(scriptsRoot, "verify_full_lifecycle.mjs"),
    "utf8",
  );

  assert.match(
    source,
    /const readPageDiagnosticState[\s\S]*waitForFunction\(reader, argument, \{ timeout: 5_000 \}\)[\s\S]*Contract status modal did not close/u,
  );
  assert.match(
    source,
    /Contract status did not converge[\s\S]*rendererUnresponsive/u,
  );
});

test("lifecycle contract selection dispatches against the current rendered contractor control", () => {
  const source = fs.readFileSync(
    path.join(scriptsRoot, "verify_full_lifecycle.mjs"),
    "utf8",
  );

  assert.match(
    source,
    /const selectCurrentOptionByLabel[\s\S]*control\.dispatchEvent\(new Event\("input"[\s\S]*control\.dispatchEvent\(new Event\("change"/u,
  );
  assert.match(
    source,
    /selectCurrentOptionByLabel\(page, "#hd-nhathauid", `Nhà thầu \$\{runId\}`\)/u,
  );
});

test("lifecycle loader diagnostics cannot hang on an unresponsive renderer", () => {
  const source = fs.readFileSync(
    path.join(scriptsRoot, "verify_full_lifecycle.mjs"),
    "utf8",
  );

  assert.match(
    source,
    /Application loader did not settle[\s\S]*clientDiagnostics/u,
  );
  assert.match(
    source,
    /const diagnostics = await readPageDiagnosticState\(page, \(\) => \{[\s\S]*recentResources/u,
  );
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
    assert.match(source, /approve: (?:async )?\(\) =>/u, name);
    assert.match(source, /expectedPackageStatus: "PARTIALLY_COMPLETED"/u, name);
    assert.match(source, /expectedPackageStatus: "COMPLETED"/u, name);
  }
  const lifecycleSource = fs.readFileSync(
    path.join(scriptsRoot, "verify_full_lifecycle.mjs"),
    "utf8",
  );
  assert.match(
    lifecycleSource,
    /const activeLotPackageId = await page\.locator\("#detail-workflow-content-wrapper"\)[\s\S]*\.getAttribute\("data-rendered-package-id"\)[\s\S]*packageId: activeLotPackageId/u,
  );
  assert.doesNotMatch(lifecycleSource, /packageId: lotPackage\.id/u);
  assert.match(
    lifecycleSource,
    /const approveCurrentLot[\s\S]*await waitForAwardApprovalInputs\(page, expectedInputs\)[\s\S]*approve: async \(\) => \{[\s\S]*dispatchCurrentAwardApproval\(page, expectedInputs\)/u,
  );
  assert.match(
    lifecycleSource,
    /const waitForAwardApprovalInputs[\s\S]*typeof submit\?\.onclick === "function"[\s\S]*Award approval inputs did not stabilize/u,
  );
  assert.match(
    lifecycleSource,
    /const dispatchCurrentAwardApproval[\s\S]*submit\.dispatchEvent\(new MouseEvent\("click"[\s\S]*approve: async \(\) => \{[\s\S]*await waitForAwardApprovalInputs\(page, expectedInputs\)[\s\S]*await dispatchCurrentAwardApproval\(page, expectedInputs\)/u,
  );
  assert.match(
    lifecycleSource,
    /prepareRenderedState: async \(\) => \{[\s\S]*await restartBrowserSession\(\)[\s\S]*await openPackageWorkflow\(lotPackage, "result"\)[\s\S]*return page/u,
  );
});

test("lifecycle whole-package awards wait for semantic approval completion", () => {
  const source = fs.readFileSync(
    path.join(scriptsRoot, "verify_full_lifecycle.mjs"),
    "utf8",
  );
  assert.match(source, /const waitForAwardApprovalInputs = async/u);
  assert.match(source, /dataset\.awardApprovalState !== "pending"/u);
  assert.equal(
    source.match(/await approveAwardAndWaitForRender\(page,/gu)?.length,
    2,
  );
});

test("lifecycle evaluation completion reaches the authoritative rendered tab before award input", () => {
  const source = fs.readFileSync(
    path.join(scriptsRoot, "verify_full_lifecycle.mjs"),
    "utf8",
  );
  const completionHelper = source.match(
    /const completeBidEvaluationAndWaitForWorkflow = async[\s\S]*?\n\};\n\nconst waitForAwardApprovalInputs/u,
  )?.[0] || "";
  assert.ok(completionHelper, "evaluation completion helper must remain covered");
  assert.match(
    completionHelper,
    /const completeBidEvaluationAndWaitForWorkflow = async[\s\S]*armEvaluationSuccessFeedback\(page,[\s\S]*armCanonicalSyncEvidence\(page\)[\s\S]*waitForCanonicalSync\(page,[\s\S]*waitForEvaluationSuccessFeedback\(page,[\s\S]*waitForRenderedWorkflowTab\(page, targetTab\)/u,
  );
  assert.doesNotMatch(
    completionHelper,
    /#modal-custom-dialog\.active/u,
  );
  assert.match(
    source,
    /const evaluateCurrentLot[\s\S]*completeBidEvaluationAndWaitForWorkflow\(page, \{[\s\S]*targetTab: "result"[\s\S]*targetSelector: "#award-so-bctd"[\s\S]*const approveCurrentLot/u,
  );
});

test("lifecycle canonical response waits fail with application diagnostics", () => {
  const source = fs.readFileSync(
    path.join(scriptsRoot, "verify_full_lifecycle.mjs"),
    "utf8",
  );
  assert.match(source, /\.catch\(\(error\) => \(\{ waitError: error \}\)\)/u);
  assert.match(source, /canonical sync response was not observed/u);
  assert.match(source, /recentApiTraffic: recentApiTraffic\.slice\(-20\)/u);
  assert.match(
    source,
    /const rebidCreateSync = armCanonicalSyncEvidence\(page\)[\s\S]*Rebid package create[\s\S]*mark\("package-rebid-created"\)[\s\S]*await restartBrowserSession\(\)[\s\S]*openPackageWorkflow\(twoEnvelopePackage, "preparation_action"\)/u,
  );
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

test("cross-browser matrix authenticates on the warmed browser transport", () => {
  const source = fs.readFileSync(
    path.resolve("e2e", "specs", "browser-matrix.spec.mjs"),
    "utf8",
  );
  assert.doesNotMatch(source, /page\.context\(\)\.request\.post\("\/api\/auth\/login"/u);
  assert.match(source, /async function loginWithBrowserTransport/u);
  assert.match(source, /await fetch\("\/api\/auth\/login"/u);
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
    /completeBidEvaluationAndWaitForWorkflow\(page, \{[\s\S]*targetTab: "qualified"[\s\S]*targetSelector: "#qualified-so-bctd"/u,
  );
});

test("lifecycle package workflows wait for authoritative startup reconciliation", () => {
  const source = fs.readFileSync(
    path.join(scriptsRoot, "verify_full_lifecycle.mjs"),
    "utf8",
  );
  assert.match(
    source,
    /const openPackageWorkflow[\s\S]*?await waitForInitialReconciliation\(page\);[\s\S]*?#search-goithau/u,
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
  assert.match(
    source,
    /await lotOpeningSync;\s*await restartBrowserSession\(\);\s*await openPackageWorkflow\(lotPackage, "opening"\);\s*await page\.locator\("#btn-mothau-save"\)/u,
  );
  assert.equal(
    source.match(/#btn-mothau-save"\)\.click\(\{ noWaitAfter: true \}\)/gu)?.length,
    4,
  );
});

test("production E2E harnesses do not import development source modules", () => {
  const harnesses = [
    "verify_bidder_goods_e2e.cjs",
    "verify_joint_venture_e2e.mjs",
    "verify_low_price_conflict_e2e.mjs",
    "verify_offline_sync_e2e.mjs",
    "verify_websocket_missed_hint_e2e.mjs",
  ].map((name) => path.join(scriptsRoot, name));
  harnesses.push(...fs.readdirSync(path.resolve("e2e/specs"))
    .filter((name) => name.endsWith(".spec.mjs"))
    .map((name) => path.resolve("e2e/specs", name)));
  for (const harness of harnesses) {
    const source = fs.readFileSync(harness, "utf8");
    assert.doesNotMatch(source, /import\(["']\/frontend\//u, harness);
  }
});

test("startup rejection E2E waits for the intercepted canonical request", () => {
  const source = fs.readFileSync(
    path.resolve("e2e", "specs", "startup-sync.spec.mjs"),
    "utf8",
  );
  assert.match(
    source,
    /const rejectionStarted = new Promise[\s\S]*confirmRejectionStarted\(\)[\s\S]*await rejectionStarted[\s\S]*expect\(rejectedRecordId\)\.toBeTruthy\(\)/u,
  );
});

test("startup stale-window E2E waits for the authoritative read before route interaction", () => {
  const source = fs.readFileSync(
    path.resolve("e2e", "specs", "startup-sync.spec.mjs"),
    "utf8",
  );
  const scenario = source.match(
    /test\("startup_does_not_commit_a_stale_record_before_authoritative_reconciliation"[\s\S]*?\n\}\);/u,
  )?.[0] || "";
  assert.ok(scenario, "startup stale-window scenario must remain covered");
  assert.match(
    scenario,
    /await page\.waitForFunction\(\(\) => globalThis\.__bfStartupSyncReadGate\?\.started === true\);[\s\S]*await expect\(page\.locator\("#btn-add-chuyengia"\)\)\.toBeVisible\(\);[\s\S]*await page\.locator\("#btn-add-chuyengia"\)\.click\(\);/u,
  );
  assert.doesNotMatch(
    scenario,
    /#chuyengia-table"\)\)\.toBeVisible\(\);[\s\S]*__bfStartupSyncReadGate\?\.started/u,
  );
});

test("row-conflict browser isolation preserves cache and cleanup bypasses conflicted outbox", () => {
  const source = fs.readFileSync(
    path.resolve("e2e", "specs", "row-conflict-reload.spec.mjs"),
    "utf8",
  );
  assert.match(
    source,
    /async function isolateHostInjectedScripts\(context, \{ force = false \} = \{\}\) \{\s*const browserName = context\.browser\(\)\?\.browserType\(\)\.name\(\);\s*if \(!force && browserName !== "firefox"\) return;[\s\S]*context\.route/u,
  );
  const cleanup = source.match(
    /async function cleanupCreatedEntities[\s\S]*?\n\}\n\nasync function cleanupStaleRowConflictFixtures/u,
  )?.[0] || "";
  assert.ok(cleanup, "row-conflict cleanup helper must remain covered");
  assert.doesNotMatch(
    cleanup,
    /browser\.newContext/u,
  );
  assert.match(
    cleanup,
    /deleteSearchedEntityForCleanup\(page\.context\(\)\.request, cleanupState, target\)/u,
  );
  assert.doesNotMatch(source, /\.route\("\*\*\/api\/sync\/delta/u);
  assert.match(
    source,
    /expect\(packageIdB\)\.toBe\(latestPackage\.id\);[\s\S]*await pageA\.route\("\*\*\/api\/sync", async \(route\) => \{[\s\S]*captureClientARequest\(request\);[\s\S]*await clientARequestCaptured;[\s\S]*await pageB\.locator\("#gt-ten"\)\.fill\(packageNameB\);/u,
  );
  assert.match(
    source,
    /async function navigateWithinReadyApp\(page, targetPath\)[\s\S]*history\.pushState\(\{\}, "", path\)[\s\S]*dispatchEvent\(new PopStateEvent\("popstate"\)\)[\s\S]*#tab-\$\{tabName\}\.active/u,
  );
  assert.match(
    source,
    /currentPath !== null[\s\S]{0,120}browserName !== "firefox"[\s\S]{0,160}navigateWithinReadyApp\(page, targetPath\)/u,
  );
  assert.match(
    source,
    /if \(browserName === "firefox" && currentPath !== null\) \{\s*await page\.goto\("about:blank", \{ waitUntil: "commit" \}\);\s*\}/u,
  );
  assert.match(
    source,
    /async function reloadReady[\s\S]*browserName === "firefox"[\s\S]*about:blank[\s\S]*else \{\s*await page\.reload\(\{ waitUntil: "commit" \}\);/u,
  );
  assert.match(
    source,
    /await createReferenceFixtures\(pageA,[\s\S]{0,700}await reloadReady\(pageA\);[\s\S]{0,120}await createPlan00\(pageA,/u,
  );
  assert.match(
    source,
    /function waitForPlanSearchResponse[\s\S]*waitForResponse[\s\S]*url\.searchParams\.get\("table"\) === "kehoach"[\s\S]*async function searchPlanRow[\s\S]*await input\.fill\(planCode\)[\s\S]*expect\(response\.ok\(\)/u,
  );
  assert.match(
    source,
    /const latestPlanResponse = waitForPlanSearchResponse\(page, planCode, \{\s*expectedVersion: 1,[\s\S]*?await savePlanBreakdown\(page\);[\s\S]*?const latestListResponse = await latestPlanResponse;[\s\S]*?await gotoReady\(page, "\/ke-hoach"\);\s*const latestRow = await searchPlanRow\(page, planCode\);/u,
  );
  assert.match(
    source,
    /async function openPlanDetails[\s\S]*const expectedPlanId = await action\.getAttribute\("data-id"\)[\s\S]*await details\.inputValue\(\) === expectedPlanId[\s\S]*toHaveValue\(expectedPlanId\)/u,
  );
  assert.doesNotMatch(source, /if \(await details\.count\(\)\) return details/u);
  assert.match(
    source,
    /async function waitForApp[\s\S]*?page\.waitForFunction\([\s\S]*?undefined, \{ polling: 100 \}\);/u,
  );
  assert.match(
    source,
    /async function waitForInitialReconciliation[\s\S]*?page\.waitForFunction\([\s\S]*?undefined, \{ polling: 100 \}\);/u,
  );
});

test("lifecycle initial catalog creates await canonical receipts before session renewal", () => {
  const source = fs.readFileSync(path.join(scriptsRoot, "verify_full_lifecycle.mjs"), "utf8");
  for (const name of ["investor", "contractor", "expert"]) {
    assert.match(source, new RegExp(`const ${name}CreateSync = armCanonicalSyncEvidence\\(page\\)`));
    assert.match(source, new RegExp(`await waitForCanonicalSync\\(page, ${name}CreateSync,`));
  }
});

test("rerendering workflow E2E actions use the current converged DOM node", () => {
  const lowPriceSource = fs.readFileSync(
    path.join(scriptsRoot, "verify_low_price_conflict_e2e.mjs"),
    "utf8",
  );
  assert.match(
    lowPriceSource,
    /async function clickCurrentOpeningSave[\s\S]*renderedRenderVersion === wrapper\?\.dataset\.pendingRenderVersion[\s\S]*#btn-mothau-save[\s\S]*dispatchEvent\("click"\)/u,
  );
  assert.equal(
    lowPriceSource.match(/await clickCurrentOpeningSave\(page\)/gu)?.length,
    2,
  );

  const jointVentureSource = fs.readFileSync(
    path.join(scriptsRoot, "verify_joint_venture_e2e.mjs"),
    "utf8",
  );
  assert.match(
    jointVentureSource,
    /async function activateWorkflowTab[\s\S]*data-workflow-tab[\s\S]*dispatchEvent\("click"\)[\s\S]*aria-selected/u,
  );

  const lotScopeSource = fs.readFileSync(
    path.join(scriptsRoot, "lib", "evaluationLotScopeSynchronization.mjs"),
    "utf8",
  );
  assert.match(
    lotScopeSource,
    /async function setCurrentCheckedState[\s\S]*dispatchEvent\(new Event\("change"[\s\S]*waitForEvaluationLotScopeProjection/u,
  );
  assert.doesNotMatch(lotScopeSource, /\.check\(\)|\.uncheck\(\)/u);
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
