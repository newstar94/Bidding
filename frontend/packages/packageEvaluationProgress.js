import { persistAndSync } from "../shared/MutationService.js";

export async function saveQualifiedApproval(controller, pkg, metadata) {
  pkg.danhGiaHsdtMetadata = JSON.stringify(metadata);
  await persistAndSync(controller, "goithau");
  return pkg;
}

export async function commitPackageAwardDecision(controller, { afterPersist } = {}) {
  const tables = ["nhathau", "goithau", "thongtinmothau"]
    .filter((table) => Array.isArray(controller.model.state[table]));
  return persistAndSync(controller, tables, { afterPersist });
}
