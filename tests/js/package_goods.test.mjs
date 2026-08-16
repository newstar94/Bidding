import assert from "node:assert/strict";
import test from "node:test";

import { buildPackageTabs } from "../../frontend/packages/detail/PackageTabs.js";
import { buildPackageGoodsPreview, packageGoodsHeaders, parsePackageGoodsRows } from "../../frontend/packages/PackageGoodsExcel.js";
import { clonePackageGoodsForSnapshot } from "../../frontend/packages/packageGoodsVersioning.js";
import { supportsGoodsWorkflow } from "../../frontend/packages/goodsWorkflowSupport.js";
import { isPackageGoodsDeletable, isPackageGoodsEditable } from "../../frontend/packages/packageGoodsValidation.js";
import {
  bindPackageGoodsLiveSearch,
  buildPackageGoodsDisplayRows,
  formatPackageGoodsQuantity,
  nextPackageGoodsSequence,
  packageGoodsLotComboboxConfig,
  packageGoodsPaginationPages,
  refreshPackageGoodsIcons,
  renderPackageGoodsInlineCreateRow,
  renderPackageGoodsInlineEditRow,
  renderPackageGoodsMutationActions,
  renderPackageGoodsRowActions,
  renderPackageGoodsSummary,
} from "../../frontend/packages/PackageGoodsWorkflow.js";
import { BrowserDB } from "../../frontend/app/BrowserDB.js";

const lots = [
  { id: "lot-1", maPhanLo: "PP01", tenPhanLo: "Phần 1" },
  { id: "lot-2", maPhanLo: "PP02", tenPhanLo: "Phần 2" },
];

test("imports the supplied no-lot layout and uses STT as a stable fallback code", () => {
  const pkg = { id: "package-1", linhVuc: "Hàng hóa", phanLo: "Không" };
  const rows = parsePackageGoodsRows([{
    STT: 1,
    "Danh mục hàng hóa": "Dây truyền dịch",
    "Đơn vị tính": "Cái",
    "Khối lượng mời thầu": 5569,
  }], { pkg });

  assert.equal(rows.length, 1);
  assert.equal(rows[0].maHangHoa, "1");
  assert.equal(rows[0].tenHangHoa, "Dây truyền dịch");
  assert.equal(rows[0].soLuong, 5569);
  assert.equal(rows[0].phanLoId, null);
});

test("inherits a lot heading for the supplied one-lot-many-items layout", () => {
  const pkg = { id: "package-1", linhVuc: "Hàng hóa", phanLo: "Có", phanLoList: lots };
  const rows = parsePackageGoodsRows([
    { stt: "1", maPhanLo: "PP01", tenPhanLo: "Phần 1", tenHangHoa: "", donViTinh: "", soLuong: 0 },
    { STT: "1.1", "Danh mục hàng hóa(1)": "Hóa chất CRP", "Đơn vị tính": "Hộp", "Khối lượng": 18 },
    { STT: "1.2", "Danh mục hàng hóa(1)": "Chất hiệu chuẩn", "Đơn vị tính": "Hộp", "Khối lượng": 2 },
  ], { pkg });

  assert.deepEqual(rows.map((row) => row.phanLoId), ["lot-1", "lot-1"]);
  assert.deepEqual(rows.map((row) => row.maHangHoa), ["1.1", "1.2"]);
});

test("supports one lot and one item on the same spreadsheet row", () => {
  const pkg = { id: "package-1", linhVuc: "Hàng hóa", phanLo: "Có", phanLoList: lots };
  const rows = parsePackageGoodsRows([{
    STT: "1", "Mã phần(lô)": "PP02", "Tên phần lô": "Phần 2",
    "Danh mục hàng hóa(1)": "Ống nghiệm", "Đơn vị tính": "Thùng", "Khối lượng": 40,
  }], { pkg });

  assert.equal(rows[0].phanLoId, "lot-2");
  assert.equal(rows[0].tenHangHoa, "Ống nghiệm");
});

