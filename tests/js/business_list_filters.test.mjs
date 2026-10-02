import assert from "node:assert/strict";
import test from "node:test";

import {
  BUSINESS_LIST_FILTER_FIELDS,
  businessListDate,
  businessListFilterField,
  businessListFilterOperators,
  getBusinessListFilters,
  matchesBusinessListFilterConditions,
  matchesBusinessListFilters,
  normalizeBusinessListFilters,
  setBusinessListFilters,
} from "../../frontend/shared/BusinessListFilters.js";

const condition = (field, operator, value) => ({ field, operator, value });
const matches = (type, record, conditions, model = {}) => matchesBusinessListFilterConditions(model, type, record, conditions);

function workspaceModel() {
  return {
    state: { activeuser: { id: "user-1" }, activerole: "manager", assignments: [] },
    workspaceScope: { key: "user-1:org-1", organizationId: "org-1" },
    getWorkspaceToken() { return this.workspaceScope.key; },
  };
}

test("typed fields keep actual record names and disallow unsupported comparisons", () => {
  assert.deepEqual(Object.keys(BUSINESS_LIST_FILTER_FIELDS), ["kehoach", "goithau", "hopdong"]);
  assert.equal(businessListFilterField("kehoach", "maDuan").kind, "text");
  assert.equal(businessListFilterField("goithau", "giaTrungThau").kind, "money");
  assert.equal(businessListFilterField("hopdong", "soNgayThucHien").kind, "text");
  assert.ok(businessListFilterOperators(businessListFilterField("goithau", "thoiGianDongThau")).includes("month"));
  assert.ok(!businessListFilterOperators(businessListFilterField("hopdong", "goiThauIds")).includes("contains"));
});

test("multiple fields use AND and selected values within each field use OR", () => {
  const filters = [
    condition("tenGoiThau", "contains", "máy"),
    condition("linhVuc", "in", ["Hàng hóa", "Hỗn hợp"]),
    condition("giaGoiThau", "range", { min: "100", max: "200" }),
    condition("isThuoc", "equals", "0"),
  ];
  const record = { tenGoiThau: "Máy xét nghiệm", linhVuc: "Hỗn hợp", giaGoiThau: "150", isThuoc: 0 };
  assert.equal(matches("goithau", record, filters), true);
  assert.equal(matches("goithau", { ...record, linhVuc: "Xây lắp" }, filters), false);
  assert.equal(matches("goithau", { ...record, giaGoiThau: "201" }, filters), false);
  assert.equal(matches("goithau", { ...record, isThuoc: 1 }, filters), false);
});

test("empty conditions are ignored and zero remains a meaningful value", () => {
  const filters = normalizeBusinessListFilters("goithau", [
    condition("tenGoiThau", "contains", "  "),
    condition("trangThai", "in", []),
    condition("ngayQuyetDinh", "year", ["", null]),
    condition("giaGoiThau", "range", { min: "", max: null }),
    condition("isThuoc", "in", ["0", "0", ""]),
    condition("giaTrungThau", "range", { min: "0", max: "0" }),
  ]);
  assert.deepEqual(filters, [
    condition("isThuoc", "in", ["0"]),
    condition("giaTrungThau", "range", { min: "0", max: "0" }),
  ]);
  assert.equal(matches("goithau", { isThuoc: 0, giaTrungThau: "0" }, filters), true);
  assert.equal(matches("goithau", { isThuoc: 0, giaTrungThau: null }, filters), false);
});

test("large decimal-string amounts compare exactly beyond JavaScript safe integers", () => {
  const filters = [condition("giaTri", "range", { min: "9007199254740993", max: "9007199254740993" })];
  assert.equal(matches("hopdong", { giaTri: "9007199254740993" }, filters), true);
  assert.equal(matches("hopdong", { giaTri: "9007199254740992" }, filters), false);
  assert.equal(matches("hopdong", { giaTri: "9007199254740994" }, filters), false);
  assert.equal(matches("hopdong", { giaTri: "9223372036854775807" }, [condition("giaTri", "equals", "9223372036854775807")]), true);
  assert.deepEqual(normalizeBusinessListFilters("hopdong", [condition("giaTri", "in", ["0001", "1", "0"])]), [condition("giaTri", "in", ["1", "0"])]);
});

