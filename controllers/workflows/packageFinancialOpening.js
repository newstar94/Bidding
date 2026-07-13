import { persistAndSync } from "../domain/MutationService.js";

export async function savePackageFinancialOpening(controller, pkg, bidUpdates, { openingTime } = {}) {
  const updates = new Map((bidUpdates || []).map((update) => [String(update.id), update]));
  (controller.model.state.thongtinmothau || []).forEach((bid) => {
    const update = updates.get(String(bid.id));
    if (!update) return;
    bid.giaDuThau = update.giaDuThau;
    bid.tyLeGiamGia = update.tyLeGiamGia;
    bid.giaSauGiamGia = update.giaSauGiamGia;
    if (update.hieuLucHsdt != null) {
      bid.hieuLucHsdt = update.hieuLucHsdt;
    } else if (pkg.linhVuc === "Tư vấn") {
      bid.hieuLucHsdt = Number.parseInt(bid.hieuLucHsdxt, 10) || 0;
    }
  });
  pkg.thoiGianMoEhsdxtc = openingTime || pkg.thoiGianMoEhsdxtc || controller.model.getCurrentDateTimeString();
  await persistAndSync(controller, ["thongtinmothau", "goithau"]);
  return pkg;
}
