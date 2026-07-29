export function normalizeBidderGoodsText(value) {
  return String(value ?? "")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[đĐ]/g, "d")
    .toLocaleLowerCase("vi")
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
}

function similarity(left, right) {
  const a = new Set(normalizeBidderGoodsText(left).split(" ").filter(Boolean));
  const b = new Set(normalizeBidderGoodsText(right).split(" ").filter(Boolean));
  if (!a.size || !b.size) return 0;
  const intersection = [...a].filter((token) => b.has(token)).length;
  return intersection / Math.max(a.size, b.size);
}

function sameScope(row, requirement) {
  return String(row.phanLoId || "") === String(requirement.phanLoId || "");
}

function sttIndex(value) {
  const match = String(value || "").trim().match(/(?:^|\.)(\d+)$/);
  return match ? Number(match[1]) - 1 : null;
}

export function mapBidderGoodsRows(rows = [], requirements = [], { existing = [] } = {}) {
  const existingBySource = new Map(existing.map((row) => [
    `${row.phanLoId || ""}::${String(row.sttNguon || "").trim()}`,
    row,
  ]));
  const used = new Set();
  const mapped = rows.map((source) => {
    if (["lot_not_found", "wrong_lot"].includes(source.mappingStatus)) {
      return { ...source, goiThauHangHoaId: null, mappingMethod: "unmatched" };
    }
    const candidates = requirements.filter((item) => sameScope(source, item));
    const prior = existingBySource.get(`${source.phanLoId || ""}::${String(source.sttNguon || "").trim()}`);
    let selected = prior?.goiThauHangHoaId
      ? candidates.find((item) => String(item.id) === String(prior.goiThauHangHoaId))
      : null;
    let method = selected ? prior.mappingMethod || "manual" : "unmatched";
    const index = sttIndex(source.sttNguon);
    if (!selected && index !== null && index < candidates.length) {
      const ordered = [...candidates].sort((a, b) => Number(a.sortOrder || 0) - Number(b.sortOrder || 0));
      const orderedCandidate = ordered[index];
      if (orderedCandidate && normalizeBidderGoodsText(orderedCandidate.tenHangHoa) === normalizeBidderGoodsText(source.danhMucHangHoa)) {
        selected = orderedCandidate;
        method = "auto";
      }
    }
    if (!selected) {
      const exact = candidates.filter((item) => normalizeBidderGoodsText(item.tenHangHoa) === normalizeBidderGoodsText(source.danhMucHangHoa));
      if (exact.length === 1) {
        selected = exact[0];
        method = "auto";
      } else if (exact.length > 1) {
        const refined = exact.filter((item) => (
          normalizeBidderGoodsText(item.donViTinh) === normalizeBidderGoodsText(source.donViTinh)
          && Number(item.soLuong) === Number(source.khoiLuong)
        ));
        if (refined.length === 1) {
          selected = refined[0];
          method = "auto";
        }
      }
    }
    if (!selected) {
      const scored = candidates
        .map((item) => ({ item, score: similarity(item.tenHangHoa, source.danhMucHangHoa) }))
        .filter(({ score }) => score >= 0.9)
        .sort((a, b) => b.score - a.score);
      if (scored.length === 1 || (scored[0] && scored[0].score - (scored[1]?.score || 0) >= 0.15)) {
        selected = scored[0]?.item || null;
        if (selected) method = "auto";
      }
    }
    const selectedId = selected?.id || null;
    const duplicate = Boolean(selectedId && used.has(String(selectedId)));
    if (selectedId) used.add(String(selectedId));
    return {
      ...source,
      goiThauHangHoaId: selectedId,
      mappingMethod: selected ? method : "unmatched",
      mappingStatus: duplicate ? "duplicate" : selected ? "matched" : "unmatched",
    };
  });
  return mapped;
}

export function applyManualBidderGoodsMapping(rows, rowId, requirementId) {
  return rows.map((row) => {
    if (String(row.id) !== String(rowId)) return row;
    return {
      ...row,
      goiThauHangHoaId: requirementId || null,
      mappingMethod: requirementId ? "manual" : "unmatched",
      mappingStatus: requirementId ? "matched" : "unmatched",
    };
  }).map((row, _index, allRows) => {
    if (!row.goiThauHangHoaId) return row;
    const count = allRows.filter((item) => String(item.goiThauHangHoaId || "") === String(row.goiThauHangHoaId)).length;
    return { ...row, mappingStatus: count > 1 ? "duplicate" : "matched" };
  });
}
