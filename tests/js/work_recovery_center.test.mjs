import test from "node:test";
import assert from "node:assert/strict";
import { summarizeLocalRecovery } from "../../frontend/app/WorkRecoveryCenter.js";
import { derivePackageNextStepGuide } from "../../frontend/packages/PackageNextStepGuide.js";
import { renderPackageSummary } from "../../frontend/packages/detail/PackageSummary.js";

test("recovery center summarizes pending outbox and conflict references without replaying them", () => {
  const model = {
    getMutationQueue: () => ({
      upserts: { goithau: { one: {}, two: {} } },
      patches: { kehoach: { plan: {} } },
      deletes: [{ table: "hopdong", id: "contract" }],
    }),
    getConflictRecoveryDrafts: () => [{ id: "draft-1" }],
    getMutationOutboxStatus: () => ({ state: "degraded", recoverable: true }),
  };
  const result = summarizeLocalRecovery(model);
  assert.equal(result.pending, 4);
  assert.equal(result.drafts.length, 1);
  assert.equal(result.outboxStatus.state, "degraded");
});

test("package next step guide distinguishes missing display data from current workflow status", () => {
  const result = derivePackageNextStepGuide({ trangThai: "Đang chấm thầu" });
  assert.equal(result.status, "Đang chấm thầu");
  assert.equal(result.targetTab, "eval_tech");
  assert.deepEqual(result.missing, ["Thời gian đóng thầu", "Thời gian mở thầu"]);
  assert.match(result.assessment, /Chưa đủ dữ liệu/);
});

test("package next step guide links to an existing workflow tab", () => {
  const html = renderPackageSummary({
    pkg: { trangThai: "Đang chấm thầu" },
    planName: "Kế hoạch",
    investorName: "Chủ đầu tư",
    formatCurrency: () => "0",
    formatDateTime: () => "--",
  });
  assert.match(html, /data-bf-action="switch-package-tab"/);
  assert.match(html, /data-tab="eval_tech"/);
});
