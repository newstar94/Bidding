const SOURCE_HOST_PATTERN = /https?:\/\/(?:www\.)?muasamcong(?:\.mpi)?\.gov\.vn[^\s]*/giu;
const SOURCE_NAME_PATTERN = /Mua\s*Sắm\s*Công|MuaSamCong|\bMSC\b|\bVNEPS\b/giu;

export function presentAutomaticDataMessage(message, fallback = "") {
  const value = String(message ?? fallback);
  return value
    .replace(SOURCE_HOST_PATTERN, "dịch vụ lấy dữ liệu tự động")
    .replace(SOURCE_NAME_PATTERN, "dịch vụ lấy dữ liệu tự động");
}

// Catalog copy only; stored records and source URLs retain their original values.
export function presentAutomaticDataLabel(value) {
  return String(value ?? "")
    .replace(/lấy\s+(?:dữ liệu|hồ sơ)(?:\s+từ)?\s+Mua\s*Sắm\s*Công/giu, "lấy dữ liệu tự động")
    .replace(/dữ liệu\s+Mua\s*Sắm\s*Công/giu, "dữ liệu tự động")
    .replace(/Mua\s*Sắm\s*Công/giu, "lấy dữ liệu tự động");
}
