import { resolveBidContractorName } from "../partners/contractorVersionBinding.js";
import { divideMoneyByQuantity } from "./bidderGoodsPreference.js";
import { supportsGoodsWorkflow } from "./goodsWorkflowSupport.js";

function id(value) {
  return String(value ?? "").trim();
}

function lotCode(value) {
  return id(value).toLocaleLowerCase("vi").replace(/\s+/g, " ");
}

function isArchived(record) {
  return Boolean(record?.archivedAt || record?.archived_at || record?.deletedAt || record?.deleted_at);
}

function lotLabel(lot) {
  return [id(lot?.maPhanLo), id(lot?.tenPhanLo)].filter(Boolean).join(" - ") || id(lot?.id) || "không rõ";
}

function contractorLabel(model, opening, winnerId, nameResolver) {
  const resolved = nameResolver(model, opening);
  if (id(resolved)) return id(resolved);
  const contractor = (model?.state?.nhathau || []).find((item) => id(item?.id) === id(winnerId));
  return id(contractor?.tenNhaThau || opening?.tenNhaThau) || `ID ${winnerId}`;
}

function exactNonNegativeDecimal(value, label) {
  const text = id(value).replace(",", ".");
  if (!/^\d+(?:\.\d+)?$/.test(text)) throw new RangeError(`${label} phải là số không âm.`);
  const [whole, fraction = ""] = text.split(".");
  const normalizedWhole = whole.replace(/^0+(?=\d)/, "") || "0";
  const normalizedFraction = fraction.replace(/0+$/, "");
  return normalizedFraction ? `${normalizedWhole}.${normalizedFraction}` : normalizedWhole;
}

export function winningUnitPrice(row) {
  const hasAllocatedBase = row?.giaTriCoSoSauGiamGia !== undefined
    && row?.giaTriCoSoSauGiamGia !== null
    && id(row.giaTriCoSoSauGiamGia) !== "";
  if (hasAllocatedBase) {
    return divideMoneyByQuantity(row.giaTriCoSoSauGiamGia, row.khoiLuong);
  }
  if (row?.donGiaDuThau === undefined || row?.donGiaDuThau === null || id(row.donGiaDuThau) === "") {
    throw new RangeError("Thiếu giá trị sau giảm giá và đơn giá dự thầu.");
  }
  return exactNonNegativeDecimal(row.donGiaDuThau, "Đơn giá dự thầu");
}

function compareRows(left, right) {
  const leftOrder = Number(left?.sortOrder);
  const rightOrder = Number(right?.sortOrder);
  const normalizedLeft = Number.isFinite(leftOrder) ? leftOrder : Number.MAX_SAFE_INTEGER;
  const normalizedRight = Number.isFinite(rightOrder) ? rightOrder : Number.MAX_SAFE_INTEGER;
  return normalizedLeft - normalizedRight
    || id(left?.sttNguon).localeCompare(id(right?.sttNguon), "vi", { numeric: true })
    || id(left?.id).localeCompare(id(right?.id), "vi", { numeric: true });
}

