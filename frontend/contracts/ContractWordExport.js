import { appendExportSnapshotVersion } from "../shared/exportSnapshot.js";
import { beginWordExportLoading } from "../documents/WordExportLoading.js";
import { runWordPublicationExportJob } from "../documents/WordPublicationJob.js";

function contractFilename(contractNumber) {
  return `Hop_dong_${contractNumber || "LCNT"}.docx`;
}

export async function exportContractWordInBackground({
  packageId,
  contractNumber = "",
  prepareExportSnapshot,
}, {
  beginLoading = beginWordExportLoading,
  runJob = runWordPublicationExportJob,
} = {}) {
  const loading = await beginLoading({
    detail: `Hợp đồng: ${contractNumber || "LCNT"}`,
  });
  try {
    const snapshotVersion = await prepareExportSnapshot();
    await loading.update(
      "render",
      "Dữ liệu đã được chuẩn bị. Hệ thống đang tạo hợp đồng ở chế độ nền.",
    );
    try {
      return await runJob({
        createJobUrl: appendExportSnapshotVersion(
          `/api/document-jobs/package-report/${encodeURIComponent(packageId)}?type=contract`,
          snapshotVersion,
        ),
        filename: contractFilename(contractNumber),
        onProgress: (stage, message) => loading.update(stage, message),
      });
    } catch (error) {
      throw new Error("Không thể xuất hợp đồng", { cause: error });
    }
  } finally {
    await loading.close();
  }
}
