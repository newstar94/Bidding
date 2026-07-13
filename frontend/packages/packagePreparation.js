import { persistAndSync } from "../shared/MutationService.js";
import { createNextVersion, rememberSelectedVersion } from "../shared/VersionedEntityService.js";
import { clearCompetitiveQuotationAppraisal } from "./packageAppraisal.js";

function dateTimeChanged(previousValue, nextValue) {
  const previous = String(previousValue || "").trim();
  const next = String(nextValue || "").trim();
  if (!previous && !next) return false;
  if (!previous || !next) return true;
  const previousDate = new Date(previous);
  const nextDate = new Date(next);
  if (Number.isNaN(previousDate.getTime()) || Number.isNaN(nextDate.getTime())) {
    return previous !== next;
  }
  return previousDate.getTime() !== nextDate.getTime();
}

export function shouldCreatePackagePreparationVersion(pkg, changes) {
  if (!String(pkg?.thoiGianDangTai || "").trim()) return false;
  return ["thoiGianDangTai", "thoiGianDongThau", "thoiGianMoThau"]
    .some((field) => dateTimeChanged(pkg?.[field], changes?.[field]));
}

export async function savePackagePreparation(controller, pkg, changes, { generateRecordId } = {}) {
  const { model } = controller;
  const nextData = { ...changes };
  clearCompetitiveQuotationAppraisal(nextData);
  const createVersion = shouldCreatePackagePreparationVersion(pkg, nextData);
  const tables = ["goithau"];
  let savedPackage = pkg;

  if (createVersion) {
    const timestamp = model.getCurrentDateTimeString();
    const packageId = generateRecordId("goithau");
    const latestPlan = model.getLatestPlan(pkg.keHoachId);
    savedPackage = createNextVersion(model.state.goithau, pkg, {
      ...pkg,
      ...nextData,
      keHoachId: latestPlan?.id || pkg.keHoachId
    }, { id: packageId, timestamp });
    savedPackage.createdAt = pkg.createdAt || timestamp;
    clearCompetitiveQuotationAppraisal(savedPackage);
    model.state.goithau.push(savedPackage);
    rememberSelectedVersion(model.state, "selectedPackageVersion", savedPackage);

    if (Array.isArray(model.state.hopdong)) {
      model.state.hopdong = model.state.hopdong.map((contract) => {
        if (!contract.goiThauIds?.includes(pkg.id)) return contract;
        const packageIds = contract.goiThauIds.includes(packageId)
          ? [...contract.goiThauIds]
          : [...contract.goiThauIds, packageId];
        return { ...contract, goiThauIds: packageIds };
      });
      tables.push("hopdong");
    }
    if (Array.isArray(model.state.thongtinmothau)) {
      const copiedBids = model.state.thongtinmothau
        .filter((bid) => String(bid.goiThauId) === String(pkg.id))
        .map((bid) => ({
          ...bid,
          id: generateRecordId("thongtinmothau"),
          goiThauId: packageId
        }));
      model.state.thongtinmothau = [...model.state.thongtinmothau, ...copiedBids];
      tables.push("thongtinmothau");
    }
  } else {
    const latestPlan = model.getLatestPlan(pkg.keHoachId);
    Object.assign(pkg, nextData, {
      keHoachId: latestPlan?.id || pkg.keHoachId,
      updatedAt: model.getCurrentDateTimeString()
    });
    clearCompetitiveQuotationAppraisal(pkg);
  }

  await persistAndSync(controller, tables);
  return savedPackage;
}
