import { persistAndSync, stageLocalRecords } from "../shared/MutationService.js";
import { getAppController } from "../app/controllerRef.js";
import { serializeEvaluationMetadata } from "./evaluationMetadata.js";

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
  const packageId = pkg?.id;
  const stagedPackage = {
    ...pkg,
    danhGiaHsdtMetadata: serializeEvaluationMetadata(metadata),
  };
  await stagePackageRecord(controller, stagedPackage);
  await persistAndSync(controller, "goithau");
  return controller?.model?.state?.goithau?.find(
    (item) => String(item?.id) === String(packageId),
  ) || stagedPackage;
}

export async function commitPackageAwardDecision(controller, { afterPersist, packageRecord } = {}) {
  const activeController = typeof controller?.autoSync === "function"
    ? controller
    : getAppController();
  if (!activeController?.model || typeof activeController.autoSync !== "function") {
    throw new Error("Không thể đồng bộ quyết định kết quả với máy chủ.");
  }
  await stagePackageRecord(activeController, packageRecord);
  const packageBids = (activeController.model.state.thongtinmothau || []).filter(
    (bid) => String(bid?.goiThauId || "") === String(packageRecord?.id || ""),
  );
  stageLocalRecords(activeController.model, "thongtinmothau", packageBids);
  const tables = ["nhathau", "goithau", "thongtinmothau"]
    .filter((table) => Array.isArray(activeController.model.state[table]));
  const syncResult = await persistAndSync(activeController, tables);
  if (syncResult?.ok !== false && typeof afterPersist === "function") {
    await afterPersist();
  }
  return syncResult;
}

export async function commitPackageAwardDependencies(controller, { packageRecord } = {}) {
  const activeController = typeof controller?.autoSync === "function"
    ? controller
    : getAppController();
  if (!activeController?.model || typeof activeController.autoSync !== "function") {
    throw new Error("Không thể đồng bộ dữ liệu nhà thầu với máy chủ.");
  }
  const packageBids = (activeController.model.state.thongtinmothau || []).filter(
    (bid) => String(bid?.goiThauId || "") === String(packageRecord?.id || ""),
  );
  stageLocalRecords(activeController.model, "thongtinmothau", packageBids);
  const tables = ["nhathau", "thongtinmothau"]
    .filter((table) => Array.isArray(activeController.model.state[table]));
  return persistAndSync(activeController, tables);
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