function uniqueRows(rows) {
  const seen = new Set();
  return rows.filter((row) => {
    const key = id(row?.id) || `${id(row?.thongTinMoThauId)}::${id(row?.goiThauHangHoaId)}`;
    if (!key || seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

function projectRows(rows, contextLabel) {
  return uniqueRows(rows).sort(compareRows).map((row, index) => {
    let donGiaTrungThau;
    try {
      donGiaTrungThau = winningUnitPrice(row);
    } catch (error) {
      throw new Error(`${contextLabel}: không xác định được đơn giá trúng thầu của hàng hóa ${id(row?.danhMucHangHoa) || id(row?.id) || index + 1}. ${error.message}`);
    }
    return {
      id: id(row?.id),
      stt: id(row?.sttNguon) || String(index + 1),
      danhMucHangHoa: id(row?.danhMucHangHoa),
      kyMaHieu: id(row?.kyMaHieu),
      nhanHieu: id(row?.nhanHieu),
      namSanXuat: id(row?.namSanXuat),
      xuatXu: id(row?.xuatXu),
      hangSanXuat: id(row?.hangSanXuat),
      cauHinhTinhNangKyThuat: id(row?.cauHinhTinhNangKyThuat),
      donViTinh: id(row?.donViTinh),
      khoiLuong: row?.khoiLuong,
      maHs: id(row?.maHs),
      donGiaTrungThau,
    };
  });
}

function openingForScope({ pkg, lot, winnerId, openings }) {
  const packageId = id(pkg?.id);
  const winner = id(winnerId);
  const expectedLotId = id(lot?.id);
  const expectedLotCode = lotCode(lot?.maPhanLo);
  const matches = openings.filter((opening) => {
    if (isArchived(opening) || id(opening?.goiThauId) !== packageId || id(opening?.nhaThauId) !== winner) return false;
    const openingLotId = id(opening?.phanLoId);
    const openingLotCode = lotCode(opening?.maPhanLo);
    if (!lot) return !openingLotId && !openingLotCode;
    if (openingLotId) return openingLotId === expectedLotId;
    return Boolean(expectedLotCode && openingLotCode === expectedLotCode);
  });
  if (matches.length === 0) {
    throw new Error(`Nhà thầu ${winner}${lot ? ` tại phần (lô) ${lotLabel(lot)}` : ""}: không tìm thấy hồ sơ mở thầu tương ứng.`);
  }
  if (matches.length > 1) {
    throw new Error(`Nhà thầu ${winner}${lot ? ` tại phần (lô) ${lotLabel(lot)}` : ""}: có nhiều hồ sơ mở thầu không thể phân biệt.`);
  }
  return matches[0];
}

function goodsForScope({ pkg, lot, opening, goods, contractorName }) {
  const packageId = id(pkg?.id);
  const openingId = id(opening?.id);
  const expectedLotId = id(lot?.id);
  const scoped = goods.filter((row) => (
    id(row?.goiThauId) === packageId
    && id(row?.thongTinMoThauId) === openingId
    && (lot ? id(row?.phanLoId) === expectedLotId : !id(row?.phanLoId))
  ));
  const contextLabel = `Nhà thầu ${contractorName}${lot ? `, phần (lô) ${lotLabel(lot)}` : ""}`;
  if (scoped.some((row) => row?.isDraft !== false)) {
    throw new Error(`${contextLabel}: còn hàng hóa bản nháp; hãy lưu chính thức danh mục hàng hóa dự thầu trước khi xuất.`);
  }
  const official = scoped.filter((row) => row?.isDraft === false);
  if (official.length === 0) {
    throw new Error(`${contextLabel}: không có hàng hóa dự thầu chính thức; hãy lưu chính thức danh mục hàng hóa dự thầu trước khi xuất.`);
  }
  return projectRows(official, contextLabel);
}

export function selectWinningGoodsForExport({
  pkg,
  openings = [],
  goods = [],
  model = null,
  nameResolver = resolveBidContractorName,
} = {}) {
  if (!pkg || !supportsGoodsWorkflow(pkg)) {
    throw new Error("Chức năng xuất hàng hóa trúng thầu chỉ áp dụng cho gói Hàng hóa hoặc Hỗn hợp.");
  }
  const packageId = id(pkg.id);
  if (!packageId) throw new Error("Không xác định được gói thầu cần xuất.");
  const packageOpenings = (openings || []).filter((opening) => id(opening?.goiThauId) === packageId);
  const packageGoods = (goods || []).filter((row) => id(row?.goiThauId) === packageId);
  const isLotted = id(pkg.phanLo) === "Có";
  const scopes = isLotted
    ? (pkg.phanLoList || []).filter((lot) => id(lot?.nhaThauTrungThauId)).map((lot) => ({ lot, winnerId: id(lot.nhaThauTrungThauId) }))
    : [{ lot: null, winnerId: id(pkg.nhaThauTrungThauId) }].filter((scope) => scope.winnerId);
  if (scopes.length === 0) throw new Error("Gói thầu chưa có kết quả trúng thầu chính thức để xuất.");
  if (isLotted && id(pkg.nhaThauTrungThauId) && scopes.some((scope) => scope.winnerId !== id(pkg.nhaThauTrungThauId))) {
    throw new Error("Nhà thầu trúng thầu cấp gói mâu thuẫn với kết quả trúng thầu theo phần lô.");
  }

  const groups = [];
  const byWinner = new Map();
  scopes.forEach(({ lot, winnerId }) => {
    const opening = openingForScope({ pkg, lot, winnerId, openings: packageOpenings });
    const contractorName = contractorLabel(model, opening, winnerId, nameResolver);
    const rows = goodsForScope({ pkg, lot, opening, goods: packageGoods, contractorName });
    let group = byWinner.get(winnerId);
    if (!group) {
      group = { contractorId: winnerId, contractorName, lots: [] };
      byWinner.set(winnerId, group);
      groups.push(group);
    }
    group.lots.push({
      lotId: id(lot?.id),
      lotCode: id(lot?.maPhanLo),
      lotName: id(lot?.tenPhanLo),
      openingId: id(opening?.id),
      rows,
    });
  });
  return {
    packageId,
    packageCode: id(pkg.maGoiThau),
    packageName: id(pkg.tenGoiThau),
    isLotted,
    groups,
  };
}

export function hasWinningGoodsExportScope(pkg) {
  if (!supportsGoodsWorkflow(pkg)) return false;
  if (id(pkg?.phanLo) === "Có") {
    return (pkg?.phanLoList || []).some((lot) => id(lot?.nhaThauTrungThauId));
  }
  return Boolean(id(pkg?.nhaThauTrungThauId));
}
