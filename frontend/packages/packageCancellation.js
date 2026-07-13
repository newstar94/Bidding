import { mutatePersistAndSync } from "../shared/MutationService.js";

function parseMetadata(value) {
  try {
    return value ? JSON.parse(value) : {};
  } catch {
    return {};
  }
}

export async function savePackageCancellation(controller, pkg, details) {
  const metadata = parseMetadata(pkg.danhGiaHsdtMetadata);
  metadata.cancelDetails = metadata.cancelDetails || {};
  if (!metadata.cancelDetails.trangThaiTruocHuy && pkg.trangThai !== "Hủy thầu") {
    metadata.cancelDetails.trangThaiTruocHuy = pkg.trangThai;
  }
  metadata.cancelDetails.soQuyetDinhHuyThau = details.decisionNumber;
  metadata.cancelDetails.ngayQuyetDinhHuyThau = details.decisionDate;
  metadata.cancelDetails.lyDoHuyThau = details.reason;
  const updatedPackage = {
    ...pkg,
    danhGiaHsdtMetadata: JSON.stringify(metadata),
    trangThai: "Hủy thầu"
  };
  return mutatePersistAndSync(controller, { upserts: { goithau: updatedPackage } }, {
    afterPersist: () => controller.view.renderGoiThauTable()
  });
}
