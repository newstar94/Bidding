function normalizedText(value) {
  return String(value ?? "").trim();
}

function packageRootId(pkg) {
  return normalizedText(pkg?.rootId || pkg?.id);
}

function planVersionSortValue(plan) {
  const value = Number.parseInt(plan?.phienBan, 10);
  return Number.isFinite(value) ? value : -1;
}

function approvalDateKey(value) {
  const text = normalizedText(value);
  const iso = text.match(/^(\d{4})-(\d{2})-(\d{2})/u);
  if (iso) return `${iso[1]}-${iso[2]}-${iso[3]}`;
  const dmy = text.match(/^(\d{2})\/(\d{2})\/(\d{4})/u);
  if (dmy) return `${dmy[3]}-${dmy[2]}-${dmy[1]}`;
  return text.toLocaleLowerCase("vi");
}

export function linkedPlanIdsForPackage(model, pkg) {
  const rootId = packageRootId(pkg);
  const family = (model?.state?.goithau || []).filter(
    (candidate) => packageRootId(candidate) === rootId,
  );
  if (!family.some((candidate) => String(candidate?.id) === String(pkg?.id))) {
    family.push(pkg);
  }
  return [...new Set(
    family
      .map((candidate) => normalizedText(candidate?.keHoachId))
      .filter(Boolean),
  )];
}

export function resolveLinkedPlanSnapshot(model, pkg) {
  const planId = normalizedText(pkg?.keHoachId);
  const exact = (model?.state?.kehoach || []).find(
    (candidate) => normalizedText(candidate?.id) === planId,
  );
  if (exact) return exact;
  return typeof model?.getLatestPlan === "function"
    ? model.getLatestPlan(planId)
    : null;
}

export function resolvePackagePlanApprovals(model, pkg) {
  const linkedPlanIds = new Set(linkedPlanIdsForPackage(model, pkg));
  const plans = (model?.state?.kehoach || [])
    .filter((plan) => linkedPlanIds.has(normalizedText(plan?.id)))
    .sort((left, right) => (
      planVersionSortValue(left) - planVersionSortValue(right)
      || normalizedText(left?.phienBan).localeCompare(normalizedText(right?.phienBan), "vi")
      || normalizedText(left?.id).localeCompare(normalizedText(right?.id), "vi")
    ));
  const approvalsByDecision = new Map();

  plans.forEach((plan) => {
    const decisionNumber = normalizedText(plan?.quyetDinhPheDuyet);
    const approvalDate = normalizedText(plan?.ngayPheDuyet);
    if (!decisionNumber && !approvalDate) return;
    const key = `${decisionNumber.toLocaleUpperCase("vi")}|${approvalDateKey(approvalDate)}`;
    const version = normalizedText(plan?.phienBan);
    const approvalType = plan?.pheDuyet === "Kế hoạch"
      ? "Phê duyệt kế hoạch"
      : "Phê duyệt dự toán và kế hoạch";
    const existing = approvalsByDecision.get(key);
    if (existing) {
      if (version && !existing.planVersions.includes(version)) {
        existing.planVersions.push(version);
      }
      return;
    }
    approvalsByDecision.set(key, {
      decisionNumber,
      approvalDate,
      approvalType,
      planVersions: version ? [version] : [],
    });
  });

  return [...approvalsByDecision.values()];
}