test("preview reports all row errors and classifies create update unchanged", () => {
  const pkg = { id: "package-1", linhVuc: "Hàng hóa", phanLo: "Không", phanLoList: [] };
  const existing = [{ id: "goods-1", goiThauId: "package-1", phanLoId: null, maHangHoa: "HH01", tenHangHoa: "A", nhomHangHoa: "", donViTinh: "Cái", soLuong: 1, yeuCauKyThuat: "", kyMaHieuThamChieu: "", xuatXuYeuCau: "", diaDiemGiaoHang: "", thoiGianGiaoHang: "", donGiaDuToan: null, thanhTienDuToan: null, ghiChu: "", sortOrder: 0 }];
  const preview = buildPackageGoodsPreview([
    { ...existing[0], id: "new-1" },
    { ...existing[0], id: "new-2", maHangHoa: "HH02", tenHangHoa: "B" },
    { id: "new-3", goiThauId: "package-1", phanLoId: null, maHangHoa: "", tenHangHoa: "", donViTinh: "", soLuong: 0 },
  ], existing, { pkg });

  assert.deepEqual(preview.map((row) => row._operation), ["unchanged", "create", "invalid"]);
  assert.match(preview[2]._comment, /mã hàng hóa/i);
  assert.match(preview[2]._comment, /tên hàng hóa/i);
  assert.match(preview[2]._comment, /đơn vị tính/i);
  assert.match(preview[2]._comment, /lớn hơn 0/i);
});

test("new package snapshots receive independent goods and remapped lot ids", () => {
  const source = { id: "package-old", phanLo: "Có", phanLoList: [{ id: "lot-old", maPhanLo: "PP01" }] };
  const target = { id: "package-new", phanLo: "Có", phanLoList: [{ id: "lot-new", maPhanLo: "PP01" }] };
  const [copy] = clonePackageGoodsForSnapshot([{ id: "goods-old", goiThauId: source.id, phanLoId: "lot-old", maHangHoa: "HH01", rowVersion: 3 }], source, target);

  assert.notEqual(copy.id, "goods-old");
  assert.equal(copy.goiThauId, "package-new");
  assert.equal(copy.phanLoId, "lot-new");
  assert.equal(copy.rowVersion, undefined);
});

test("goods workflow supports trimmed goods and mixed fields only", () => {
  assert.equal(supportsGoodsWorkflow(" Hàng hóa "), true);
  assert.equal(supportsGoodsWorkflow({ linhVuc: " Hỗn hợp " }), true);
  assert.equal(supportsGoodsWorkflow("Tư vấn"), false);
  assert.equal(supportsGoodsWorkflow("Xây lắp"), false);
});

test("goods display keeps one-lot-many nested and collapses one-lot-one into one row", () => {
  const rows = [
    { id: "goods-1", phanLoId: "lot-1", maHangHoa: "HH-CRP", tenHangHoa: "Hóa chất CRP", donViTinh: "Hộp", soLuong: 18 },
    { id: "goods-2", phanLoId: "lot-1", maHangHoa: "HH-HC", tenHangHoa: "Chất hiệu chuẩn", donViTinh: "Hộp", soLuong: 2 },
    { id: "goods-3", phanLoId: "lot-2", maHangHoa: "HH-ON", tenHangHoa: "Ống nghiệm", donViTinh: "Thùng", soLuong: 40 },
  ];

  const displayRows = buildPackageGoodsDisplayRows(rows, lots, { hasLots: true });

  assert.deepEqual(displayRows.map((row) => ({
    kind: row.kind,
    sequence: row.sequence,
    lotCode: row.lotCode,
    lotName: row.lotName,
    itemId: row.item?.id,
    singleItemLot: row.singleItemLot,
  })), [
    { kind: "lot", sequence: "1", lotCode: "PP01", lotName: "Phần 1", itemId: undefined, singleItemLot: undefined },
    { kind: "item", sequence: "1.1", lotCode: undefined, lotName: undefined, itemId: "goods-1", singleItemLot: undefined },
    { kind: "item", sequence: "1.2", lotCode: undefined, lotName: undefined, itemId: "goods-2", singleItemLot: undefined },
    { kind: "item", sequence: "2", lotCode: "PP02", lotName: "Phần 2", itemId: "goods-3", singleItemLot: true },
  ]);
  assert.equal(formatPackageGoodsQuantity(18), "18");
  assert.equal(formatPackageGoodsQuantity(1_000), "1.000");
  assert.equal(formatPackageGoodsQuantity(1_234.5), "1.234,5");
  assert.equal(formatPackageGoodsQuantity(1_234.5678), "1.234,5678");
});

test("goods sequence is generated from row order instead of the editable goods code", () => {
  const displayRows = buildPackageGoodsDisplayRows([
    { id: "goods-a", maHangHoa: "HH-Z", tenHangHoa: "Hàng Z" },
    { id: "goods-b", maHangHoa: "HH-A", tenHangHoa: "Hàng A" },
  ], [], { hasLots: false });

  assert.deepEqual(displayRows.map((row) => row.sequence), ["1", "2"]);
  assert.equal(nextPackageGoodsSequence(displayRows.map((row) => row.item), [], { hasLots: false }), "3");
  assert.equal(nextPackageGoodsSequence([
    { phanLoId: "lot-1" },
    { phanLoId: "lot-1" },
    { phanLoId: "lot-2" },
  ], lots, { hasLots: true, lotId: "lot-1" }), "1.3");
});

