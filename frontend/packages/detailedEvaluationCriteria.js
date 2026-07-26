function normalizeText(value) {
  return String(value ?? "")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLocaleLowerCase("vi")
    .replace(/đ/g, "d")
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
}

function normalizedStt(value, fallback) {
  const stt = String(value ?? "").trim().replace(/\.$/, "");
  return /^\d+(?:\.\d+)*$/.test(stt) ? stt : String(fallback);
}

function isJointVentureCriterion(criterion = {}) {
  const code = String(criterion.code || criterion.maTieuChi || "").toUpperCase();
  const name = normalizeText(criterion.name || criterion.tenTieuChi);
  return code === "JV_AGREEMENT"
    || (name.startsWith("thoa thuan lien danh")
      && name.includes("doi voi nha thau lien danh"));
}

export function isJointVentureBid(bid = {}) {
  return normalizeText(bid.loaiNhaThau || bid.loai_nha_thau) === "lien danh";
}

export function adaptDetailedEvaluationCriteriaForBid(criteria = [], bid = {}) {
  const groupCounts = new Map();
  const numbered = criteria.map((criterion) => {
    const group = String(criterion.group || criterion.nhomDanhGia || "default");
    const nextNumber = (groupCounts.get(group) || 0) + 1;
    groupCounts.set(group, nextNumber);
    return {
      ...criterion,
      stt: normalizedStt(criterion.stt || criterion.sourceStt, nextNumber),
    };
  });
  const bidderType = normalizeText(bid.loaiNhaThau || bid.loai_nha_thau);
  if (!bidderType || isJointVentureBid(bid)) return numbered;

  const jointVentureCriterion = numbered.find(isJointVentureCriterion);
  if (!jointVentureCriterion) return numbered;
  const removedTopLevel = Number(jointVentureCriterion.stt.split(".")[0]);
  const jointVentureGroup = String(
    jointVentureCriterion.group || jointVentureCriterion.nhomDanhGia || "default",
  );

  return numbered
    .filter((criterion) => !isJointVentureCriterion(criterion))
    .map((criterion) => {
      const parts = criterion.stt.split(".");
      const topLevel = Number(parts[0]);
      const group = String(criterion.group || criterion.nhomDanhGia || "default");
      if (group === jointVentureGroup
        && Number.isInteger(topLevel)
        && topLevel > removedTopLevel) {
        parts[0] = String(topLevel - 1);
      }
      return { ...criterion, stt: parts.join(".") };
    });
}
