import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import {
  clearTimelineSelection,
  formatTimelineDate,
  normalizeTimelineDate,
  readTimelineSelection,
  resetTimelineSession,
  saveTimelineSelection,
  timelineDateBinding
} from "../../frontend/packages/PackageTimelineView.js";
import { resetTimelineOnNavigation } from "../../frontend/app/BiddingControllerUI.js";

function workspaceSessionStorage(initial = null) {
  let value = initial;
  return {
    readJson: (_key, fallback) => value ?? fallback,
    writeJson: (_key, nextValue) => { value = nextValue; },
    removeItem: () => { value = null; }
  };
}

test("timeline uses searchable plan and package dropdowns without a duplicate search field", async () => {
  const [markup, source, biddingViewSource, styles] = await Promise.all([
    readFile(new URL("../../views/tabs/tab_goithau_timeline.html", import.meta.url), "utf8"),
    readFile(new URL("../../frontend/packages/PackageTimelineView.js", import.meta.url), "utf8"),
    readFile(new URL("../../frontend/app/BiddingView.js", import.meta.url), "utf8"),
    readFile(new URL("../../views/css/views.css", import.meta.url), "utf8")
  ]);

  assert.doesNotMatch(markup, /timeline-package-search/);
  assert.doesNotMatch(markup, /timeline-stats|timeline-stat-/);
  assert.doesNotMatch(markup, /timeline-only-missing|timeline-only-overdue|timeline-check/);
  assert.match(markup, /id="timeline-plan-select"[^>]*><option value="">Chọn kế hoạch<\/option>/);
  assert.match(markup, /id="timeline-package-select" disabled><option value="">Chọn kế hoạch trước<\/option>/);
  assert.match(source, /import \{ makeSearchableSelect \} from "\.\.\/shared\/PartnerHelpers\.js"/);
  assert.doesNotMatch(source, /view\.makeSearchableSelect/);
  assert.match(source, /makeTimelineSelectSearchable\(select, "Tìm kế hoạch theo mã hoặc tên"\)/);
  assert.match(source, /const searchPlaceholder = hasPlan \? "Tìm gói thầu theo mã hoặc tên" : "Chọn kế hoạch trước"/);
  assert.match(source, /makeTimelineSelectSearchable\(select, searchPlaceholder\)/);
  assert.match(source, /loadPackageOptions\(view, state\.packageQuery\)/);
  assert.match(source, /readTimelineSelection\(this\.model\)/);
  assert.match(source, /restoreTimelineSelection\(this, selection\)/);
  assert.match(source, /workspaceToken/);
  assert.match(source, /if \(!planId\) \{[^}]*renderPackageOptions\(view, \[\], ""\)/s);
  assert.match(source, /state\.plan = await fetchPlan\(view, pkg\.keHoachId\) \|\| findPlan\(view, pkg\)/);
  assert.match(markup, /id="timeline-table" data-no-sort="true"/);
  assert.match(biddingViewSource, /if \(table\.dataset\.noSort === "true"\) return/);
  assert.doesNotMatch(markup, /sort-icon-btn|data-sort-order/);
  assert.match(styles, /\.timeline-table \.timeline-group-row th\[colspan\] \{[^}]*text-align: left !important;/s);
});