test("package requirement template omits winning-goods-only pricing and technical columns", () => {
  const headers = packageGoodsHeaders(true);
  assert.deepEqual(headers.slice(0, 6), [
    "Mã phần lô", "Tên phần lô", "Mã hàng hóa", "Tên hàng hóa", "Đơn vị tính", "Số lượng",
  ]);
  for (const unnecessary of ["Nhóm hàng hóa", "Yêu cầu kỹ thuật", "Đơn giá dự toán", "Thành tiền dự toán"]) {
    assert.equal(headers.includes(unnecessary), false);
  }
});

test("goods tab and editing support goods and mixed procurement packages", () => {
  const preparationTabs = buildPackageTabs({ linhVuc: "Hàng hóa", trangThai: "Chuẩn bị" }).tabs;
  assert.ok(preparationTabs.some((tab) => tab.id === "goods"));
  assert.deepEqual(preparationTabs.map(({ id, icon }) => ({ id, icon })), [
    { id: "preparation", icon: "info" },
    { id: "goods", icon: "package" },
    { id: "preparation_action", icon: "send" },
    { id: "documents", icon: "folder-open" },
    { id: "activity", icon: "history" },
  ]);
  assert.ok(preparationTabs.every((tab) => Boolean(tab.icon)));
  assert.ok(buildPackageTabs({ linhVuc: " Hỗn hợp ", trangThai: "Chuẩn bị" }).tabs.some((tab) => tab.id === "goods"));
  assert.ok(!buildPackageTabs({ linhVuc: "Tư vấn", trangThai: "Chuẩn bị" }).tabs.some((tab) => tab.id === "goods"));
  assert.ok(!buildPackageTabs({ linhVuc: "Xây lắp", trangThai: "Chuẩn bị" }).tabs.some((tab) => tab.id === "goods"));
  assert.equal(isPackageGoodsEditable({ linhVuc: "Hỗn hợp", trangThai: "Chuẩn bị" }), true);
  assert.equal(isPackageGoodsEditable({ linhVuc: "Hỗn hợp", trangThai: "Đang mời thầu" }), true);
  assert.equal(isPackageGoodsEditable({ linhVuc: "Hỗn hợp", trangThai: "Đang chấm thầu" }), false);
  assert.equal(isPackageGoodsDeletable({ linhVuc: "Hỗn hợp", trangThai: "Chuẩn bị" }), true);
  assert.equal(isPackageGoodsDeletable({ linhVuc: "Hỗn hợp", trangThai: "Đang mời thầu" }), false);
});

test("goods display uses the complete lot size when a multi-item lot is filtered", () => {
  const allGoods = [
    { id: "goods-1", phanLoId: "lot-1", tenHangHoa: "Hóa chất CRP" },
    { id: "goods-2", phanLoId: "lot-1", tenHangHoa: "Chất hiệu chuẩn" },
  ];

  const displayRows = buildPackageGoodsDisplayRows([allGoods[0]], lots, {
    hasLots: true,
    allGoods,
  });

  assert.deepEqual(displayRows.map((row) => ({
    kind: row.kind,
    sequence: row.sequence,
    lotCode: row.lotCode,
    itemId: row.item?.id,
  })), [
    { kind: "lot", sequence: "1", lotCode: "PP01", itemId: undefined },
    { kind: "item", sequence: "1.1", lotCode: undefined, itemId: "goods-1" },
  ]);
});

test("goods pagination uses the same centered five-page window as other tables", () => {
  assert.deepEqual(packageGoodsPaginationPages(1, 1), [1]);
  assert.deepEqual(packageGoodsPaginationPages(1, 8), [1, 2, 3, 4, 5]);
  assert.deepEqual(packageGoodsPaginationPages(4, 8), [2, 3, 4, 5, 6]);
  assert.deepEqual(packageGoodsPaginationPages(8, 8), [4, 5, 6, 7, 8]);
});

test("goods mutation actions disappear instead of rendering disabled after the step is locked", () => {
  assert.equal(renderPackageGoodsMutationActions(false), "");
  const editableActions = renderPackageGoodsMutationActions(true);
  assert.match(editableActions, /btn-package-goods-import-trigger/);
  assert.match(editableActions, /btn-package-goods-add/);
  assert.doesNotMatch(editableActions, /disabled/);
});

