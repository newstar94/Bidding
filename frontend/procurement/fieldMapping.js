export function planPreviewFields(preview) {
  const source = preview?.plan?.preview || {};
  return [
    ["Mã kế hoạch", preview?.plan?.familyNo],
    ["Tên kế hoạch", source.name],
    ["Loại kế hoạch", source.planType],
    ["Dự án / dự toán", source.projectName],
    ["Chủ đầu tư nguồn", source.investorName || source.investorCode],
    ["Quyết định phê duyệt", source.approvalDecisionNo],
    ["Ngày phê duyệt", source.approvalDecisionDate],
  ].filter(([, value]) => value !== null && value !== undefined && value !== "");
}

export function packageNoticeLabel(pkg) {
  const link = pkg?.noticeLink || {};
  if (link.state === "LINKED") {
    return `${link.noticeNo || "Đã liên kết"} · ${link.kind || "UNKNOWN"}`;
  }
  if (link.state === "UNKNOWN") return "Liên kết chưa xác định";
  return "Chưa có thông báo liên kết";
}
