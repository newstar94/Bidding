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
  await persistAndSync(controller, "goithau", {
    changes: { upserts: { goithau: [pkg] } },
  });
  return pkg;
}
