import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import {
  formatTimelineDate,
  normalizeTimelineDate,
  timelineDateBinding
} from "../../frontend/packages/PackageTimelineView.js";

test("timeline uses searchable plan and package dropdowns without a duplicate search field", async () => {
  const [markup, source, biddingViewSource] = await Promise.all([
    readFile(new URL("../../views/tabs/tab_goithau_timeline.html", import.meta.url), "utf8"),
    readFile(new URL("../../frontend/packages/PackageTimelineView.js", import.meta.url), "utf8"),
    readFile(new URL("../../frontend/app/BiddingView.js", import.meta.url), "utf8")
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
  assert.match(source, /if \(!planId\) \{[^}]*renderPackageOptions\(view, \[\], ""\)/s);
  assert.match(source, /state\.plan = await fetchPlan\(view, pkg\.keHoachId\) \|\| findPlan\(view, pkg\)/);
  assert.match(markup, /id="timeline-table" data-no-sort="true"/);
  assert.match(biddingViewSource, /if \(table\.dataset\.noSort === "true"\) return/);
  assert.doesNotMatch(markup, /sort-icon-btn|data-sort-order/);
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