test("an already rounded unsafe numeric record cannot match an exact amount", () => {
  assert.equal(matches("hopdong", { giaTri: Number("9007199254740993") }, [condition("giaTri", "equals", "9007199254740992")]), false);
  assert.equal(matches("hopdong", { giaTri: 200 }, [condition("giaTri", "equals", "200")]), true);
});

test("date ranges include both endpoints and support an open boundary", () => {
  const filters = [condition("ngayKy", "range", { min: "2026-10-01", max: "2026-10-02" })];
  assert.equal(matches("hopdong", { ngayKy: "2026-10-01" }, filters), true);
  assert.equal(matches("hopdong", { ngayKy: "2026-10-02" }, filters), true);
  assert.equal(matches("hopdong", { ngayKy: "2026-10-03" }, filters), false);
  assert.equal(matches("hopdong", { ngayKy: null }, filters), false);
  assert.equal(matches("hopdong", { ngayKy: "2027-01-01" }, [condition("ngayKy", "range", { min: "2026-10-01", max: "" })]), true);
});

test("multiple years and months compose on the same date without losing OR semantics", () => {
  const filters = [condition("ngayPheDuyet", "year", ["2025", "2026"]), condition("ngayPheDuyet", "month", ["1", "9"])];
  assert.equal(matches("kehoach", { ngayPheDuyet: "2025-09-30" }, filters), true);
  assert.equal(matches("kehoach", { ngayPheDuyet: "2026-01-01" }, filters), true);
  assert.equal(matches("kehoach", { ngayPheDuyet: "30/09/2026" }, filters), true);
  assert.equal(matches("kehoach", { ngayPheDuyet: "2026-10-01" }, filters), false);
  assert.equal(matches("kehoach", { ngayPheDuyet: "2027-09-01" }, filters), false);
  assert.deepEqual(normalizeBusinessListFilters("kehoach", [condition("ngayPheDuyet", "month", "09")]), [condition("ngayPheDuyet", "month", ["9"])]);
});

test("timestamps match Vietnam calendar dates across UTC midnight", () => {
  assert.equal(businessListDate("2026-10-01T17:00:00Z", true), "2026-10-02");
  assert.equal(businessListDate("2026-10-02T00:00:00+07:00", true), "2026-10-02");
  assert.equal(businessListDate("2026-10-02 00:00:00", true), "2026-10-02");
  const filters = [condition("thoiGianDongThau", "range", { min: "2026-10-02", max: "2026-10-02" })];
  assert.equal(matches("goithau", { thoiGianDongThau: "2026-10-01T17:00:00Z" }, filters), true);
  assert.equal(matches("goithau", { thoiGianDongThau: "2026-10-01T16:59:59Z" }, filters), false);
  assert.equal(matches("goithau", { thoiGianDongThau: "2026-10-02T17:00:00Z" }, filters), false);
  assert.equal(matches("goithau", { thoiGianDongThau: "2026-12-31T18:00:00Z" }, [condition("thoiGianDongThau", "year", ["2027"]), condition("thoiGianDongThau", "month", ["1"])]), true);
});

test("date validation rejects nonexistent dates and unsupported year zero", () => {
  assert.equal(businessListDate("2026-02-29"), "");
  assert.equal(businessListDate("2024-02-29"), "2024-02-29");
  assert.equal(businessListDate("0000-01-01"), "");
  assert.throws(() => normalizeBusinessListFilters("hopdong", [condition("ngayKy", "equals", "0000-01-01")]));
});

