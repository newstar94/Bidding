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
  const source = String(criterion.source || "").trim().toLowerCase();
  const hasJointVentureName = name.startsWith("thoa thuan lien danh")
    && name.includes("doi voi nha thau lien danh");
  return code === "JV_AGREEMENT"
    || (code === "MSC_VALIDITY_2" && source !== "muasamcong")
    || hasJointVentureName;
}

function incrementAvailableSibling(parts, used) {
  const candidate = [...parts];
  let sibling = Number(candidate[candidate.length - 1]);
  do {
    sibling += 1;
    candidate[candidate.length - 1] = String(sibling);
  } while (used.has(candidate.join(".")));
  return candidate;
}

function normalizeUniqueSttByGroup(criteria = []) {
  const groupStates = new Map();
  const groupCounts = new Map();

  return criteria.map((criterion) => {
    const group = String(criterion.group || criterion.nhomDanhGia || "default");
    const nextNumber = (groupCounts.get(group) || 0) + 1;
    groupCounts.set(group, nextNumber);
    const rawStt = normalizedStt(criterion.stt || criterion.sourceStt, nextNumber);
    const rawParts = rawStt.split(".");
    const state = groupStates.get(group) || {
      used: new Set(),
      activePrefixes: new Map(),
    };
    groupStates.set(group, state);

    for (const prefix of state.activePrefixes.keys()) {
      if (prefix.split(".").length >= rawParts.length) {
        state.activePrefixes.delete(prefix);
      }
    }

    let assignedParts = [...rawParts];
    for (let depth = rawParts.length - 1; depth >= 1; depth -= 1) {
      const originalPrefix = rawParts.slice(0, depth).join(".");
      const assignedPrefix = state.activePrefixes.get(originalPrefix);
      if (assignedPrefix) {
        assignedParts = [...assignedPrefix.split("."), ...rawParts.slice(depth)];
        break;
      }
    }

    if (state.used.has(assignedParts.join("."))) {
      assignedParts = incrementAvailableSibling(assignedParts, state.used);
    }
    const assignedStt = assignedParts.join(".");
    state.used.add(assignedStt);
    state.activePrefixes.set(rawStt, assignedStt);
    return { ...criterion, stt: assignedStt };
  });
}

export function isJointVentureBid(bid = {}) {
  return normalizeText(bid.loaiNhaThau || bid.loai_nha_thau) === "lien danh";
}

export function adaptDetailedEvaluationCriteriaForBid(criteria = [], bid = {}) {
  const numbered = normalizeUniqueSttByGroup(criteria);
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
