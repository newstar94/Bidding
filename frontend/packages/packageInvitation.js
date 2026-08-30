import { persistAndSync, stageLocalRecords } from "../shared/MutationService.js";

export async function savePackageInvitationInfo(controller, pkg, {
  extensions = [],
  clarificationRequests = [],
  clarificationResponses = [],
  convertDateTime
} = {}) {
  pkg.giaHanList = extensions;
  pkg.yeuCauLamRoList = clarificationRequests;
  pkg.traLoiLamRoList = clarificationResponses;
  const lastExtension = extensions[extensions.length - 1];
  if (lastExtension?.thoiGianDongThau) {
    const closingTime = convertDateTime(lastExtension.thoiGianDongThau);
    pkg.thoiGianDongThau = closingTime;
    pkg.thoiGianMoThau = closingTime;
  }
  stageLocalRecords(controller.model, "goithau", pkg);
  const syncResult = await persistAndSync(controller, "goithau", {
    changes: { upserts: { goithau: [pkg] } },
  });
  if (syncResult?.ok === false || typeof controller?.fetchRecordByLookup !== "function") {
    return pkg;
  }
  return await controller.fetchRecordByLookup("goithau", pkg.id) || pkg;
}