test("text filters ignore case, preserve Vietnamese accents and treat SQL wildcards literally", () => {
  const record = { tenKeHoach: "ĐƯỜNG 100%_A\\' OR 1=1 --" };
  assert.equal(matches("kehoach", record, [condition("tenKeHoach", "contains", "đường 100%_a\\'")]), true);
  assert.equal(matches("kehoach", record, [condition("tenKeHoach", "contains", "duong")]), false);
  assert.equal(matches("kehoach", { tenKeHoach: "100xxA" }, [condition("tenKeHoach", "contains", "100%_A")]), false);
  assert.equal(matches("kehoach", record, [condition("tenKeHoach", "not_contains", "duong")]), true);
  assert.equal(matches("kehoach", { tenKeHoach: "Đường" }, [condition("tenKeHoach", "equals", "đƯỜNG")]), true);
  assert.equal(matches("kehoach", { tenKeHoach: "Đường" }, [condition("tenKeHoach", "in", ["Máy", "đường"])]), true);
  assert.equal(matches("kehoach", { tenKeHoach: null }, [condition("tenKeHoach", "not_contains", "đường")]), true);
});

test("reference filters compare actual IDs with OR in a contract package relation", () => {
  const record = { chuDauTuId: "inv-a", goiThauIds: ["pkg-b", "pkg-c"] };
  assert.equal(matches("hopdong", record, [condition("chuDauTuId", "equals", "inv-a"), condition("goiThauIds", "in", ["pkg-a", "pkg-c"])]), true);
  assert.equal(matches("hopdong", record, [condition("goiThauIds", "in", ["pkg-z"])]), false);
  assert.equal(matches("hopdong", record, [condition("goiThauIds", "equals", "pkg-b")] ), true);
});

test("assignees refer to exact target snapshots and target types", () => {
  const model = { state: { assignments: [
    { targetId: "contract-new", type: "hopdong", empId: "user-a" },
    { targetId: "contract-old", type: "hopdong", empId: "user-b" },
    { targetId: "contract-new", type: "goithau", empId: "user-c" },
  ] } };
  const record = { id: "contract-new", rootId: "contract-old" };
  assert.equal(matches("hopdong", record, [condition("assigneeId", "in", ["user-a", "user-z"])], model), true);
  assert.equal(matches("hopdong", record, [condition("assigneeId", "equals", "user-b")], model), false);
  assert.equal(matches("hopdong", record, [condition("assigneeId", "equals", "user-c")], model), false);
});

test("an explicit foreign-tenant assignment cannot satisfy an assignee filter", () => {
  const model = workspaceModel();
  model.state.assignments = [{ organizationId: "org-2", targetId: "contract-a", type: "hopdong", empId: "user-a" }];
  assert.equal(matches("hopdong", { id: "contract-a", organizationId: "org-1" }, [condition("assigneeId", "equals", "user-a")], model), false);
});

test("package status filters use the existing official metadata resolver", () => {
  const record = { id: "pkg-a", trangThai: "OPENED", phanLo: "Không", danhGiaHsdtMetadata: { result: { saved: true } } };
  assert.equal(matches("goithau", record, [condition("trangThai", "in", ["Đã có kết quả"])]), true);
  assert.equal(matches("goithau", record, [condition("trangThai", "in", ["Đã mở thầu"])]), false);
  assert.equal(matches("goithau", { ...record, danhGiaHsdtMetadata: { resultEdit: { type: "whole" } } }, [condition("trangThai", "equals", "Đang chấm thầu")]), true);
  assert.equal(matches("goithau", { ...record, trangThai: "CANCELLED" }, [condition("trangThai", "equals", "Hủy thầu")]), true);
});

test("package status codes and existing plan enum aliases match canonical display values", () => {
  assert.equal(matches("goithau", { trangThai: "AWARDED" }, [condition("trangThai", "equals", "AWARDED")]), true);
  assert.equal(matches("goithau", { trangThai: "CANCELLED" }, [condition("trangThai", "in", ["Huỷ thầu"])]), true);
  assert.equal(matches("kehoach", { pheDuyet: "Kế hoạch" }, [condition("pheDuyet", "equals", "ke hoach")]), true);
  assert.equal(matches("kehoach", { pheDuyet: "Dự toán và kế hoạch" }, [condition("pheDuyet", "in", ["DU TOAN VA KE HOACH"])]), true);
});

