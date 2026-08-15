import { supportsGoodsWorkflow } from "./goodsWorkflowSupport.js";
import { normalizeStatus } from "./LifecyclePolicy.js";

export function normalizeGoodsCode(value) {
  return String(value || "").trim().toLocaleLowerCase("vi");
}

export function validatePackageGoodsItem(item, { pkg, lots = [] } = {}) {
  const errors = [];
  if (!String(item?.maHangHoa || "").trim()) errors.push("Thiếu mã hàng hóa.");
  if (!String(item?.tenHangHoa || "").trim()) errors.push("Thiếu tên hàng hóa.");
  if (!String(item?.donViTinh || "").trim()) errors.push("Thiếu đơn vị tính.");
  const quantity = Number(item?.soLuong);
  if (!Number.isFinite(quantity) || quantity <= 0) errors.push("Số lượng phải là số lớn hơn 0.");
  for (const [key, label] of [["donGiaDuToan", "Đơn giá dự toán"], ["thanhTienDuToan", "Thành tiền dự toán"]]) {
    const raw = item?.[key];
    if (raw !== "" && raw != null && (!Number.isFinite(Number(raw)) || Number(raw) < 0)) {
      errors.push(`${label} phải là số không âm.`);
    }
  }
  const isLotted = pkg?.phanLo === "Có";
  if (isLotted && !item?.phanLoId) errors.push("Chưa xác định phần lô.");
  if (!isLotted && item?.phanLoId) errors.push("Gói không phân lô không được chứa phần lô.");
  if (item?.phanLoId && !lots.some((lot) => String(lot.id) === String(item.phanLoId))) {
    errors.push("Phần lô không thuộc gói thầu hiện tại.");
  }
  return errors;
}

export function findDuplicateGoodsCodes(items) {
  const seen = new Map();
  const duplicates = new Set();
  (items || []).forEach((item) => {
    const key = `${item?.phanLoId || ""}::${normalizeGoodsCode(item?.maHangHoa)}`;
    if (!normalizeGoodsCode(item?.maHangHoa)) return;
    if (seen.has(key)) duplicates.add(key);
    else seen.set(key, item?.id || key);
  });
  return duplicates;
}

export function isPackageGoodsEditable(pkg) {
  return supportsGoodsWorkflow(pkg)
    && ["PREPARING", "INVITED"].includes(normalizeStatus(pkg?.trangThai));
}

export function isPackageGoodsDeletable(pkg) {
  return supportsGoodsWorkflow(pkg) && normalizeStatus(pkg?.trangThai) === "PREPARING";
}
