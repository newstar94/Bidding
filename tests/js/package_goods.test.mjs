import assert from "node:assert/strict";
import test from "node:test";

import { buildPackageTabs } from "../../frontend/packages/detail/PackageTabs.js";
import { buildPackageGoodsPreview, parsePackageGoodsRows } from "../../frontend/packages/PackageGoodsExcel.js";
import { clonePackageGoodsForSnapshot } from "../../frontend/packages/packageGoodsVersioning.js";
import { BrowserDB } from "../../frontend/app/BrowserDB.js";

const lots = [
  { id: "lot-1", maPhanLo: "PP01", tenPhanLo: "Phần 1" },
  { id: "lot-2", maPhanLo: "PP02", tenPhanLo: "Phần 2" },
];

test("imports the supplied no-lot layout and uses STT as a stable fallback code", () => {
  const pkg = { id: "package-1", linhVuc: "Hàng hóa", phanLo: "Không" };
  const rows = parsePackageGoodsRows([{
    STT: 1,
    "Danh mục hàng hóa (1)": "Dây truyền dịch",
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

test("goods tab is visible only for goods procurement packages", () => {
  assert.ok(buildPackageTabs({ linhVuc: "Hàng hóa", trangThai: "Chuẩn bị" }).tabs.some((tab) => tab.id === "goods"));
  assert.ok(!buildPackageTabs({ linhVuc: "Tư vấn", trangThai: "Chuẩn bị" }).tabs.some((tab) => tab.id === "goods"));
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
  assert.equal(requestedVersion, 4);
  assert.ok(created.includes("goithauhanghoa"));
  assert.ok(!created.includes("goithau"));
});
