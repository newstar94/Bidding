import { persistAndSync, stageLocalRecords } from "../shared/MutationService.js";
import {
  ensureVersionEhsmtAdjustment,
  getNextVersion,
  rememberSelectedVersion
} from "../shared/VersionedEntityService.js";
import { clearCompetitiveQuotationAppraisal } from "./packageAppraisal.js";
import { snapshotPackageAggregate } from "./packageAggregateSnapshot.js";

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

export function createPackagePreparationVersionSnapshot(
  state,
  sourcePackage,
  changes,
  { targetPackageId, targetPlanId, timestamp, createId } = {},
) {
  if (!targetPackageId || !sourcePackage?.id) {
    throw new Error("KhÃ´ng Ä‘á»§ dá»¯ liá»‡u Ä‘á»ƒ táº¡o snapshot gÃ³i tháº§u.");
  }
  return snapshotPackageAggregate(state, sourcePackage, {
    targetPackageId,
    targetPlanId: targetPlanId || sourcePackage.keHoachId,
    packageVersion: getNextVersion(state.goithau, sourcePackage),
    timestamp,
    overrides: changes,
    createId,
  });
}

export async function savePackagePreparation(controller, pkg, changes, { generateRecordId } = {}) {
  const { model } = controller;
  const nextData = { ...changes };
  clearCompetitiveQuotationAppraisal(nextData);
  const createVersion = shouldCreatePackagePreparationVersion(pkg, nextData);
  let tables = ["goithau"];
  let savedPackage = pkg;
  let previousLatestPackages = [];

  if (createVersion) {
    const timestamp = model.getCurrentDateTimeString();
    const packageId = generateRecordId("goithau");
    const latestPlan = model.getLatestPlan(pkg.keHoachId);
    const packageRootId = String(pkg.rootId || pkg.id);
    previousLatestPackages = model.state.goithau
      .filter((candidate) => String(candidate.rootId || candidate.id) === packageRootId)
      .filter((candidate) => candidate.isLatest == 1);
    const snapshot = createPackagePreparationVersionSnapshot(
      model.state,
      pkg,
      {
        ...nextData,
        keHoachId: latestPlan?.id || pkg.keHoachId,
      },
      {
        targetPackageId: packageId,
        targetPlanId: latestPlan?.id || pkg.keHoachId,
        timestamp,
        createId: generateRecordId,
      },
    );
    model.state.goithau
      .filter((candidate) => String(candidate.rootId || candidate.id) === packageRootId)
      .forEach((candidate) => { candidate.isLatest = 0; });
    savedPackage = snapshot.packageRecord;
    ensureVersionEhsmtAdjustment(savedPackage);
    clearCompetitiveQuotationAppraisal(savedPackage);
    model.state.goithau.push(savedPackage);
    ["goithauhanghoa", "thongtinmothau", "hanghoaduthaunhathau", "assignments"].forEach((key) => {
      model.state[key] ||= [];
      model.state[key].push(...snapshot[key]);
    });
    rememberSelectedVersion(model.state, "selectedPackageVersion", savedPackage);
    tables = ["goithau", "goithauhanghoa", "hanghoaduthaunhathau", "thongtinmothau", "assignments"];
  } else {
    const latestPlan = model.getLatestPlan(pkg.keHoachId);
    Object.assign(pkg, nextData, {
      keHoachId: latestPlan?.id || pkg.keHoachId,
      updatedAt: model.getCurrentDateTimeString()
    });
    clearCompetitiveQuotationAppraisal(pkg);
  }

  if (createVersion) {
    stageLocalRecords(model, "goithau", [...previousLatestPackages, savedPackage]);
  } else {
    stageLocalRecords(model, "goithau", savedPackage);
  }
  if (createVersion) {
    ["goithauhanghoa", "thongtinmothau", "hanghoaduthaunhathau", "assignments"].forEach((key) => {
      const records = key === "assignments"
        ? model.state.assignments.filter((record) => String(record.targetId) === String(savedPackage.id) && record.type === "goithau")
        : model.state[key].filter((record) => String(record.goiThauId) === String(savedPackage.id));
      stageLocalRecords(model, key, records);
    });
  }
  await persistAndSync(controller, tables);
  return savedPackage;
}