test("employee goods row omits unavailable actions instead of showing dimmed buttons", () => {
  assert.equal(renderPackageGoodsRowActions({ id: "goods-1", editable: false, canDelete: false }), "");
  const employeeActions = renderPackageGoodsRowActions({ id: "goods-1", editable: true, canDelete: false });
  assert.match(employeeActions, /class="action-btn btn-edit"[^>]*data-edit-goods/);
  assert.match(employeeActions, /data-lucide="pencil"/);
  assert.match(employeeActions, /aria-label="Sửa hàng hóa"/);
  assert.doesNotMatch(employeeActions, /data-delete-goods|disabled/);
  const managerActions = renderPackageGoodsRowActions({ id: "goods-1", editable: true, canDelete: true });
  assert.match(managerActions, /class="action-btn btn-delete"[^>]*data-delete-goods/);
  assert.match(managerActions, /data-lucide="trash-2"/);
  assert.match(managerActions, /aria-label="Xóa hàng hóa"/);
  assert.doesNotMatch(managerActions, />\s*(?:Sửa|Xóa)\s*</);
});

test("goods editing renders controls inside the current table row", () => {
  const markup = renderPackageGoodsInlineEditRow({
    id: "goods-1",
    phanLoId: "lot-1",
    maHangHoa: "1.1",
    tenHangHoa: "Hóa chất CRP",
    donViTinh: "Hộp",
    soLuong: 18,
  }, lots, { hasLotColumns: true, sequence: "1.1" });

  assert.match(markup, /data-inline-edit-row="goods-1"/);
  assert.match(markup, /aria-label="Số thứ tự 1\.1">1\.1<\/td>/);
  assert.doesNotMatch(markup, /name="maHangHoa"/);
  assert.match(markup, /id="package-goods-lot-edit-goods-1"[^>]*name="phanLoId"[^>]*data-no-custom="true"/);
  assert.match(markup, /name="tenHangHoa"/);
  assert.match(markup, /name="donViTinh" value="Hộp"/);
  assert.match(markup, /name="soLuong"[^>]*value="18"/);
  assert.match(markup, /class="[^"]*package-goods-inline-action--save[^"]*"[^>]*data-save-goods="goods-1"[^>]*title="Lưu hàng hóa"[^>]*aria-label="Lưu hàng hóa"/);
  assert.match(markup, /class="[^"]*package-goods-inline-action--cancel[^"]*"[^>]*data-cancel-goods="goods-1"[^>]*title="Hủy chỉnh sửa"[^>]*aria-label="Hủy chỉnh sửa"/);
  assert.match(markup, /class="[^"]*btn-edit[^"]*"[^>]*data-save-goods="goods-1"/);
  assert.match(markup, /class="[^"]*btn-delete[^"]*"[^>]*data-cancel-goods="goods-1"/);
  assert.doesNotMatch(markup, />\s*(?:Lưu|Hủy)\s*<\/button>/);
  assert.doesNotMatch(markup, /package-goods-editor/);
});

test("goods lot combobox waits for an explicit user action before opening", () => {
  const config = packageGoodsLotComboboxConfig();

  assert.equal(config.openOnFocus, false);
  assert.equal(config.searchable, true);
});

test("adding goods renders a blank editable row instead of a separate panel", () => {
  const markup = renderPackageGoodsInlineCreateRow(lots, {
    hasLotColumns: true,
    selectedLotId: "lot-1",
    sequence: "1.3",
  });

  assert.match(markup, /data-inline-create-row/);
  assert.match(markup, /data-create-sequence[^>]*>1\.3<\/td>/);
  assert.match(markup, /id="package-goods-lot-create"[^>]*name="phanLoId"[^>]*data-create-lot/);
  assert.match(markup, /name="tenHangHoa"/);
  assert.match(markup, /name="donViTinh"/);
  assert.match(markup, /name="soLuong"/);
  assert.match(markup, /data-save-new-goods[^>]*title="Lưu hàng hóa"[^>]*aria-label="Lưu hàng hóa"/);
  assert.match(markup, /data-cancel-new-goods[^>]*title="Hủy thêm mới"[^>]*aria-label="Hủy thêm mới"/);
  assert.doesNotMatch(markup, /package-goods-editor|name="maHangHoa"/);
});

test("goods panel rehydrates every icon after dynamic rendering", () => {
  let hydratedRoot = null;
  const contentWrapper = {};
  const view = {
    createIconsScoped(root) {
      hydratedRoot = root;
    },
  };

  refreshPackageGoodsIcons(view, contentWrapper);

  assert.equal(hydratedRoot, contentWrapper);
});

