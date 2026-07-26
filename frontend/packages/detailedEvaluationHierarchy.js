function sttParts(criterion = {}) {
  const stt = String(criterion.stt || criterion.sourceStt || "").trim().replace(/\.$/, "");
  return /^\d+(?:\.\d+)*$/.test(stt) ? stt.split(".") : [];
}

function directChildren(criteria, parent) {
  const parentParts = sttParts(parent);
  if (parentParts.length === 0) return [];
  return criteria.filter((candidate) => {
    if (candidate.group !== parent.group || candidate.id === parent.id) return false;
    const candidateParts = sttParts(candidate);
    return candidateParts.length === parentParts.length + 1
      && parentParts.every((part, index) => candidateParts[index] === part);
  });
}

function aggregateChildResults(results) {
  if (results.some((result) => result === "fail")) return "fail";
  if (results.length > 0
    && results.every((result) => result === "pass" || result === "not_applicable")) {
    return "pass";
  }
  return "pending";
}

export function markHierarchicalDetailedEvaluationCriteria(criteria = []) {
  return criteria.map((criterion) => ({
    ...criterion,
    hasChildren: directChildren(criteria, criterion).length > 0,
  }));
}

export function applyHierarchicalDetailedEvaluationResults(report = {}, criteria = []) {
  const markedCriteria = markHierarchicalDetailedEvaluationCriteria(criteria);
  const rows = new Map((report.chiTietList || []).map((row) => [
    String(row.tieuChiDanhGiaId),
    { ...row, extension: { ...(row.extension || {}) } },
  ]));
  const parents = markedCriteria
    .filter((criterion) => criterion.hasChildren && criterion.resultType === "pass_fail")
    .sort((left, right) => sttParts(right).length - sttParts(left).length);

  parents.forEach((criterion) => {
    const children = directChildren(markedCriteria, criterion);
    const childRows = children.map((child) => rows.get(String(child.id)) || {});
    const previous = rows.get(String(criterion.id)) || {
      id: `detailed-evaluation-row:${report.id || "pending"}:${criterion.id}`,
      tieuChiDanhGiaId: criterion.id,
    };
    rows.set(String(criterion.id), {
      ...previous,
      ketQua: aggregateChildResults(childRows.map((row) => row.ketQua || "pending")),
      extension: {
        ...(previous.extension || {}),
        ketQuaTuDong: aggregateChildResults(childRows.map(
          (row) => row.extension?.ketQuaTuDong || row.ketQuaTuDong || "pending",
        )),
      },
    });
  });

  return { ...report, chiTietList: [...rows.values()] };
}
