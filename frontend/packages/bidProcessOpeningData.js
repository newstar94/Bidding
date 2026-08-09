import { normalizePersonName, normalizeTaxCodeForCompare, normalizeVietnamTaxCode } from "../app/domUtils.js";
import { getExactContractorVersion, selectContractorVersionForDate } from "../partners/contractorVersionBinding.js";
import { preserveRowVersion } from "../shared/VersionedEntityService.js";
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
function ensureContractor({
  model,
  latestNhaThauList,
  maNhaThau,
  tenNhaThau,
  loaiNhaThau,
  row,
  businessDate,
  changedContractors,
}) {
  const bound = getExactContractorVersion(model, row.dataset.contractorVersionId);
  const boundMatchesCode = bound && normalizeOpeningCode(bound.maNhaThau || bound.maSoThue) === normalizeOpeningCode(maNhaThau);
  const candidate = boundMatchesCode ? bound : findLatestContractorByCode(latestNhaThauList, maNhaThau);
  let foundNt = boundMatchesCode ? bound : candidate ? selectContractorVersionForDate(model, candidate.id, businessDate) : null;
  if (!isJointVentureType(loaiNhaThau)) {
    if (!foundNt) {
      foundNt = createIndependentContractor({
        id: generateRecordId("nhathau"),
        maNhaThau,
        tenNhaThau,
        member: row._leadMemberLookupData || {}
      });
      model.state.nhathau.push(foundNt);
      changedContractors.push(foundNt);
      latestNhaThauList.push(foundNt);
    }
    return foundNt;
  }
  if (!foundNt) {
    foundNt = createIndependentContractor({
      id: generateRecordId("nhathau"),
      maNhaThau,
      tenNhaThau: row._leadMemberName || `Thành viên đứng đầu ${maNhaThau}`,
      member: {
        ...row._leadMemberLookupData || {},
        tenNhaThau: row._leadMemberName || `Thành viên đứng đầu ${maNhaThau}`
      }
    });
    model.state.nhathau.push(foundNt);
    changedContractors.push(foundNt);
    latestNhaThauList.push(foundNt);
  }
  (row._thanhVienLienDanh || []).forEach((member) => {
    const memberCode = member.maNhaThau || member.maSoThue;
    if (!memberCode) return;
    let subNt = findLatestContractorByCode(latestNhaThauList, memberCode);
    if (!subNt) {
      subNt = createIndependentContractor({
        id: generateRecordId("nhathau"),
        maNhaThau: memberCode,
        tenNhaThau: member.tenNhaThau,
        member
      });
      model.state.nhathau.push(subNt);
      changedContractors.push(subNt);
      latestNhaThauList.push(subNt);
    }
  });
  return foundNt;
}
function collectJvMembers(row, foundNt, maNhaThau, contractorVersions, model, businessDate) {
  const memberChildId = (candidateId, contractorId) => {
    const candidate = String(candidateId || "").trim();
    const contractor = String(contractorId || "").trim();
    return candidate && candidate !== contractor ? candidate : generateRecordId("member");
  };
  const bidJvMembers = [{
    id: memberChildId(row._leadMemberId, foundNt?.id),
    thanhVienNhaThauId: foundNt?.id || "",
    tenNhaThau: row._leadMemberName || foundNt?.tenNhaThau || `Thành viên đứng đầu ${maNhaThau}`,
    maNhaThau: row._leadMemberLookupData?.maNhaThau || foundNt?.maNhaThau || maNhaThau,
    maSoThue: normalizeTaxCodeForStorage(row._leadMemberLookupData?.maSoThue || foundNt?.maSoThue),
    vaiTro: "Đứng đầu liên danh",
    nguoiDaiDien: normalizePersonName(row._leadMemberLookupData?.nguoiDaiDien || foundNt?.nguoiDaiDien),
    danhXung: row._leadMemberLookupData?.danhXung || foundNt?.danhXung || "Ông",
    soDienThoai: row._leadMemberLookupData?.soDienThoai || foundNt?.soDienThoai || "",
    email: row._leadMemberLookupData?.email || foundNt?.email || "",
    diaChi: row._leadMemberLookupData?.diaChi || foundNt?.diaChi || "",
    diaChiGoc: row._leadMemberLookupData?.diaChiGoc || foundNt?.diaChiGoc || "",
    tenVietTat: row._leadMemberLookupData?.tenVietTat || foundNt?.tenVietTat || "",
    violationStatus: row._leadMemberViolationStatus || "NOT_CHECKED"
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
      id: memberChildId(m.id, memberContractor?.id),
      thanhVienNhaThauId: memberContractor?.id || "",
      tenNhaThau: m.tenNhaThau || memberContractor?.tenNhaThau,
      maNhaThau: m.maNhaThau || m.maSoThue || memberContractor?.maNhaThau || "",
      maSoThue: normalizeTaxCodeForStorage(m.maSoThue || memberContractor?.maSoThue),
      vaiTro: "Thành viên liên danh",
      nguoiDaiDien: normalizePersonName(m.nguoiDaiDien || memberContractor?.nguoiDaiDien),
      danhXung: m.danhXung || memberContractor?.danhXung || "Ông",
      soDienThoai: m.soDienThoai || memberContractor?.soDienThoai || "",
      email: m.email || memberContractor?.email || "",
      diaChi: m.diaChi || memberContractor?.diaChi || "",
      diaChiGoc: m.diaChiGoc || memberContractor?.diaChiGoc || "",
      tenVietTat: m.tenVietTat || memberContractor?.tenVietTat || "",
      violationStatus: m.violationStatus || "NOT_CHECKED"
    });
  });
  return bidJvMembers;
}
export function validateOpeningRows(rows) {
  const invalidInputs = [];
  const missingBidPriceInputs = [];
  let hasInvalid = false;
  rows.forEach((row) => {
    const inputMa = row.querySelector(".mt-ma-nha-thau");
    const inputTen = row.querySelector(".mt-ten-nha-thau");
    const inputBidPrice = row.querySelector(".mt-gia-du-thau");
    const maNhaThau = inputMa ? inputMa.value.trim() : "";
    const tenNhaThau = inputTen ? inputTen.value.trim() : "";
    const bidPriceRaw = inputBidPrice ? String(inputBidPrice.value || "").trim() : "";
    const bidPriceDigits = inputBidPrice
      ? bidPriceRaw.replace(/[^0-9]/g, "")
      : "";
    let rowInvalid = false;
    if (!maNhaThau) {
      rowInvalid = true;
      if (inputMa) invalidInputs.push(inputMa);
    }
    if (!tenNhaThau) {
      rowInvalid = true;
      if (inputTen) invalidInputs.push(inputTen);
    }
    if (inputBidPrice && (
      bidPriceRaw.startsWith("-")
      || !bidPriceDigits
      || Number(bidPriceDigits) <= 0
    )) {
      rowInvalid = true;
      missingBidPriceInputs.push(inputBidPrice);
    }
    if (rowInvalid) {
      hasInvalid = true;
      row.classList.add("invalid");
    } else {
      row.classList.remove("invalid");
    }
  });
  return {
    valid: !hasInvalid,
    invalidInputs,
    missingBidPriceInputs,
  };
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
export function validateOpeningParticipantScopes(bids, contractors = []) {
  const rootsById = new Map((contractors || []).map((contractor) => [
    String(contractor?.id || ""),
    String(contractor?.rootId || contractor?.idGoc || contractor?.id || "")
  ]));
  const occupied = new Map();
  for (const bid of bids || []) {
    const packageId = String(bid?.goiThauId || "").trim();
    const lotScope = String(bid?.maPhanLo || "").trim().toLocaleLowerCase("vi-VN").replace(/\s+/g, " ") || "__PACKAGE__";
    const participantIds = isJointVentureType(bid?.loaiNhaThau)
      ? (bid?.thanhVienLienDanh || []).map((member) => member?.thanhVienNhaThauId).filter(Boolean)
      : [bid?.nhaThauId].filter(Boolean);
    for (const participantId of participantIds) {
      const rootId = rootsById.get(String(participantId)) || String(participantId);
      const key = `${packageId}\u0000${lotScope}\u0000${rootId}`;
      if (occupied.has(key)) {
        return { valid: false, bid, conflictingBid: occupied.get(key), lotScope };
      }
      occupied.set(key, bid);
    }
  }
  return { valid: true };
}
export function collectOpeningBidsFromRows({
  rows,
  gtId,
  model,
  isDirectOrSpecial,
  changedContractors = [],
}) {
  const latestNhaThauList = model.getLatestNhaThau();
  const gt = (model.state.goithau || []).find((item) => String(item.id) === String(gtId));
  const businessDate = gt?.thoiGianMoThau || gt?.thoiGianMoEhsdxtc || gt?.ngayQuyetDinh || gt?.createdAt || "";
  return Array.from(rows || []).map((row) => {
    const id = row.getAttribute("data-id");
    const maNhaThau = row.querySelector(".mt-ma-nha-thau")?.value.trim() || "";
    const tenNhaThau = row.querySelector(".mt-ten-nha-thau")?.value.trim() || "";
    const loaiNhaThau = row.querySelector(".mt-loai-nha-thau")?.value || "Độc lập";
    const foundNt = ensureContractor({
      model,
      latestNhaThauList,
      maNhaThau,
      tenNhaThau,
      loaiNhaThau,
      row,
      businessDate,
      changedContractors,
    });
    const isJointVenture = isJointVentureType(loaiNhaThau);
    const resolvedTenNhaThau = tenNhaThau || foundNt?.tenNhaThau || "";
    const tyLeGiamGiaRaw = row.querySelector(".mt-ty-le-giam-gia")?.value || "0";
    const bidJvMembers = isJointVenture ? collectJvMembers(row, foundNt, maNhaThau, latestNhaThauList, model, businessDate) : [];
    const bid = {
      id,
      goiThauId: gtId,
      nhaThauId: foundNt.id,
      maPhanLo: row.querySelector(".mt-ma-phan-lo")?.value || "",
      tenPhanLo: row.querySelector(".mt-ten-phan-lo")?.value.trim() || "",
      maDinhDanh: row.querySelector(".mt-ma-dinh-danh")?.value.trim() || "",
      giaDuThau: model.parseVND(row.querySelector(".mt-gia-du-thau")?.value || ""),
      tyLeGiamGia: parseFloat(tyLeGiamGiaRaw.replace(/,/g, ".")) || 0,
      giaSauGiamGia: model.parseVND(row.querySelector(".mt-gia-sau-giam-gia")?.value || ""),
      hieuLucHsdt: parseInt(row.querySelector(".mt-hieu-luc-hsdt, .mt-hieu-luc-hsdxt")?.value || "0", 10),
      giaTriDamBao: model.parseVND(row.querySelector(".mt-gia-tri-dam-bao, .mt-dam-bao-du-thau")?.value || ""),
      hieuLucBaoDamNgay: parseInt(row.querySelector(".mt-hieu-luc-bao-dam-ngay, .mt-hieu-luc-dam-bao")?.value || "0", 10),
      thoiGianThucHien: row.querySelector(".mt-thoi-gian-thuc-hien")?.value.trim() || "",
      thoiGianThucHienHopDong: row.querySelector(".mt-thoi-gian-thuc-hien-hop-dong")?.value.trim() || "",
      tenNhaThau: resolvedTenNhaThau,
      loaiNhaThau,
      thanhVienLienDanh: bidJvMembers,
      violationStatus: row._violationStatus || "NOT_CHECKED",
      danhGiaHopLe: isDirectOrSpecial ? "Đạt" : "",
      danhGiaNangLuc: isDirectOrSpecial ? "Đạt" : "",
      danhGiaKyThuat: isDirectOrSpecial ? "Đạt" : "",
      danhGiaKetLuan: isDirectOrSpecial ? "Đạt" : "",
      danhGiaTaiChinh: isDirectOrSpecial ? "Xếp hạng 1" : ""
    };
    const currentBid = (model.state.thongtinmothau || []).find(
      (item) => String(item.id) === String(id)
    );
    return preserveRowVersion(bid, currentBid);
  });
}
import { generateRecordId } from "../shared/idUtils.js";
