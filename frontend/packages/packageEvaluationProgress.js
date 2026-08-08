import { persistAndSync, stageLocalRecords } from "../shared/MutationService.js";
import { getAppController } from "../app/controllerRef.js";
import { serializeEvaluationMetadata } from "./evaluationMetadata.js";

async function stagePackageRecord(controller, packageRecord) {
  if (!packageRecord) return null;
  if (typeof controller?.model?.updateRecord === "function") {
    await controller.model.updateRecord("goithau", packageRecord);
    return controller.model.state.goithau?.find(
      (item) => String(item?.id) === String(packageRecord.id),
    ) || packageRecord;
  }
  const packages = controller?.model?.state?.goithau;
  if (!Array.isArray(packages)) return packageRecord;
  const canonical = packages.find((item) => String(item?.id) === String(packageRecord?.id));
  if (canonical && canonical !== packageRecord) Object.assign(canonical, packageRecord);
  controller.model.commitLocalMutation?.("goithau", {
    records: canonical || packageRecord,
  });
  return canonical || packageRecord;
}

function contractorsForBids(model, bids) {
  const contractorIds = new Set(
    (bids || []).map((bid) => String(bid?.nhaThauId || "")).filter(Boolean),
  );
  return (model.state.nhathau || []).filter(
    (contractor) => contractorIds.has(String(contractor?.id || "")),
  );
}

export async function saveQualifiedApproval(controller, pkg, metadata) {
  const packageId = pkg?.id;
  const stagedPackage = {
    ...pkg,
    danhGiaHsdtMetadata: serializeEvaluationMetadata(metadata),
  };
  const persistedPackage = await stagePackageRecord(controller, stagedPackage);
  await persistAndSync(controller, "goithau", {
    changes: { upserts: { goithau: [persistedPackage] } },
  });
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
  const persistedPackage = await stagePackageRecord(activeController, packageRecord);
  const packageBids = (activeController.model.state.thongtinmothau || []).filter(
    (bid) => String(bid?.goiThauId || "") === String(packageRecord?.id || ""),
  );
  const packageContractors = contractorsForBids(activeController.model, packageBids);
  stageLocalRecords(activeController.model, "nhathau", packageContractors);
  stageLocalRecords(activeController.model, "thongtinmothau", packageBids);
  const syncResult = await persistAndSync(activeController, ["nhathau", "goithau", "thongtinmothau"], {
    changes: {
      upserts: {
        goithau: [persistedPackage],
        nhathau: packageContractors,
        thongtinmothau: packageBids,
      },
    },
  });
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
  const packageContractors = contractorsForBids(activeController.model, packageBids);
  stageLocalRecords(activeController.model, "nhathau", packageContractors);
  stageLocalRecords(activeController.model, "thongtinmothau", packageBids);
  return persistAndSync(activeController, ["nhathau", "thongtinmothau"], {
    changes: {
      upserts: {
        nhathau: packageContractors,
        thongtinmothau: packageBids,
      },
    },
  });
}

export async function commitPackageResultEditState(controller, { afterPersist, packageRecord } = {}) {
  const activeController = typeof controller?.autoSync === "function"
    ? controller
    : getAppController();
  if (!activeController?.model || typeof activeController.autoSync !== "function") {
    throw new Error("Không thể đồng bộ trạng thái chỉnh sửa kết quả với máy chủ.");
  }
  const persistedPackage = await stagePackageRecord(activeController, packageRecord);
  const syncResult = await persistAndSync(activeController, "goithau", {
    changes: { upserts: { goithau: [persistedPackage] } },
  });
  if (syncResult?.ok !== false && typeof afterPersist === "function") {
    await afterPersist();
  }
  return syncResult;
}