test("timeline displays one Flatpickr time column while preserving planned and actual dates", async () => {
  const [markup, source] = await Promise.all([
    readFile(new URL("../../views/tabs/tab_goithau_timeline.html", import.meta.url), "utf8"),
    readFile(new URL("../../frontend/packages/PackageTimelineView.js", import.meta.url), "utf8")
  ]);

  assert.match(markup, /<th scope="col">Thời gian<\/th>/);
  assert.doesNotMatch(markup, /<th scope="col">Ngày dự kiến<\/th>|<th scope="col">Ngày thực tế<\/th>/);
  assert.match(source, /class="flatpickr-date" data-timeline-field="\$\{dateBinding\.field\}"/);
  assert.match(source, /view\.initFlatpickr\(tbody\)/);
  assert.match(source, /timelineDisplayCode\(row, state\.rows\)/);
  assert.doesNotMatch(markup, /<th scope="col">Ghi chú<\/th>/);
  assert.doesNotMatch(source, /data-timeline-field="ghiChu"/);
  assert.match(source, /colspan="6"/);
  assert.match(source, /colspan="7" class="timeline-no-results"/);

  assert.deepEqual(timelineDateBinding({ ngayDuKien: "2026-07-20", ngayThucTe: "", trangThai: "PENDING" }), {
    field: "ngayDuKien",
    value: "2026-07-20",
    label: "Thời gian dự kiến"
  });
  assert.deepEqual(timelineDateBinding({ ngayDuKien: "2026-07-20", ngayThucTe: "2026-07-21", trangThai: "DONE" }), {
    field: "ngayThucTe",
    value: "2026-07-21",
    label: "Thời gian thực tế"
  });
  assert.equal(timelineDateBinding({ ngayDuKien: "2026-07-20", ngayThucTe: "", trangThai: "DONE" }).field, "ngayThucTe");
  assert.equal(formatTimelineDate("2026-07-20"), "20/07/2026");
  assert.equal(normalizeTimelineDate("20/07/2026"), "2026-07-20");
  assert.equal(normalizeTimelineDate("2026-07-20"), "2026-07-20");
  assert.equal(normalizeTimelineDate("31/02/2026"), null);
});

test("timeline selection survives refresh inside the active workspace", () => {
  const storage = workspaceSessionStorage();
  const model = { workspaceSessionStorage: storage };

  assert.equal(saveTimelineSelection(model, {
    planId: "plan-01",
    packageId: "package-version-02"
  }), true);
  assert.deepEqual(readTimelineSelection(model), {
    planId: "plan-01",
    packageId: "package-version-02"
  });

  clearTimelineSelection(model);
  assert.equal(readTimelineSelection(model), null);
});

test("timeline ignores incomplete persisted selections", () => {
  const model = {
    workspaceSessionStorage: workspaceSessionStorage({
      planId: "plan-01",
      packageId: ""
    })
  };

  assert.equal(readTimelineSelection(model), null);
  assert.equal(saveTimelineSelection(model, { planId: "plan-01" }), false);
});

test("leaving timeline clears its in-memory and refresh selection state", () => {
  const storage = workspaceSessionStorage();
  const view = {
    model: { workspaceSessionStorage: storage },
    _packageTimelineState: {
      package: { id: "package-01" },
      plan: { id: "plan-01" },
      rows: [{ maMoc: "1.1" }],
      packageOptions: [{ id: "package-01" }],
      packageQuery: "package",
      filters: { status: "DONE" },
      dirty: true,
      loading: true,
      restoreAttempted: false,
      restoringSelection: true,
      selectionRequestVersion: 2,
      optionsRequestVersion: 4
    }
  };
  saveTimelineSelection(view.model, { planId: "plan-01", packageId: "package-01" });

  const state = resetTimelineSession(view);

  assert.equal(readTimelineSelection(view.model), null);
  assert.equal(state.package, null);
  assert.equal(state.plan, null);
  assert.deepEqual(state.rows, []);
  assert.deepEqual(state.packageOptions, []);
  assert.equal(state.restoreAttempted, true);
  assert.equal(state.selectionRequestVersion, 3);
  assert.equal(state.optionsRequestVersion, 5);
});

test("navigation resets timeline only when moving to another menu", () => {
  let resetCount = 0;
  const controller = {
    model: { state: { activetab: "goithau-timeline" } },
    view: { resetPackageTimeline: () => { resetCount += 1; } }
  };

  assert.equal(resetTimelineOnNavigation(controller, "dashboard"), true);
  assert.equal(resetCount, 1);
  assert.equal(resetTimelineOnNavigation(controller, "goithau-timeline"), false);
  assert.equal(resetCount, 1);
});
