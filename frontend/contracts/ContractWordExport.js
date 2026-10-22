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
  previewDocument = typeof globalThis.document?.createElement === "function"
    ? async (details) => (await import("../documents/WordPreviewDialog.js")).confirmWordPreview(details)
    : null,
} = {}) {
  const loading = await beginLoading({
    detail: `Hợp đồng: ${contractNumber || "LCNT"}`,
  });
  let loadingOpen = true;
  const closeLoading = async () => {
    if (!loadingOpen) return;
    loadingOpen = false;
    await loading.close();
  };
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
        onProgress: (stage, message) => (loadingOpen ? loading.update(stage, message) : undefined),
      }, {
        preview: previewDocument
          ? async (details) => {
            await closeLoading();
            return previewDocument(details);
          }
          : null,
      });
    } catch (error) {
      const wrapped = new Error("Không thể xuất hợp đồng", { cause: error });
      wrapped.code = error?.code;
      wrapped.status = error?.status;
      throw wrapped;
    }
  } finally {
    await closeLoading();
  }
}
