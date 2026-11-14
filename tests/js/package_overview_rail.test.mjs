import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

import {
  assigneeInitials,
  bidConclusionTone,
  buildPackageMilestones,
  packageEvaluationReport,
  parseMilestoneDate,
  renderPackageBiddersCard,
  renderPackageOverviewRail,
  renderPackageProgressStepper,
} from "../../frontend/packages/detail/PackageOverviewRail.js";

const NOW = new Date(2026, 10, 13, 10, 0);

function basePackage(overrides = {}) {
  return {
    id: "gt-1",
    hinhThucLuaChon: "Đấu thầu rộng rãi",
    phuongThucLuaChon: "Một giai đoạn một túi hồ sơ",
    trangThai: "Đã mở thầu",
    ngayQuyetDinh: "2026-10-12",
    soQuyetDinh: "312/QĐ",
    thoiGianDangTai: "2026-10-15T08:00",
    thoiGianDongThau: "04/11/2026 09:00",
    thoiGianMoThau: "2026-11-04T09:30",
    ...overrides,
  };
}

const states = (milestones) => Object.fromEntries(milestones.map((item) => [item.key, item.state]));

test("milestone dates parse Vietnamese and ISO forms as local time only", () => {
  assert.deepEqual(parseMilestoneDate("04/11/2026 09:00"), new Date(2026, 10, 4, 9, 0));
  assert.deepEqual(parseMilestoneDate("2026-10-02"), new Date(2026, 9, 2));
  assert.equal(parseMilestoneDate("31/02/2026"), null);
  assert.equal(parseMilestoneDate("không rõ"), null);
  assert.equal(parseMilestoneDate(""), null);
});

test("progress runs from plan approval to result approval and has no contract step", () => {
  const milestones = buildPackageMilestones({
    pkg: basePackage(),
    approvals: [{ approvalDate: "2026-10-02", decisionNumber: "245/QĐ" }],
    now: NOW,
  });
  assert.deepEqual(milestones.map((item) => item.key), [
    "plan", "hsmt", "posting", "closing", "opening", "evaluation", "result",
  ]);
  assert.deepEqual(milestones.map((item) => item.state), [
    "done", "done", "done", "done", "done", "next", "pending",
  ]);
  assert.equal(milestones[0].detail, "QĐ 245/QĐ");
});

test("evaluation step shows an ongoing evaluation for packages being evaluated", () => {
  const evaluation = buildPackageMilestones({ pkg: basePackage(), status: "Đang chấm thầu", now: NOW })
    .find((item) => item.key === "evaluation");
  assert.equal(evaluation.state, "next");
  assert.equal(evaluation.activeLabel, "Đang đánh giá");
});

test("a recorded evaluation report completes the evaluation step", () => {
  const pkg = basePackage({
    trangThai: "Đang chấm thầu",
    danhGiaHsdtMetadata: JSON.stringify({ technical: { soBaoCao: "BC-01", ngayBaoCao: "2026-11-10" } }),
  });
  assert.deepEqual(packageEvaluationReport(pkg), { exists: true, date: "2026-11-10", number: "BC-01" });
  const milestones = buildPackageMilestones({ pkg, status: "Đang chấm thầu", now: NOW });
  const byKey = states(milestones);
  assert.equal(byKey.evaluation, "done");
  assert.equal(byKey.result, "next");
  assert.equal(milestones.find((item) => item.key === "evaluation").detail, "BC BC-01");
  assert.deepEqual(packageEvaluationReport(basePackage({ danhGiaHsdtMetadata: "not json" })), { exists: false, date: "", number: "" });
});

test("a published result completes evaluation and result even without recorded dates", () => {
  const byKey = states(buildPackageMilestones({ pkg: basePackage(), status: "Đã có kết quả", now: NOW }));
  assert.equal(byKey.evaluation, "done");
  assert.equal(byKey.result, "done");
  const partial = buildPackageMilestones({ pkg: basePackage(), status: "Đã có kết quả một phần", now: NOW })
    .find((item) => item.key === "result");
  assert.equal(partial.state, "next");
  assert.equal(partial.activeLabel, "Có kết quả một phần");
});

test("a missing early date does not become next once later steps are done", () => {
  const byKey = states(buildPackageMilestones({ pkg: basePackage({ ngayQuyetDinh: "" }), now: NOW }));
  assert.equal(byKey.plan, "pending");
  assert.equal(byKey.hsmt, "pending");
  assert.equal(byKey.evaluation, "next");
});

test("future dates stay upcoming and only the first open step is highlighted", () => {
  const milestones = buildPackageMilestones({
    pkg: basePackage({ thoiGianDongThau: "2026-11-20T09:00", thoiGianMoThau: "2026-11-20T09:30" }),
    status: "Đang mời thầu",
    now: NOW,
  });
  assert.equal(milestones.filter((item) => item.state === "next").length, 1);
  assert.equal(milestones.find((item) => item.state === "next").key, "closing");
});

