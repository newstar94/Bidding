import { persistAndSync } from "../shared/MutationService.js";
import { getAppController } from "../app/controllerRef.js";

async function stagePackageRecord(controller, packageRecord) {
  if (!packageRecord) return;
  if (typeof controller?.model?.updateRecord === "function") {
    await controller.model.updateRecord("goithau", packageRecord);
    return;
  }
  const packages = controller?.model?.state?.goithau;
  if (!Array.isArray(packages)) return;
  const canonical = packages.find((item) => String(item?.id) === String(packageRecord?.id));
  if (canonical && canonical !== packageRecord) Object.assign(canonical, packageRecord);
  controller.model.commitLocalMutation?.("goithau", {
    records: canonical || packageRecord,
  });
}

export async function saveQualifiedApproval(controller, pkg, metadata) {
  pkg.danhGiaHsdtMetadata = JSON.stringify(metadata);
  await persistAndSync(controller, "goithau");
  return pkg;
}

export async function commitPackageAwardDecision(controller, { afterPersist, packageRecord } = {}) {
  const activeController = typeof controller?.autoSync === "function"
    ? controller
    : getAppController();
  if (!activeController?.model || typeof activeController.autoSync !== "function") {
    throw new Error("Không thể đồng bộ quyết định kết quả với máy chủ.");
  }
  await stagePackageRecord(activeController, packageRecord);
  const tables = ["nhathau", "goithau", "thongtinmothau"]
    .filter((table) => Array.isArray(activeController.model.state[table]));
  const syncResult = await persistAndSync(activeController, tables);
  if (syncResult?.ok !== false && typeof afterPersist === "function") {
    await afterPersist();
  }
  return syncResult;
}

export async function commitPackageResultEditState(controller, { afterPersist, packageRecord } = {}) {
  const activeController = typeof controller?.autoSync === "function"
    ? controller
    : getAppController();
  if (!activeController?.model || typeof activeController.autoSync !== "function") {
    throw new Error("Không thể đồng bộ trạng thái chỉnh sửa kết quả với máy chủ.");
  }
  await stagePackageRecord(activeController, packageRecord);
  const syncResult = await persistAndSync(activeController, "goithau");
  if (syncResult?.ok !== false && typeof afterPersist === "function") {
    await afterPersist();
  }
  return syncResult;
}
