import { persistAndSync, stageLocalRecords } from "../shared/MutationService.js";
import {
  ensureVersionEhsmtAdjustment,
  getNextVersion,
  rememberSelectedVersion
} from "../shared/VersionedEntityService.js";
import { clearCompetitiveQuotationAppraisal } from "./packageAppraisal.js";
import { snapshotPackageAggregate } from "./packageAggregateSnapshot.js";
import { loadPaginatedRecords } from "../shared/tableDataUtils.js";
import { createOfficialAggregateVersion } from "../shared/AggregateVersionClient.js";
import { generateRecordId as defaultGenerateRecordId } from "../shared/idUtils.js";

/**
 * Creating a package version copies the aggregate that is present in local
 * state. The detail screen can be reached with a lightweight projection of the
 * package (`referenceOnly`) and without its assignments, because the
 * goithau-detail route does not preload them. Copying that partial picture
 * silently drops inherited data: an absent `trangThai` falls back to the server
 * default "Chuẩn bị", and absent assignment rows read as "chưa phân công".
 *
 * Load the authoritative package and its owned rows before snapshotting.
 */
async function hydratePackageAggregate(controller, pkg) {
  const model = controller.model;
  const packageId = String(pkg?.id || "");
  if (!packageId) return pkg;
  let hydrated = pkg;
  if (pkg?.referenceOnly === true && typeof controller.fetchRecordByLookup === "function") {
    hydrated = await controller.fetchRecordByLookup("goithau", packageId).catch((error) => {
      console.error("Failed to load the package before creating a version:", error);
      return null;
    }) || pkg;
  }
  if (!model?.useServerSidePagination) return hydrated;
  // /api/paginate scopes these owned tables by plan, not by package.
  const planId = String(hydrated?.keHoachId || pkg?.keHoachId || "");
  if (!planId) return hydrated;
  const ownedTables = ["assignments", "goithauhanghoa", "thongtinmothau", "hanghoaduthaunhathau"];
  await Promise.all(ownedTables.map(async (table) => {
    let cursor = "";
    do {
      const page = await loadPaginatedRecords(model, table, {
        pageSize: 200,
        pagination: "cursor",
        sortBy: "id",
        sortOrder: "asc",
        keHoachId: planId,
        ...(cursor ? { cursor } : {}),
      }).catch((error) => {
        console.error(`Failed to load ${table} of plan ${planId} before versioning:`, error);
        return null;
      });
      const nextCursor = String(page?.nextCursor || "");
      if (!page?.hasMore || !nextCursor || nextCursor === cursor) break;
      cursor = nextCursor;
    } while (cursor);
  }));
  return model.state.goithau.find((row) => String(row.id) === packageId) || hydrated;
}

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
    throw new Error("Không đủ dữ liệu để tạo snapshot gói thầu.");
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

export async function savePackagePreparation(controller, pkg, changes, {
  generateRecordId = defaultGenerateRecordId,
  createAggregateVersion = createOfficialAggregateVersion,
} = {}) {
  const { model } = controller;
  const nextData = { ...changes };
  clearCompetitiveQuotationAppraisal(nextData);
  let createVersion = shouldCreatePackagePreparationVersion(pkg, nextData);
  if (createVersion && pkg?.referenceOnly === true && typeof controller.fetchRecordByLookup === "function") {
    pkg = await controller.fetchRecordByLookup("goithau", pkg.id) || pkg;
    createVersion = shouldCreatePackagePreparationVersion(pkg, nextData);
  }
  if (createVersion && Number(pkg?.rowVersion) > 0) {
    const officialResult = await createAggregateVersion(controller, {
      kind: "package",
      sourceId: pkg.id,
      expectedRowVersion: Number(pkg.rowVersion),
      changes: nextData,
      clientMutationId: generateRecordId("version-command"),
    });
    if (officialResult?.authoritative) {
      const packageRootId = String(pkg.rootId || pkg.id);
      const savedPackage = model.state.goithau.find((candidate) => (
        String(candidate.rootId || candidate.id) === packageRootId
        && String(candidate.keHoachId) === String(pkg.keHoachId)
        && candidate.isLatest == 1
        && String(candidate.id) !== String(pkg.id)
      ));
      if (!savedPackage) {
        throw new Error("Máy chủ đã tạo phiên bản nhưng dữ liệu mới chưa được tải về.");
      }
      rememberSelectedVersion(model.state, "selectedPackageVersion", savedPackage);
      return savedPackage;
    }
  }
  if (createVersion) {
    // Inheriting from a partial local copy would silently reset status and
    // assignees, so refresh the aggregate first and re-evaluate the decision
    // against the authoritative record.
    pkg = await hydratePackageAggregate(controller, pkg);
    createVersion = shouldCreatePackagePreparationVersion(pkg, nextData);
  }
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
      .filter((candidate) => String(candidate.keHoachId) === String(latestPlan?.id || pkg.keHoachId))
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
      .filter((candidate) => String(candidate.keHoachId) === String(latestPlan?.id || pkg.keHoachId))
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

  const explicitUpserts = {
    goithau: createVersion ? [...previousLatestPackages, savedPackage] : [savedPackage],
  };
  stageLocalRecords(model, "goithau", explicitUpserts.goithau);
  if (createVersion) {
    ["goithauhanghoa", "thongtinmothau", "hanghoaduthaunhathau", "assignments"].forEach((key) => {
      const records = key === "assignments"
        ? model.state.assignments.filter((record) => String(record.targetId) === String(savedPackage.id) && record.type === "goithau")
        : model.state[key].filter((record) => String(record.goiThauId) === String(savedPackage.id));
      explicitUpserts[key] = records;
      stageLocalRecords(model, key, records);
    });
  }
  await persistAndSync(controller, tables, {
    changes: { upserts: explicitUpserts },
  });
  return savedPackage;
}
