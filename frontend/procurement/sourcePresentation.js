const SOURCE_HOST_PATTERN = /https?:\/\/(?:www\.)?muasamcong(?:\.mpi)?\.gov\.vn[^\s]*/giu;
const SOURCE_NAME_PATTERN = /Mua\s*Sắm\s*Công|MuaSamCong|\bMSC\b|\bVNEPS\b/giu;

export function presentAutomaticDataMessage(message, fallback = "") {
  const value = String(message ?? fallback);
  return value
    .replace(SOURCE_HOST_PATTERN, "dịch vụ lấy dữ liệu tự động")
    .replace(SOURCE_NAME_PATTERN, "dịch vụ lấy dữ liệu tự động");
}
