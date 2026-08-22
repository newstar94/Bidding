function sortedRecords(records, codeField, nameField) {
  return [...(records || [])].sort((left, right) => (
    `${left?.[codeField] || ""} ${left?.[nameField] || ""}`.localeCompare(
      `${right?.[codeField] || ""} ${right?.[nameField] || ""}`,
      "vi",
      { numeric: true, sensitivity: "base" },
    )
  ));
}

export function getWordPublicationPlans(model) {
  const records = typeof model?.getFilteredKeHoach === "function"
    ? model.getFilteredKeHoach()
    : typeof model?.getLatestPlans === "function" ? model.getLatestPlans() : [];
  return sortedRecords(records, "maKeHoach", "tenKeHoach");
}

export function getWordPublicationPackages(model, planId) {
  if (!planId) return [];
  const records = typeof model?.getFilteredGoiThau === "function"
    ? model.getFilteredGoiThau()
    : typeof model?.getLatestPackages === "function" ? model.getLatestPackages() : [];
  return sortedRecords(
    records.filter((packageRecord) => (
      String(packageRecord?.keHoachId || "") === String(planId)
    )),
    "maGoiThau",
    "tenGoiThau",
  );
}

export function createWordPublicationState() {
  return {
    planId: "",
    packageId: "",
    selectedDocumentId: "",
    pendingDocumentId: "",
  };
}

export function selectWordPublicationPlan(state, planId) {
  state.planId = String(planId || "");
  state.packageId = "";
  state.selectedDocumentId = "";
  return state;
}

export function selectWordPublicationPackage(state, packageId) {
  state.packageId = String(packageId || "");
  state.selectedDocumentId = "";
  return state;
}

function filenameToken(value, fallback) {
  const normalized = String(value || "")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/gu, "")
    .replace(/đ/gu, "d")
    .replace(/Đ/gu, "D")
    .replace(/[^A-Za-z0-9_-]+/gu, "_")
    .replace(/^_+|_+$/gu, "");
  return normalized || fallback;
}

export function buildWordPublicationExportRequest({ documentType, plan, packageRecord }) {
  if (!documentType?.exportTarget) {
    throw new Error("Loại văn bản chưa được cấu hình mẫu Word.");
  }
  const stableId = filenameToken(documentType.id, "document");
  if (documentType.exportTarget.scope === "plan") {
    if (!plan?.id) throw new Error("Không xác định được Kế hoạch để xuất Word.");
    return {
      url: `/api/export-plan/${encodeURIComponent(plan.id)}?publicationType=${encodeURIComponent(documentType.id)}`,
      filename: `${stableId}_${filenameToken(plan.maKeHoach, "ke_hoach")}.docx`,
    };
  }
  if (!packageRecord?.id) throw new Error("Không xác định được Gói thầu để xuất Word.");
  return {
    url: `/api/export-report/${encodeURIComponent(packageRecord.id)}?type=${encodeURIComponent(documentType.exportTarget.reportType)}&publicationType=${encodeURIComponent(documentType.id)}`,
    filename: `${stableId}_${filenameToken(packageRecord.maGoiThau, "goi_thau")}.docx`,
  };
}