test("goods search filters while typing and preserves focus after rendering", async () => {
  const listeners = new Map();
  const currentInput = {
    value: "hóa chất",
    selectionStart: 8,
    addEventListener(type, listener) { listeners.set(type, listener); },
    matches: (selector) => selector === ":focus",
  };
  let focused = false;
  let restoredSelection = null;
  const nextInput = {
    value: "hóa chất",
    focus() { focused = true; },
    setSelectionRange(start, end) { restoredSelection = [start, end]; },
  };
  let rendered = false;
  const contentWrapper = {
    querySelector() { return rendered ? nextInput : currentInput; },
  };
  const view = { _packageGoodsPage: 4 };

  bindPackageGoodsLiveSearch(view, contentWrapper, async () => { rendered = true; }, { delay: 0 });
  listeners.get("input")({ isComposing: false });
  await new Promise((resolve) => setTimeout(resolve, 5));

  assert.equal(view._packageGoodsSearch, "hóa chất");
  assert.equal(view._packageGoodsPage, 1);
  assert.equal(rendered, true);
  assert.equal(focused, true);
  assert.deepEqual(restoredSelection, [8, 8]);
});

test("goods tab renders the shared package summary with plan and investor context", () => {
  const pkg = {
    id: "package-1",
    keHoachId: "plan-1",
    linhVuc: "Hàng hóa",
    phanLo: "Không",
    giaGoiThau: 1_000_000,
    hinhThucLuaChon: "Đấu thầu rộng rãi",
    phuongThucLuaChon: "Một giai đoạn một túi hồ sơ",
    phuongPhapDanhGia: "Giá thấp nhất",
    thoiGianDongThau: "2026-07-05T08:00:00",
    thoiGianMoThau: "2026-07-05T08:05:00",
  };
  const view = {
    model: {
      state: {
        chudautu: [{ id: "investor-1", tenChuDauTu: "Chủ đầu tư A" }],
      },
      getLatestPlan: () => ({
        id: "plan-1",
        chuDauTuId: "investor-1",
        tenKeHoach: "Kế hoạch A",
      }),
      formatCurrency: () => "1.000.000 ₫",
      formatDateWithTime: (value) => value.includes("08:05")
        ? "08:05 ngày 05/07/2026"
        : "08:00 ngày 05/07/2026",
    },
  };

  const summary = renderPackageGoodsSummary(view, { ...pkg, trangThai: "Đang chấm thầu" }, { editable: false });

  assert.match(summary, /Thông số Gói thầu/);
  assert.match(summary, /Chủ đầu tư A/);
  assert.match(summary, /Kế hoạch A/);
  assert.match(summary, /Giá thấp nhất/);
  assert.match(summary, /1\.000\.000 ₫/);
  assert.match(summary, /08:05 ngày 05\/07\/2026/);
  assert.match(summary, /class="bf-s-8bd3eb473c"/);
  assert.match(summary, /class="bf-s-5d398becec"/);
  assert.match(summary, /class="bf-s-13b5590e90"/);
  assert.match(summary, /strong class="bf-s-fcb5ddef65"/);
  assert.match(summary, /class="package-lock-notice" role="status"/);
  assert.match(summary, /Chỉ đọc vì gói thầu đang ở trạng thái Đang chấm thầu/);
  assert.ok(summary.indexOf("bf-s-13b5590e90") < summary.indexOf("package-lock-notice"));
});

test("IndexedDB upgrade adds the goods store without recreating existing stores", async () => {
  const originalIndexedDb = globalThis.indexedDB;
  const created = [];
  let requestedVersion = null;
  globalThis.indexedDB = {
    open(_name, version) {
      requestedVersion = version;
      const existing = new Set(["goithau", "kv_store"]);
      const db = {
        objectStoreNames: { contains: (name) => existing.has(name) },
        createObjectStore(name) { created.push(name); existing.add(name); },
      };
      const request = {};
      queueMicrotask(() => {
        request.onupgradeneeded?.({ target: { result: db } });
        request.onsuccess?.({ target: { result: db } });
      });
      return request;
    },
  };
  try {
    await new BrowserDB("test-package-goods").init();
  } finally {
    globalThis.indexedDB = originalIndexedDb;
  }
  assert.equal(requestedVersion, 5);
  assert.ok(created.includes("goithauhanghoa"));
  assert.ok(created.includes("hanghoaduthaunhathau"));
  assert.ok(!created.includes("goithau"));
});