test("user-defined contract status names and free-form duration remain exact business data", () => {
  const record = { trangThaiHopDong: "Đang nghiệm thu theo đơn vị", soNgayThucHien: "12 tháng, chia 2 đợt" };
  assert.equal(matches("hopdong", record, [condition("trangThaiHopDong", "in", ["Đang nghiệm thu theo đơn vị"]), condition("soNgayThucHien", "contains", "2 đợt")]), true);
  assert.equal(matches("hopdong", record, [condition("trangThaiHopDong", "equals", "ACTIVE")]), false);
});

test("invalid field/operator/value combinations fail before matching", () => {
  const cases = [
    condition("organizationId", "equals", "org-1"),
    condition("tenGoiThau; DROP TABLE", "contains", ""),
    condition("tenGoiThau", "contains", 1),
    condition("tenGoiThau", "contains", "x".repeat(513)),
    condition("tenGoiThau", "in", "x"),
    condition("tenGoiThau", "in", [null, {}]),
    condition("keHoachId", "contains", "plan"),
    condition("giaGoiThau", "range", { min: "20", max: "10" }),
    condition("giaGoiThau", "range", { min: "1", sql: "DROP TABLE" }),
    condition("giaGoiThau", "range", { min: 1 }),
    condition("giaGoiThau", "equals", "-1"),
    condition("giaGoiThau", "equals", "1.5"),
    condition("giaGoiThau", "equals", "NaN"),
    condition("giaGoiThau", "equals", "9223372036854775808"),
    condition("ngayQuyetDinh", "year", ["2026", "9999"]),
    condition("ngayQuyetDinh", "month", ["9", "13"]),
    condition("ngayQuyetDinh", "equals", "2026-02-29"),
    condition("isThuoc", "equals", "true"),
  ];
  for (const invalid of cases) assert.throws(() => normalizeBusinessListFilters("goithau", [invalid]), JSON.stringify(invalid));
  assert.throws(() => normalizeBusinessListFilters("unknown", []));
  assert.throws(() => normalizeBusinessListFilters("goithau", {}));
  assert.throws(() => normalizeBusinessListFilters("goithau", [null]));
});

test("condition count, value count and UTF-8 payload remain bounded", () => {
  assert.throws(() => normalizeBusinessListFilters("goithau", Array.from({ length: 25 }, () => condition("tenGoiThau", "contains", "x"))));
  assert.throws(() => normalizeBusinessListFilters("goithau", [condition("tenGoiThau", "in", Array.from({ length: 101 }, () => "x"))]));
  assert.throws(() => normalizeBusinessListFilters("goithau", Array.from({ length: 12 }, () => condition("tenGoiThau", "contains", "ế".repeat(512)))));
});

test("stored filters are isolated by list and cannot be modified through returned objects", () => {
  const model = workspaceModel();
  const original = [condition("tenKeHoach", "contains", "Máy")];
  const stored = setBusinessListFilters(model, "kehoach", original);
  original[0].value = "changed input";
  stored[0].value = "changed return";
  assert.deepEqual(getBusinessListFilters(model, "kehoach"), [condition("tenKeHoach", "contains", "Máy")]);
  assert.deepEqual(getBusinessListFilters(model, "goithau"), []);
  assert.deepEqual(getBusinessListFilters(model, "hopdong"), []);
  assert.equal(matchesBusinessListFilters(model, "kehoach", { tenKeHoach: "Máy xét nghiệm" }), true);
  assert.equal(matchesBusinessListFilters(model, "kehoach", { tenKeHoach: "Đường" }), false);
  model.state.activerole = "employee";
  assert.deepEqual(getBusinessListFilters(model, "kehoach"), []);
});