test("forms without public posting skip posting, closing and opening steps", () => {
  const keys = buildPackageMilestones({
    pkg: basePackage({ hinhThucLuaChon: "Chỉ định thầu rút gọn" }),
    now: NOW,
  }).map((item) => item.key);
  assert.deepEqual(keys, ["plan", "hsmt", "evaluation", "result"]);
});

test("two-envelope packages show both opening steps", () => {
  const labels = buildPackageMilestones({
    pkg: basePackage({ phuongThucLuaChon: "Một giai đoạn hai túi hồ sơ", thoiGianMoEhsdxtc: "2026-11-25T09:00" }),
    now: NOW,
  }).map((item) => item.label);
  assert.ok(labels.includes("Mở E-HSĐXKT"));
  assert.ok(labels.includes("Mở E-HSĐXTC"));
});

test("cancelled packages never highlight a next step", () => {
  const milestones = buildPackageMilestones({ pkg: basePackage(), status: "Hủy thầu", now: NOW });
  assert.equal(milestones.some((item) => item.state === "next"), false);
});

test("horizontal stepper counts finished steps, labels the current step and escapes text", () => {
  const milestones = buildPackageMilestones({ pkg: basePackage(), status: "Đang chấm thầu", now: NOW });
  const html = renderPackageProgressStepper({ milestones, formatDate: (value) => `<${value}>` });
  assert.match(html, /4\/7 bước đã xong/u);
  assert.match(html, /class="package-stepper"/u);
  assert.match(html, /data-state="next"[\s\S]*Đánh giá E-HSDT[\s\S]*Đang đánh giá/u);
  assert.match(html, /&lt;2026-10-12&gt;/u);
  assert.doesNotMatch(html, /Ký hợp đồng/u);
  assert.match(html, /data-bf-action="switch-tab" data-tab="goithau-timeline"/u);
  assert.match(renderPackageProgressStepper({ milestones, cancelled: true }), /Gói thầu đã hủy/u);
  assert.equal(renderPackageProgressStepper({ milestones: [] }), "");
});

test("overview rail shows assignees and offers documents only when the step exists", () => {
  const html = renderPackageOverviewRail({ assignees: ["<b>Nguyễn Minh Anh</b>"], hasDocumentsTab: false });
  assert.match(html, /&lt;b&gt;Nguyễn Minh Anh&lt;\/b&gt;/u);
  assert.doesNotMatch(html, /data-package-open-tab/u);
  assert.doesNotMatch(html, /Tiến độ gói thầu/u);
  assert.match(renderPackageOverviewRail({ hasDocumentsTab: true }), /data-package-open-tab="documents"/u);
  assert.match(renderPackageOverviewRail(), /Chưa phân công/u);
});

test("assignee initials follow the last two Vietnamese name parts", () => {
  assert.equal(assigneeInitials("Nguyễn Minh Anh"), "MA");
  assert.equal(assigneeInitials("lan"), "L");
  assert.equal(assigneeInitials(""), "?");
});

test("bidder card shows recorded conclusions without inventing results", () => {
  assert.equal(bidConclusionTone("Đạt"), "success");
  assert.equal(bidConclusionTone("Không đạt"), "danger");
  assert.equal(bidConclusionTone("Bị loại"), "danger");
  assert.equal(bidConclusionTone(""), "neutral");
  assert.equal(renderPackageBiddersCard({ bids: [] }), "");
  const html = renderPackageBiddersCard({
    model: { state: {} },
    bids: [{ tenNhaThau: "Cty <A>", giaDuThau: 1000, danhGiaKetLuan: "" }],
    formatCurrency: (value) => `${value} ₫`,
  });
  assert.match(html, /Cty &lt;A&gt;/u);
  assert.match(html, /1000 ₫/u);
  assert.match(html, /badge-neutral">Chưa đánh giá/u);
});

test("package detail template keeps chrome hooks, a progress slot and the back action beside the title", async () => {
  const [template, actions] = await Promise.all([
    readFile(new URL("../../views/tabs/tab_goithau_detail.html", import.meta.url), "utf8"),
    readFile(new URL("../../frontend/packages/detail/WorkflowActions.js", import.meta.url), "utf8"),
  ]);
  for (const id of [
    "detail-workflow-card", "detail-workflow-title", "detail-workflow-status-badge",
    "detail-workflow-code", "detail-workflow-version-select", "detail-workflow-progress",
    "detail-workflow-actions", "detail-workflow-tabs-header", "detail-workflow-content-wrapper",
  ]) {
    assert.match(template, new RegExp(`id="${id}"`, "u"), id);
  }
  assert.doesNotMatch(template, /id="detail-workflow-meta"/u);
  const titleRow = template.slice(template.indexOf("package-detail-title-row"), template.indexOf("package-detail-meta"));
  assert.match(titleRow, /id="detail-workflow-title"[\s\S]*id="detail-workflow-status-badge"/u);
  assert.match(template, /class="package-detail-back" data-bf-action="switch-tab" data-tab="goithau"/u);
  assert.doesNotMatch(actions, /Quay lại danh sách/u);
});
