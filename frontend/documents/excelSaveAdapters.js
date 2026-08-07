import { trustedHTML } from "../shared/trustedTypes.js";
﻿import { normalizePersonName } from "../app/domUtils.js";
import {
  filterBidsByEvaluationLotScope,
  getActiveEvaluationLotScope,
  isPartialEvaluationLotScope
} from "../packages/lotEvaluationScope.js";
import {
  requiresTechnicalScoreInput,
  validateTechnicalScore,
} from "../packages/evaluationMethodRules.js";
const BASIC_IMPORT_TYPES = /* @__PURE__ */ new Set(["plan", "kehoach", "package", "goithau", "chudautu", "nhathau", "chuyengia", "hopdong"]);
const BUSINESS_IMPORT_TYPES = /* @__PURE__ */ new Set(["mothau", "danhgiahsdt", "ketquaqd", "opening_fin"]);
import { assertOutboundRecordFields } from "../app/outboundSerializer.js";

function assertImportRecords(type, records, allowedTransforms = []) {
  records.forEach((record) => assertOutboundRecordFields(record, type, {
    source: `Excel ${type}`,
    allowedTransforms
  }));
}
function ensureYMD(controller, dateStr) {
  if (!dateStr) return "";
  if (dateStr.match(/^\d{4}-\d{2}-\d{2}/)) return dateStr.substring(0, 10);
  return controller.model.convertDMYToYMD ? controller.model.convertDMYToYMD(dateStr) : dateStr;
}
function ensureYMDHMS(controller, dateStr) {
  if (!dateStr) return "";
  if (dateStr.match(/^\d{4}-\d{2}-\d{2} \d{2}:\d{2}/)) return dateStr;
  return controller.model.convertDMYHMSToYMDHMS ? controller.model.convertDMYHMSToYMDHMS(dateStr) : dateStr;
}
function upsertById(list, items) {
  items.forEach((item) => {
    const idx = list.findIndex((existing) => existing.id === item.id);
    if (idx !== -1) {
      const existing = list[idx];
      list[idx] = {
        ...existing,
        ...item,
        id: existing.id,
        rootId: existing.rootId || existing.id,
        phienBan: existing.phienBan || "00",
        isLatest: existing.isLatest ?? 1,
        rowVersion: existing.rowVersion,
        createdAt: existing.createdAt
      };
    } else {
      list.push(item);
    }
  });
}
export function isBasicExcelImportType(type) {
  return BASIC_IMPORT_TYPES.has(type);
}
export function isBusinessExcelImportType(type) {
  return BUSINESS_IMPORT_TYPES.has(type);
}
export async function saveBasicExcelImport(controller, type, validRows) {
  if (!isBasicExcelImportType(type)) return null;
  if (type === "plan" || type === "kehoach") {
    const mappedData = validRows.map((row) => {
      const normalizedCode = String(row.maKeHoach || "").trim().toLocaleLowerCase("vi-VN");
      const existing = controller.model.state.kehoach.find(
        (plan) => plan.isLatest === 1 && String(plan.maKeHoach || "").trim().toLocaleLowerCase("vi-VN") === normalizedCode
      );
      const planId = existing?.id || generateRecordId("kehoach");
      return {
        ...(existing || {}),
        id: planId,
        maKeHoach: row.maKeHoach || "",
        phienBan: existing?.phienBan || "00",
        isLatest: existing?.isLatest ?? 1,
        rootId: existing?.rootId || planId,
        tenKeHoach: row.tenKeHoach || "",
        tenDuAnDuToan: row.tenDuAnDuToan || "",
        chuDauTuId: existing?.chuDauTuId || "",
        donViTrinhCdt: row.donViTrinhCdt || "",
        tenVietTatDonViTrinh: row.tenVietTatDonViTrinh || "",
        tongMucDauTu: controller.model.parseVND(row.tongMucDauTu) || 0,
        ngayPheDuyet: ensureYMD(controller, row.ngayPheDuyet),
        quyetDinhPheDuyet: row.quyetDinhPheDuyet || "",
        thoiGianDangMa: row.thoiGianDangMa ? ensureYMDHMS(controller, row.thoiGianDangMa) : ""
      };
    });
    assertImportRecords("kehoach", mappedData);
    upsertById(controller.model.state.kehoach, mappedData);
    await controller.model.persistData("kehoach");
    return mappedData.length;
  }
  if (type === "package" || type === "goithau") {
    const latestPlans = controller.model.getLatestPlans();
    const mappedData = validRows.map((row) => {
      const matchedPlan = latestPlans.find((p) => p.maKeHoach.toLowerCase() === (row.keHoachId || row.maKeHoach || "").toLowerCase());
      const normalizedCode = String(row.maGoiThau || "").trim().toLocaleLowerCase("vi-VN");
      const existing = controller.model.state.goithau.find(
        (pkg) => pkg.isLatest === 1 && String(pkg.maGoiThau || "").trim().toLocaleLowerCase("vi-VN") === normalizedCode
      );
      const gtId = existing?.id || generateRecordId("goithau");
      return {
        ...(existing || {}),
        id: gtId,
        maGoiThau: row.maGoiThau || "",
        phienBan: existing?.phienBan || "00",
        isLatest: existing?.isLatest ?? 1,
        rootId: existing?.rootId || gtId,
        keHoachId: matchedPlan?.id || existing?.keHoachId || "",
        tenGoiThau: row.tenGoiThau || "",
        giaGoiThau: controller.model.parseVND(row.giaGoiThau),
        thoiGianThucHien: parseInt(row.thoiGianThucHien) || 0,
        hinhThucLuaChon: row.hinhThucLuaChon || "Đấu thầu rộng rãi",
        phuongThucLuaChon: row.phuongThucLuaChon || "Một giai đoạn một túi hồ sơ",
        trangThai: row.trangThai || "Chuẩn bị",
        linhVuc: row.linhVuc || "Xây lắp",
        tuyChonMuaThem: existing?.tuyChonMuaThem || "Không",
        nguonVon: existing?.nguonVon || "Ngân sách nhà nước",
        loaiHopDong: existing?.loaiHopDong || "Trọn gói",
        thoiGianToChuc: existing?.thoiGianToChuc || "",
        thoiGianBatDauToChuc: existing?.thoiGianBatDauToChuc || "",
        quaMang: existing?.quaMang || "Qua mạng",
        trongNuocQuocTe: existing?.trongNuocQuocTe || "Trong nước",
        phanLo: existing?.phanLo || "Không",
        phanLoList: existing?.phanLoList || [],
        tuyChonMuaThemList: existing?.tuyChonMuaThemList || [],
        soQuyetDinh: row.soQuyetDinh || "",
        ngayQuyetDinh: ensureYMD(controller, row.ngayQuyetDinh),
        thoiGianDangTai: row.thoiGianDangTai ? ensureYMDHMS(controller, row.thoiGianDangTai) : "",
        thoiGianDongThau: row.thoiGianDongThau ? ensureYMDHMS(controller, row.thoiGianDongThau) : "",
        thoiGianMoThau: row.thoiGianMoThau ? ensureYMDHMS(controller, row.thoiGianMoThau) : "",
        toChuyenGia: existing?.toChuyenGia || [],
        toThamDinh: existing?.toThamDinh || []
      };
    });
    assertImportRecords("goithau", mappedData);
    upsertById(controller.model.state.goithau, mappedData);
    [...new Set(mappedData.map((gt) => gt.keHoachId).filter(Boolean))].forEach((pid) => controller.recalculatePlanTotal(pid));
    await Promise.all([
      controller.model.persistData("goithau"),
      controller.model.persistData("kehoach")
    ]);
    return mappedData.length;
  }
  if (type === "chudautu") {
    const mappedData = validRows.map((row) => {
      const mst = (row.maSoThue || "").trim();
      const maCdt = (row.maChuDauTu || "").trim().toLowerCase();
      const existing = controller.model.state.chudautu.find(
        (c) => mst && c.maSoThue && c.maSoThue.trim() === mst || maCdt && c.maChuDauTu && c.maChuDauTu.trim().toLowerCase() === maCdt
      );
      const targetId = existing ? existing.id : generateRecordId("chudautu");
      return {
        id: targetId,
        rootId: targetId,
        phienBan: "00",
        isLatest: 1,
        maChuDauTu: row.maChuDauTu || "",
        maSoThue: row.maSoThue || "",
        tenChuDauTu: row.tenChuDauTu || "",
        tenVietTat: row.tenVietTat || "",
        chucVuNguoiDungDau: row.chucVuNguoiDungDau || "",
        daiDienCdt: normalizePersonName(row.daiDienCdt),
        chucVuDaiDien: row.chucVuDaiDien || "",
        danhXung: row.danhXung || "Ông",
        diaChi: row.diaChi || "",
        soDienThoai: row.soDienThoai || "",
        soTaiKhoan: row.soTaiKhoan || "",
        noiMoTaiKhoan: row.noiMoTaiKhoan || "",
        email: row.email || "",
        maQHNS: row.maQHNS || ""
      };
    });
    assertImportRecords("chudautu", mappedData);
    upsertById(controller.model.state.chudautu, mappedData);
    await controller.model.persistData("chudautu");
    return mappedData.length;
  }
  if (type === "nhathau") {
    const mappedData = validRows.map((row) => {
      const mst = (row.maSoThue || "").trim();
      const maNt = (row.maNhaThau || "").trim().toLowerCase();
      const existing = controller.model.state.nhathau.find(
        (n) => mst && n.maSoThue && n.maSoThue.trim() === mst || maNt && n.maNhaThau && n.maNhaThau.trim().toLowerCase() === maNt
      );
      const targetId = existing ? existing.id : generateRecordId("nhathau");
      return {
        id: targetId,
        rootId: targetId,
        phienBan: "00",
        isLatest: 1,
        maNhaThau: row.maNhaThau || "",
        tenNhaThau: row.tenNhaThau || "",
        tenVietTat: row.tenVietTat || "",
        loaiNhaThau: row.loaiNhaThau || "Độc lập",
        maSoThue: row.maSoThue || "",
        nguoiDaiDien: normalizePersonName(row.nguoiDaiDien),
        chucVuDaiDien: row.chucVuDaiDien || "",
        danhXung: row.danhXung || "Ông",
        soDienThoai: row.soDienThoai || "",
        email: row.email || "",
        diaChi: row.diaChi || "",
        soTaiKhoan: row.soTaiKhoan || "",
        noiMoTaiKhoan: row.noiMoTaiKhoan || "",
        maNganHang: row.maNganHang || "",
        anhDau: row.anhDau || (existing ? existing.anhDau || "" : ""),
        tenAnhDau: row.tenAnhDau || (existing ? existing.tenAnhDau || "" : ""),
        thanhVienLienDanh: existing ? existing.thanhVienLienDanh : []
      };
    });
    assertImportRecords("nhathau", mappedData);
    upsertById(controller.model.state.nhathau, mappedData);
    await controller.model.persistData("nhathau");
    return mappedData.length;
  }
  if (type === "chuyengia") {
    const mappedData = validRows.map((row) => {
      const cccd = (row.soCCCD || "").trim();
      const soChungChi = (row.soChungChi || "").trim().toLowerCase();
      const existing = controller.model.state.chuyengia.find(
        (cg) => cccd && cg.soCCCD && cg.soCCCD.trim() === cccd || soChungChi && cg.soChungChi && cg.soChungChi.trim().toLowerCase() === soChungChi
      );
      const targetId = existing ? existing.id : generateRecordId("chuyengia");
      return {
        id: targetId,
        rootId: targetId,
        phienBan: "00",
        isLatest: 1,
        hoTen: row.hoTen || "",
        soCCCD: row.soCCCD || "",
        ngayCapCCCD: ensureYMD(controller, row.ngayCapCCCD),
        noiCapCCCD: row.noiCapCCCD || "",
        soChungChi: row.soChungChi || "",
        ngayCapChungChi: ensureYMD(controller, row.ngayCapChungChi),
        donViCapChungChi: row.donViCapChungChi || "",
        anhChungChi: existing ? existing.anhChungChi : "",
        tenAnhChungChi: existing ? existing.tenAnhChungChi : "",
        anhChuKy: existing ? existing.anhChuKy : "",
        tenAnhChuKy: existing ? existing.tenAnhChuKy : ""
      };
    });
    assertImportRecords("chuyengia", mappedData);
    upsertById(controller.model.state.chuyengia, mappedData);
    await controller.model.persistData("chuyengia");
    return mappedData.length;
  }
  if (type === "hopdong") {
    const mappedData = validRows.map((row) => {
      const cdt = controller.model.state.chudautu.find((c) => c.maChuDauTu.toLowerCase() === (row.chuDauTuId || "").toLowerCase());
      const nt = controller.model.state.nhathau.find((n) => n.maNhaThau.toLowerCase() === (row.nhaThauId || "").toLowerCase());
      const soHd = (row.soHopDong || "").trim().toLowerCase();
      const existing = controller.model.state.hopdong.find((h) => h.soHopDong && h.soHopDong.trim().toLowerCase() === soHd);
      const targetId = existing ? existing.id : generateRecordId("hopdong");
      const plan = (controller.model.state.kehoach || []).find((item) =>
        String(item.id) === String(row.keHoachId || "") ||
        String(item.maKeHoach || "").trim().toLocaleLowerCase("vi-VN") === String(row.keHoachId || row.maKeHoach || "").trim().toLocaleLowerCase("vi-VN")
      );
      const packageCodes = String(row.goiThauIds || row.maGoiThau || "")
        .split(/[,;\n]/)
        .map((value) => value.trim().toLocaleLowerCase("vi-VN"))
        .filter(Boolean);
      const packageIds = (controller.model.state.goithau || [])
        .filter((item) => packageCodes.includes(String(item.id || "").toLocaleLowerCase("vi-VN")) || packageCodes.includes(String(item.maGoiThau || "").trim().toLocaleLowerCase("vi-VN")))
        .map((item) => item.id);
      return {
        id: targetId,
        rootId: targetId,
        phienBan: "00",
        isLatest: 1,
        tenHopDong: row.tenHopDong || "",
        soHopDong: row.soHopDong || "",
        ngayKy: ensureYMD(controller, row.ngayKy),
        chuDauTuId: cdt ? cdt.id : "",
        nhaThauId: nt ? nt.id : "",
        giaTri: controller.model.parseVND(row.giaTri) || 0,
        loaiHopDong: row.loaiHopDong || "Trọn gói",
        phanLoai: row.phanLoai || "Tư vấn",
        coQdChiDinh: row.coQdChiDinh === "Có" || row.coQdChiDinh === 1 || row.coQdChiDinh === "1" ? 1 : 0,
        soQdChiDinh: row.soQdChiDinh || "",
        ngayQdChiDinh: ensureYMD(controller, row.ngayQdChiDinh),
        soNgayThucHien: row.soNgayThucHien ? String(row.soNgayThucHien).trim() : "",
        keHoachId: plan?.id || existing?.keHoachId || "",
        goiThauIds: packageIds.length ? packageIds : existing?.goiThauIds || [],
        trangThaiHopDong: row.trangThaiHopDong || existing?.trangThaiHopDong || "Đang thực hiện"
      };
    });
    assertImportRecords("hopdong", mappedData);
    upsertById(controller.model.state.hopdong, mappedData);
    await controller.model.persistData("hopdong");
    return mappedData.length;
  }
  return null;
}
function getOpeningCaseType(goiThau) {
  const isTuVan = goiThau.linhVuc === "Tư vấn";
  const is1G2T = goiThau.phuongThucLuaChon === "Một giai đoạn hai túi hồ sơ";
  const is1G1T = goiThau.phuongThucLuaChon === "Một giai đoạn một túi hồ sơ";
  const hasPhanLo = goiThau.phanLo === "Có";
  if (isTuVan) return "TU_VAN";
  if (!isTuVan && is1G2T) return hasPhanLo ? "1G2T_WITH_LOT" : "1G2T_NO_LOT";
  if (is1G1T) return hasPhanLo ? "1G1T_WITH_LOT" : "1G1T_NO_LOT";
  return "1G1T_NO_LOT";
}
function ensureContractorForOpeningImport(controller, row) {
  let foundNt = controller.model.state.nhathau.find(
    (n) => n.maNhaThau && row.maNhaThau && n.maNhaThau.toLowerCase() === row.maNhaThau.toLowerCase() || n.tenNhaThau && row.tenNhaThau && n.tenNhaThau.toLowerCase() === row.tenNhaThau.toLowerCase()
  );
  if (!foundNt && row.tenNhaThau) {
    const newId = generateRecordId("nhathau");
    foundNt = {
      id: newId,
      rootId: newId,
      phienBan: "00",
      isLatest: 1,
      maNhaThau: row.maNhaThau || "NT-" + generateUUID().toString().substr(8),
      tenNhaThau: row.tenNhaThau,
      loaiNhaThau: row.loaiNhaThau || "Độc lập",
      maSoThue: "",
      nguoiDaiDien: "",
      danhXung: "Ông",
      soDienThoai: "",
      email: "",
      diaChi: "",
      soTaiKhoan: "",
      noiMoTaiKhoan: "",
      maNganHang: "",
      thanhVienLienDanh: []
    };
    controller.model.state.nhathau.push(foundNt);
  } else if (foundNt && row.loaiNhaThau && foundNt.loaiNhaThau !== row.loaiNhaThau) {
    foundNt.loaiNhaThau = row.loaiNhaThau;
  }
  return foundNt;
}
async function saveOpeningImport(controller, validRows, context = {}) {
  const select = context.packageId ? null : document.getElementById("mothau-goithau-select");
  const gtId = context.packageId || (select ? select.value : "");
  if (!gtId) return 0;
  const importedBids = [];
  validRows.forEach((row) => {
    const foundNt = ensureContractorForOpeningImport(controller, row);
    const nhaThauId = foundNt ? foundNt.id : row.nhaThauId;
    const existingBid = controller.model.state.thongtinmothau.find((bid) =>
      String(bid.goiThauId) === String(gtId) &&
      ((row.id && String(bid.id) === String(row.id)) ||
        (String(bid.nhaThauId || "") === String(nhaThauId || "") &&
          String(bid.maPhanLo || "").trim().toLocaleLowerCase("vi-VN") === String(row.maPhanLo || "").trim().toLocaleLowerCase("vi-VN")))
    );
    importedBids.push({
      id: existingBid?.id || row.id || generateRecordId("thongtinmothau"),
      goiThauId: gtId,
      nhaThauId,
      maPhanLo: row.maPhanLo || "",
      tenPhanLo: row.tenPhanLo || "",
      maDinhDanh: row.maDinhDanh || "",
      giaDuThau: row.giaDuThau || 0,
      tyLeGiamGia: row.tyLeGiamGia || 0,
      giaSauGiamGia: row.giaSauGiamGia || 0,
      hieuLucHsdt: row.hieuLucHsdt || 0,
      giaTriDamBao: row.giaTriDamBao || 0,
      hieuLucBaoDamNgay: row.hieuLucBaoDamNgay || 0,
      thoiGianThucHien: row.thoiGianThucHien || "",
      maNhaThau: foundNt ? foundNt.maNhaThau : row.maNhaThau,
      tenNhaThau: row.loaiNhaThau === "Liên danh" ? row.tenNhaThau : foundNt ? foundNt.tenNhaThau : row.tenNhaThau,
      loaiNhaThau: foundNt ? foundNt.loaiNhaThau : row.loaiNhaThau
    });
  });
  upsertById(controller.model.state.thongtinmothau, importedBids);
  await Promise.all([
    controller.model.persistData("nhathau"),
    controller.model.persistData("thongtinmothau")
  ]);
  const goiThau = controller.model.state.goithau.find((g) => g.id === gtId);
  if (goiThau) {
    const tbody = document.getElementById("mothau-table-tbody");
    if (tbody) tbody.innerHTML = trustedHTML("");
    const caseType = getOpeningCaseType(goiThau);
    const newBids = controller.model.state.thongtinmothau.filter((b) => String(b.goiThauId) === String(gtId));
    if (newBids.length === 0) {
      controller.addMoThauRow(caseType, goiThau);
    } else {
      newBids.forEach((bid) => controller.addMoThauRow(caseType, goiThau, bid));
    }
    lucide.createIcons();
  }
  return validRows.length;
}
async function saveEvaluationImport(controller, validRows, context = {}) {
  const select = context.packageId ? null : document.getElementById("danhgiahsdt-goithau-select");
  const gtId = context.packageId || (select ? select.value : "");
  if (!gtId) return 0;
  const pkg = controller.model.state.goithau.find((item) => String(item.id) === String(gtId));
  const activeDetails = getActiveEvaluationLotScope(controller, pkg);
  const evaluationTab = context.evaluationTab || controller.currentDanhGiaTab || "technical";
  const activeScopeKey = `${String(gtId)}:${String(evaluationTab)}`;
  const activeScope = controller._evaluationLotScopes?.[activeScopeKey];
  if (requiresTechnicalScoreInput(pkg) && evaluationTab === "technical") {
    const invalidRow = (validRows || []).find((row) => (
      !validateTechnicalScore(row.danhGiaKyThuat, { required: true }).valid
    ));
    if (invalidRow) {
      await controller.view.customAlert(
        "Điểm kỹ thuật chưa hợp lệ",
        "Gói thầu áp dụng phương pháp kết hợp kỹ thuật và giá nên phần kỹ thuật bắt buộc nhập điểm số, không được nhập Đạt/Không đạt.",
        "alert-triangle",
      );
      return 0;
    }
  }
  const allowedBidIds = isPartialEvaluationLotScope(activeDetails)
    ? new Set(filterBidsByEvaluationLotScope(
      controller.model.state.thongtinmothau.filter((bid) => String(bid.goiThauId) === String(gtId)),
      pkg,
      activeScope
    ).map((bid) => String(bid.id)))
    : null;
  validRows.forEach((row) => {
    const bid = controller.model.state.thongtinmothau.find((b) => b.id === row.id);
    if (!bid || allowedBidIds && !allowedBidIds.has(String(bid.id))) return;
    if (evaluationTab === "financial" || evaluationTab === "unified") {
      bid.giaDuThau = row.giaDuThau || 0;
      bid.tyLeGiamGia = row.tyLeGiamGia || 0;
      bid.giaSauGiamGia = row.giaSauGiamGia || 0;
      bid.giaXepHang = row.giaXepHang || 0;
      bid.giaDeNghiTrungThau = row.giaDeNghiTrungThau || 0;
      bid.chapThuanGiaDeNghiTrungThauDuoi50 = row.chapThuanGiaDeNghiTrungThauDuoi50 ?? null;
      bid.hieuLucHsdt = row.hieuLucHsdt || 0;
      bid.thoiGianThucHien = row.thoiGianThucHien || bid.thoiGianThucHien || "";
      bid.lamRoTaiChinh = row.lamRoTaiChinh || "";
      return;
    }
    bid.danhGiaHopLe = row.danhGiaHopLe || "";
    bid.danhGiaNangLuc = row.danhGiaNangLuc || "";
    bid.danhGiaKyThuat = row.danhGiaKyThuat || "";
    if (row.danhGiaKetLuan) {
      bid.danhGiaKetLuan = row.danhGiaKetLuan || "";
    }
    bid.lamRoHopLe = row.lamRoHopLe || "";
    bid.lamRoNangLuc = row.lamRoNangLuc || "";
    bid.lamRoKyThuat = row.lamRoKyThuat || "";
    bid.lamRoTaiChinh = row.lamRoTaiChinh || "";
    bid.nguyenNhanKhongDatHopLe = bid.danhGiaHopLe === "Không đạt" ? row.nguyenNhanKhongDatHopLe || "" : "";
    bid.nguyenNhanKhongDatNangLuc = bid.danhGiaNangLuc === "Không đạt" ? row.nguyenNhanKhongDatNangLuc || "" : "";
    bid.nguyenNhanKhongDatKyThuat = bid.danhGiaKyThuat === "Không đạt" ? row.nguyenNhanKhongDatKyThuat || "" : "";
  });
  await controller.model.persistData("thongtinmothau");
  controller.renderDanhGiaHsdtPanel();
  return validRows.length;
}
async function saveAwardResultImport(controller, validRows, context = {}) {
  const gtId = context.packageId || controller._currentResultPackageId;
  if (!gtId) return 0;
  const goiThau = controller.model.state.goithau.find((g) => g.id === gtId);
  if (!goiThau) return 0;
  const winnerRow = validRows.find((r) => r.trangThai === "Trúng thầu" || r.trangThai === "trung");
  validRows.forEach((row) => {
    let bid = controller.model.state.thongtinmothau.find((b) => b.id === row.id);
    if (!bid && (goiThau.hinhThucLuaChon === "Chỉ định thầu rút gọn" || goiThau.hinhThucLuaChon === "Lựa chọn nhà thầu trong trường hợp đặc biệt")) {
      const latestNhaThauList = controller.model.getLatestNhaThau();
      const foundNt = latestNhaThauList.find((n) => n.id === row.nhaThauId);
      bid = {
        id: row.id || generateRecordId("thongtinmothau"),
        goiThauId: gtId,
        nhaThauId: row.nhaThauId,
        maNhaThau: row.maNhaThau || (foundNt ? foundNt.maNhaThau : ""),
        tenNhaThau: row.tenNhaThau || (foundNt ? foundNt.tenNhaThau : ""),
        loaiNhaThau: foundNt ? foundNt.loaiNhaThau : "Độc lập",
        thanhVienLienDanh: foundNt ? foundNt.thanhVienLienDanh : [],
        giaDuThau: 0,
        giaSauGiamGia: 0,
        danhGiaHopLe: "Đạt",
        danhGiaNangLuc: "Đạt",
        danhGiaKyThuat: "Đạt",
        danhGiaTaiChinh: "Đạt",
        danhGiaKetLuan: "Đạt",
        thoiGianThucHien: goiThau.thoiGianThucHien,
        lyDoTruot: ""
      };
      controller.model.state.thongtinmothau.push(bid);
    }
    if (bid) {
      bid.lyDoTruot = row.trangThai === "Trúng thầu" || row.trangThai === "trung" ? "" : row.lyDoTruot || "Nhà thầu xếp hạng 1 trúng thầu";
    }
  });
  if (winnerRow) {
    let winnerId = winnerRow.nhaThauId;
    if (!winnerId) {
      const matchedBid = controller.model.state.thongtinmothau.find(
        (b) => String(b.goiThauId) === String(gtId) && (winnerRow.maNhaThau && String(b.maNhaThau || b.maDinhDanh || "").toLowerCase() === String(winnerRow.maNhaThau).toLowerCase() || winnerRow.tenNhaThau && String(b.tenNhaThau || "").toLowerCase() === String(winnerRow.tenNhaThau).toLowerCase())
      );
      if (matchedBid) winnerId = matchedBid.nhaThauId;
    }
    goiThau.nhaThauTrungThauId = winnerId ? isNaN(winnerId) ? winnerId : parseInt(winnerId) : "";
    goiThau.giaTrungThau = winnerRow.giaTrungThau !== void 0 && winnerRow.giaTrungThau !== null ? winnerRow.giaTrungThau : null;
    goiThau.thoiGianGoiThau = winnerRow.thoiGianGoiThau || "";
    goiThau.thoiGianHopDong = winnerRow.thoiGianHopDong || "";
    goiThau.trangThai = "Đã có kết quả";
  } else {
    goiThau.nhaThauTrungThauId = "";
    goiThau.giaTrungThau = null;
    goiThau.thoiGianGoiThau = "";
    goiThau.thoiGianHopDong = "";
    goiThau.trangThai = "Hủy thầu";
  }
  await Promise.all([
    controller.model.persistData("goithau"),
    controller.model.persistData("thongtinmothau")
  ]);
  controller.view.showPackageDetails(gtId);
  return validRows.length;
}
async function saveOpeningFinancialImport(controller, validRows, context = {}) {
  const select = context.packageId
    ? null
    : document.getElementById("mothau-goithau-select") || document.getElementById("danhgiahsdt-goithau-select");
  const gtId = context.packageId || (select ? select.value : controller._currentPackageId || "");
  if (!gtId) return 0;
  const goiThau = controller.model.state.goithau.find((g) => g.id === gtId);
  const defaultDuration = goiThau ? goiThau.thoiGianThucHien || "" : "";
  validRows.forEach((row) => {
    const bid = controller.model.state.thongtinmothau.find((b) => b.id === row.id);
    if (!bid) return;
    bid.giaDuThau = row.giaDuThau || 0;
    bid.tyLeGiamGia = row.tyLeGiamGia || 0;
    bid.giaSauGiamGia = row.giaSauGiamGia || 0;
    bid.hieuLucHsdt = row.hieuLucHsdt || 0;
    bid.thoiGianThucHien = row.thoiGianThucHien || bid.thoiGianThucHien || defaultDuration || "";
  });
  await Promise.all([
    controller.model.persistData("thongtinmothau"),
    controller.model.persistData("goithau")
  ]);
  controller.view.showPackageDetails(gtId);
  return validRows.length;
}
export async function saveBusinessExcelImport(controller, type, validRows, context = {}) {
  if (!isBusinessExcelImportType(type)) return null;
  assertImportRecords("thongtinmothau", validRows, type === "ketquaqd" ? ["trangThai"] : []);
  if (type === "mothau") return await saveOpeningImport(controller, validRows, context);
  if (type === "danhgiahsdt") return await saveEvaluationImport(controller, validRows, context);
  if (type === "ketquaqd") return await saveAwardResultImport(controller, validRows, context);
  if (type === "opening_fin") return await saveOpeningFinancialImport(controller, validRows, context);
  return null;
}
import { generateRecordId, generateUUID } from "../shared/idUtils.js";
