import { persistAndSync } from "../shared/MutationService.js";
import { getAppController } from "../app/controllerRef.js";

export async function saveQualifiedApproval(controller, pkg, metadata) {
  pkg.danhGiaHsdtMetadata = JSON.stringify(metadata);
  await persistAndSync(controller, "goithau");
  return pkg;
}

export async function commitPackageAwardDecision(controller, { afterPersist } = {}) {
  const activeController = typeof controller?.autoSync === "function"
    ? controller
    : getAppController();
  if (!activeController?.model || typeof activeController.autoSync !== "function") {
    throw new Error("Không thể đồng bộ quyết định kết quả với máy chủ.");
  }
  const tables = ["nhathau", "goithau", "thongtinmothau"]
    .filter((table) => Array.isArray(activeController.model.state[table]));
  return persistAndSync(activeController, tables, { afterPersist });
}
