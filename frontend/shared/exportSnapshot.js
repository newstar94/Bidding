export function appendExportSnapshotVersion(url, snapshotVersion) {
  const normalizedVersion = String(snapshotVersion ?? "").trim();
  if (!/^\d+$/.test(normalizedVersion)) {
    throw new Error("Không xác định được phiên bản dữ liệu để xuất tệp.");
  }
  const separator = String(url).includes("?") ? "&" : "?";
  return `${url}${separator}snapshotVersion=${encodeURIComponent(normalizedVersion)}`;
}
