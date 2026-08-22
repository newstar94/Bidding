import { authFetchDownload } from "../shared/view_helpers.js";

function safeFilename(value) {
  return String(value || "goi_thau")
    .trim()
    .replace(/[<>:"/\\|?*\x00-\x1F]/g, "_")
    .replace(/[. ]+$/g, "")
    .slice(0, 120) || "goi_thau";
}

export async function downloadOfficialWinningGoodsWorkbook({
  packageId,
  packageCode = "goi_thau",
  expectedRevision,
  downloadImpl = authFetchDownload,
} = {}) {
  const normalizedPackageId = String(packageId || "").trim();
  const revision = Number(expectedRevision);
  if (!normalizedPackageId) throw new TypeError("Thiếu gói thầu cần xuất.");
  if (!Number.isInteger(revision) || revision < 1) {
    throw new TypeError("Thiếu phiên bản gói thầu hợp lệ để xuất.");
  }
  const url = `/api/packages/${encodeURIComponent(normalizedPackageId)}/winning-goods.xlsx?expectedRevision=${revision}`;
  const filename = `Danh_sach_hang_hoa_trung_thau_${safeFilename(packageCode)}.xlsx`;
  await downloadImpl(url, filename);
  return { filename };
}
