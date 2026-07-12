import { normalizePersonName, normalizeTaxCodeForCompare, normalizeVietnamTaxCode } from "../main_controller/domUtils.js";
import { getExactContractorVersion, selectContractorVersionForDate } from "./contractorVersionBinding.js";
function normalizeOpeningCode(value) {
  return normalizeTaxCodeForCompare(value);
}
function normalizeTaxCodeForStorage(value) {
  const normalized = normalizeVietnamTaxCode(value);
  return /^\d{10}$|^\d{13}$|^\d{10}-\d{3}$/.test(normalized) ? normalized : "";
}
function findLatestContractorByCode(latestNhaThauList, code) {
  const normalizedCode = normalizeOpeningCode(code);
  if (!normalizedCode) return null;
  return latestNhaThauList.find(
    (n) => normalizeOpeningCode(n.maNhaThau) === normalizedCode || normalizeOpeningCode(n.maSoThue) === normalizedCode
  ) || null;
}
function isJointVentureType(value) {
  return String(value || "").trim().toLowerCase() === "liên danh";
}
export function resolveOpeningLookupNames(loaiNhaThau, currentBidName, lookupMemberName, currentLeadName = "") {
  const bidName = String(currentBidName || "").trim();
  const lookupName = String(lookupMemberName || "").trim();
  if (isJointVentureType(loaiNhaThau)) {
    return {
      bidName,
      leadMemberName: lookupName || String(currentLeadName || "").trim()
    };
  }
  return {
    bidName: lookupName || bidName,
    leadMemberName: String(currentLeadName || "").trim()
  };
}
function isLeadMember(member, leadCode) {
  const role = String(member?.vaiTro || "").trim().toLowerCase();
  const normalizedLeadCode = normalizeOpeningCode(leadCode);
  return role.includes("đứng") && role.includes("đầu") || normalizedLeadCode && normalizeOpeningCode(member?.maNhaThau || member?.maSoThue) === normalizedLeadCode;
}
function createIndependentContractor({ id, maNhaThau, tenNhaThau, member = {} }) {
  const now = new Date();
  const today = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}-${String(now.getDate()).padStart(2, "0")}`;
  return {
    id,
    rootId: id,
    maNhaThau,
    tenNhaThau,
    loaiNhaThau: "Độc lập",
    maSoThue: normalizeTaxCodeForStorage(member.maSoThue),
    nguoiDaiDien: normalizePersonName(member.nguoiDaiDien),
    chucVuDaiDien: member.chucVuDaiDien || "",
    danhXung: member.danhXung || "Ông",
    soDienThoai: member.soDienThoai || "",
    email: member.email || "",
    diaChi: member.diaChi || "",
    diaChiGoc: member.diaChiGoc || "",
    soTaiKhoan: member.soTaiKhoan || "",
    noiMoTaiKhoan: member.noiMoTaiKhoan || "",
    maNganHang: member.maNganHang || "",
    thanhVienLienDanh: [],
    phienBan: "00",
    isLatest: 1,
    ngayApDung: today,
    createdAt: `${today} ${String(now.getHours()).padStart(2, "0")}:${String(now.getMinutes()).padStart(2, "0")}:${String(now.getSeconds()).padStart(2, "0")}`
  };
}
function mergeContractorLookupData(target, source = {}) {
  if (!target || !source) return;
  if (Object.prototype.hasOwnProperty.call(source, "maSoThue")) {
    target.maSoThue = normalizeTaxCodeForStorage(source.maSoThue);
  }
  if (source.tenNhaThau && (!target.tenNhaThau || String(target.tenNhaThau).startsWith("Thành viên đứng đầu"))) {
    target.tenNhaThau = source.tenNhaThau;
  }
  if (source.tenVietTat && !target.tenVietTat) target.tenVietTat = source.tenVietTat;
  if (source.diaChi && !target.diaChi) target.diaChi = source.diaChi;
  if (source.diaChiGoc && !target.diaChiGoc) target.diaChiGoc = source.diaChiGoc;
  if (source.nguoiDaiDien && !target.nguoiDaiDien) target.nguoiDaiDien = normalizePersonName(source.nguoiDaiDien);
  if (source.chucVuDaiDien && !target.chucVuDaiDien) target.chucVuDaiDien = source.chucVuDaiDien;
  if (source.soDienThoai && !target.soDienThoai) target.soDienThoai = source.soDienThoai;
  if (source.email && !target.email) target.email = source.email;
}
function ensureContractor({ model, latestNhaThauList, maNhaThau, tenNhaThau, loaiNhaThau, row, businessDate }) {
  const bound = getExactContractorVersion(model, row.dataset.contractorVersionId);
  const boundMatchesCode = bound && normalizeOpeningCode(bound.maNhaThau || bound.maSoThue) === normalizeOpeningCode(maNhaThau);
  const candidate = boundMatchesCode ? bound : findLatestContractorByCode(latestNhaThauList, maNhaThau);
  let foundNt = boundMatchesCode ? bound : candidate ? selectContractorVersionForDate(model, candidate.id, businessDate) : null;
  if (!isJointVentureType(loaiNhaThau)) {
    if (!foundNt) {
      foundNt = createIndependentContractor({
        id: window.generateRecordId("nhathau"),
        maNhaThau,
        tenNhaThau,
        member: row._leadMemberLookupData || {}
      });
      model.state.nhathau.push(foundNt);
      model.persistData("nhathau");
      latestNhaThauList.push(foundNt);
    } else if (foundNt.loaiNhaThau !== "Độc lập") {
      const dbNt = model.state.nhathau.find((n) => n.id === foundNt.id);
      if (dbNt) {
        dbNt.loaiNhaThau = "Độc lập";
        mergeContractorLookupData(dbNt, { ...row._leadMemberLookupData || {}, tenNhaThau });
        model.persistData("nhathau");
      }
    } else {
      const dbNt = model.state.nhathau.find((n) => n.id === foundNt.id) || foundNt;
      mergeContractorLookupData(dbNt, { ...row._leadMemberLookupData || {}, tenNhaThau });
      model.persistData("nhathau");
    }
    return foundNt;
  }
  if (!foundNt) {
    foundNt = createIndependentContractor({
      id: window.generateRecordId("nhathau"),
      maNhaThau,
      tenNhaThau: row._leadMemberName || `Thành viên đứng đầu ${maNhaThau}`,
      member: {
        ...row._leadMemberLookupData || {},
        tenNhaThau: row._leadMemberName || `Thành viên đứng đầu ${maNhaThau}`
      }
    });
    model.state.nhathau.push(foundNt);
    model.persistData("nhathau");
    latestNhaThauList.push(foundNt);
  } else if (row._leadMemberName && !isJointVentureType(foundNt.loaiNhaThau)) {
    const dbNt = model.state.nhathau.find((n) => n.id === foundNt.id);
    if (dbNt) {
      dbNt.tenNhaThau = row._leadMemberName;
      mergeContractorLookupData(dbNt, {
        ...row._leadMemberLookupData || {},
        tenNhaThau: row._leadMemberName
      });
      model.persistData("nhathau");
    }
  } else {
    const dbNt = model.state.nhathau.find((n) => n.id === foundNt.id) || foundNt;
    mergeContractorLookupData(dbNt, {
      ...row._leadMemberLookupData || {},
      tenNhaThau: row._leadMemberName
    });
    model.persistData("nhathau");
  }
  (row._thanhVienLienDanh || []).forEach((member) => {
    const memberCode = member.maNhaThau || member.maSoThue;
    if (!memberCode) return;
    let subNt = findLatestContractorByCode(latestNhaThauList, memberCode);
    if (!subNt) {
      subNt = createIndependentContractor({
        id: window.generateRecordId("nhathau"),
        maNhaThau: memberCode,
        tenNhaThau: member.tenNhaThau,
        member
      });
      model.state.nhathau.push(subNt);
      model.persistData("nhathau");
      latestNhaThauList.push(subNt);
    } else {
      const dbSubNt = model.state.nhathau.find((n) => n.id === subNt.id) || subNt;
      mergeContractorLookupData(dbSubNt, member);
      model.persistData("nhathau");
    }
  });
  return foundNt;
}
function collectJvMembers(row, foundNt, maNhaThau, contractorVersions, model, businessDate) {
  const bidJvMembers = [{
    thanhVienNhaThauId: foundNt?.id || "",
    tenNhaThau: foundNt?.tenNhaThau || row._leadMemberName || `Thành viên đứng đầu ${maNhaThau}`,
    maNhaThau: foundNt?.maNhaThau || maNhaThau,
    maSoThue: normalizeTaxCodeForStorage(foundNt?.maSoThue),
    vaiTro: "Đứng đầu liên danh",
    nguoiDaiDien: normalizePersonName(foundNt?.nguoiDaiDien || row._leadMemberLookupData?.nguoiDaiDien),
    danhXung: foundNt?.danhXung || row._leadMemberLookupData?.danhXung || "Ông",
    soDienThoai: foundNt?.soDienThoai || row._leadMemberLookupData?.soDienThoai || "",
    email: foundNt?.email || row._leadMemberLookupData?.email || "",
    diaChi: foundNt?.diaChi || row._leadMemberLookupData?.diaChi || "",
    diaChiGoc: foundNt?.diaChiGoc || row._leadMemberLookupData?.diaChiGoc || "",
    tenVietTat: foundNt?.tenVietTat || row._leadMemberLookupData?.tenVietTat || ""
  }];
  const rowMembers = Array.isArray(row._thanhVienLienDanh) ? row._thanhVienLienDanh : [];
  const fallbackMembers = Array.isArray(foundNt?.thanhVienLienDanh) ? foundNt.thanhVienLienDanh : [];
  const sourceMembers = rowMembers.length > 0 ? rowMembers : fallbackMembers;
  const seenCodes = new Set([normalizeOpeningCode(maNhaThau), normalizeOpeningCode(bidJvMembers[0].maSoThue)].filter(Boolean));
  sourceMembers.forEach((m) => {
    if (isLeadMember(m, maNhaThau)) return;
    const normalizedMemberCode = normalizeOpeningCode(m.maNhaThau || m.maSoThue);
    if (!normalizedMemberCode || seenCodes.has(normalizedMemberCode)) return;
    seenCodes.add(normalizedMemberCode);
    const exactMember = getExactContractorVersion(model, m.thanhVienNhaThauId);
    const candidate = exactMember || findLatestContractorByCode(contractorVersions, m.maNhaThau || m.maSoThue);
    const memberContractor = exactMember || (candidate ? selectContractorVersionForDate(model, candidate.id, businessDate) : null);
    bidJvMembers.push({
      thanhVienNhaThauId: memberContractor?.id || "",
      tenNhaThau: memberContractor?.tenNhaThau || m.tenNhaThau,
      maNhaThau: memberContractor?.maNhaThau || m.maNhaThau || m.maSoThue || "",
      maSoThue: normalizeTaxCodeForStorage(memberContractor?.maSoThue || m.maSoThue),
      vaiTro: "Thành viên liên danh",
      nguoiDaiDien: normalizePersonName(memberContractor?.nguoiDaiDien || m.nguoiDaiDien),
      danhXung: memberContractor?.danhXung || m.danhXung || "Ông",
      soDienThoai: memberContractor?.soDienThoai || m.soDienThoai || "",
      email: memberContractor?.email || m.email || "",
      diaChi: memberContractor?.diaChi || m.diaChi || "",
      diaChiGoc: memberContractor?.diaChiGoc || m.diaChiGoc || "",
      tenVietTat: memberContractor?.tenVietTat || m.tenVietTat || ""
    });
  });
  return bidJvMembers;
}
export function validateOpeningRows(rows) {
  const invalidInputs = [];
  let hasInvalid = false;
  rows.forEach((row) => {
    const inputMa = row.querySelector(".mt-ma-nha-thau");
    const inputTen = row.querySelector(".mt-ten-nha-thau");
    const maNhaThau = inputMa ? inputMa.value.trim() : "";
    const tenNhaThau = inputTen ? inputTen.value.trim() : "";
    let rowInvalid = false;
    if (!maNhaThau) {
      rowInvalid = true;
      if (inputMa) invalidInputs.push(inputMa);
    }
    if (!tenNhaThau) {
      rowInvalid = true;
      if (inputTen) invalidInputs.push(inputTen);
    }
    if (rowInvalid) {
      hasInvalid = true;
      row.classList.add("invalid");
    } else {
      row.classList.remove("invalid");
    }
  });
  return { valid: !hasInvalid, invalidInputs };
}
export function validateOpeningJointVentureMembers(rows) {
  const invalidInputs = [];
  let hasInvalid = false;
  rows.forEach((row) => {
    const leadInput = row.querySelector(".mt-ma-nha-thau");
    const seen = /* @__PURE__ */ new Set();
    let rowInvalid = false;
    const remember = (code) => {
      const normalized = normalizeOpeningCode(code);
      if (!normalized) return;
      if (seen.has(normalized)) {
        rowInvalid = true;
        return;
      }
      seen.add(normalized);
    };
    remember(leadInput?.value || "");
    (row._thanhVienLienDanh || []).forEach((member) => remember(member.maNhaThau || member.maSoThue));
    if (rowInvalid) {
      hasInvalid = true;
      if (leadInput) invalidInputs.push(leadInput);
      row.classList.add("invalid");
    } else {
      row.classList.remove("invalid");
    }
  });
  return { valid: !hasInvalid, invalidInputs };
}
export function collectOpeningBidsFromRows({ rows, gtId, model, isDirectOrSpecial }) {
  const latestNhaThauList = model.getLatestNhaThau();
  const gt = (model.state.goithau || []).find((item) => String(item.id) === String(gtId));
  const businessDate = gt?.thoiGianMoThau || gt?.thoiGianMoEhsdxtc || gt?.ngayQuyetDinh || gt?.createdAt || "";
  return Array.from(rows || []).map((row) => {
    const id = row.getAttribute("data-id");
    const maNhaThau = row.querySelector(".mt-ma-nha-thau")?.value.trim() || "";
    const tenNhaThau = row.querySelector(".mt-ten-nha-thau")?.value.trim() || "";
    const loaiNhaThau = row.querySelector(".mt-loai-nha-thau")?.value || "Độc lập";
    const foundNt = ensureContractor({ model, latestNhaThauList, maNhaThau, tenNhaThau, loaiNhaThau, row, businessDate });
    const isJointVenture = isJointVentureType(loaiNhaThau);
    const resolvedTenNhaThau = isJointVenture ? tenNhaThau : foundNt ? foundNt.tenNhaThau : tenNhaThau;
    const tyLeGiamGiaRaw = row.querySelector(".mt-ty-le-giam-gia")?.value || "0";
    const bidJvMembers = isJointVenture ? collectJvMembers(row, foundNt, maNhaThau, latestNhaThauList, model, businessDate) : [];
    return {
      id,
      goiThauId: gtId,
      nhaThauId: foundNt.id,
      maPhanLo: row.querySelector(".mt-ma-phan-lo")?.value || "",
      tenPhanLo: row.querySelector(".mt-ten-phan-lo")?.value.trim() || "",
      maDinhDanh: row.querySelector(".mt-ma-dinh-danh")?.value.trim() || "",
      giaDuThau: model.parseVND(row.querySelector(".mt-gia-du-thau")?.value || ""),
      damBaoDuThau: model.parseVND(row.querySelector(".mt-dam-bao-du-thau")?.value || ""),
      hieuLucDamBao: row.querySelector(".mt-hieu-luc-dam-bao")?.value.trim() || "",
      hieuLucHsdxt: row.querySelector(".mt-hieu-luc-hsdxt")?.value.trim() || "",
      tyLeGiamGia: parseFloat(tyLeGiamGiaRaw.replace(/,/g, ".")) || 0,
      giaSauGiamGia: model.parseVND(row.querySelector(".mt-gia-sau-giam-gia")?.value || ""),
      hieuLucHsdt: parseInt(row.querySelector(".mt-hieu-luc-hsdt")?.value || "0", 10),
      giaTriDamBao: model.parseVND(row.querySelector(".mt-gia-tri-dam-bao")?.value || ""),
      hieuLucBaoDamNgay: parseInt(row.querySelector(".mt-hieu-luc-bao-dam-ngay")?.value || "0", 10),
      thoiGianThucHien: row.querySelector(".mt-thoi-gian-thuc-hien")?.value.trim() || "",
      thoiGianThucHienHopDong: row.querySelector(".mt-thoi-gian-thuc-hien-hop-dong")?.value.trim() || "",
      tenNhaThau: resolvedTenNhaThau,
      loaiNhaThau,
      thanhVienLienDanh: bidJvMembers,
      danhGiaHopLe: isDirectOrSpecial ? "Đạt" : "",
      danhGiaNangLuc: isDirectOrSpecial ? "Đạt" : "",
      danhGiaKyThuat: isDirectOrSpecial ? "Đạt" : "",
      danhGiaKetLuan: isDirectOrSpecial ? "Đạt" : "",
      danhGiaTaiChinh: isDirectOrSpecial ? "Xếp hạng 1" : ""
    };
  });
}
