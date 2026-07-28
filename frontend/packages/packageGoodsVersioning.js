import { generateRecordId } from "../shared/idUtils.js";

export function assignNewPackageLotIds(pkg) {
  pkg.phanLoList = (pkg.phanLoList || []).map((lot) => ({
    ...lot,
    id: generateRecordId("phanlo"),
  }));
  return pkg;
}

export function clonePackageGoodsForSnapshot(goods, sourcePackage, targetPackage) {
  const sourceLotById = new Map((sourcePackage?.phanLoList || []).map((lot) => [String(lot.id), lot]));
  const targetLotByCode = new Map((targetPackage?.phanLoList || []).map((lot) => [String(lot.maPhanLo || "").trim().toLocaleLowerCase("vi"), lot]));
  return (goods || []).filter((item) => String(item.goiThauId) === String(sourcePackage?.id)).map((item) => {
    const sourceLot = sourceLotById.get(String(item.phanLoId || ""));
    const targetLot = sourceLot ? targetLotByCode.get(String(sourceLot.maPhanLo || "").trim().toLocaleLowerCase("vi")) : null;
    const clone = {
      ...item,
      id: generateRecordId("goithauhanghoa"),
      goiThauId: targetPackage.id,
      phanLoId: targetPackage.phanLo === "Có" ? (targetLot?.id || "") : null,
    };
    ["rowVersion", "syncVersion", "organizationId", "ownerType", "createdAt", "updatedAt", "expectedVersion"].forEach((key) => delete clone[key]);
    return clone;
  });
}
