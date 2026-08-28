import assert from "node:assert/strict";
import fs from "node:fs";
import test from "node:test";

const FEATURE_FILES = [
  "frontend/auth/AuthFlowController.js",
  "frontend/auth/GoogleAuthController.js",
  "frontend/auth/WorkspaceSwitcherController.js",
  "frontend/admin/AdminUserController.js",
  "frontend/admin/SystemUserView.js",
  "frontend/shared/FormSubTables.js",
  "frontend/plans/KeHoachWorkflow.js",
  "frontend/plans/KeHoachView.js",
  "frontend/partners/ChuDauTuComponent.js",
  "frontend/partners/NhaThauComponent.js",
  "frontend/partners/PartnerView.js",
  "frontend/contracts/HopDongComponent.js",
];

test("feature renderers never ask Lucide to scan an unbounded document root", () => {
  const zeroRootCall = /\.createIcons(?:\?\.)?\(\s*\)/u;
  const documentRootCall = /\.createIcons(?:\?\.)?\(\s*\{\s*root\s*:\s*(?:globalThis\.|window\.)?document(?:\.(?:body|documentElement))?\s*\}\s*\)/u;

  for (const filename of FEATURE_FILES) {
    const source = fs.readFileSync(filename, "utf8");
    assert.doesNotMatch(source, zeroRootCall, `${filename} contains a zero-root Lucide scan`);
    assert.doesNotMatch(source, documentRootCall, `${filename} contains a document-sized Lucide scan`);
  }
});
