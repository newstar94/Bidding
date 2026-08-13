import { generateRecordId } from "../shared/idUtils.js";
import { createInitialVersion } from "../shared/VersionedEntityService.js";
import { capturePlanBreakdownDraft } from "../plans/planBreakdownDraft.js";
import { applyPlanAggregateSnapshot, snapshotPlanAggregate } from "../plans/planAggregateSnapshot.js";
import { presentStatus } from "../packages/LifecyclePolicy.js";

function sourceBoolean(value) {
  if (typeof value === "boolean") return value;
  if (value === 1 || value === "1") return true;
  if (value === 0 || value === "0") return false;
  return null;
}

function yesNo(value, fallback = "Không") {
  const normalized = sourceBoolean(value);
  return normalized === null ? fallback : normalized ? "Có" : "Không";
}

function mapLots(lots) {
  return (Array.isArray(lots) ? lots : []).map((lot) => ({
    id: lot.id || lot.lotId || null,
    maPhanLo: lot.maPhanLo || lot.lotNo || "",
    tenPhanLo: lot.tenPhanLo || lot.lotName || "",
    giaTriPhanLo: lot.giaTriPhanLo ?? lot.lotPrice ?? 0,
    baoDamDuThau: lot.baoDamDuThau ?? lot.bidGuarantee ?? 0,
    thoiGianThucHien: lot.thoiGianThucHien || lot.executionPeriod || "",
  }));
}

export function biddingPackageStatus(value) {
  return presentStatus(value).label;
}

export function materializeProcurementRevisionDraft(state, revisionDraft, {
  createId = generateRecordId,
  timestamp = new Date().toISOString(),
} = {}) {
  const draft = capturePlanBreakdownDraft(state, { action: "create" });
  const sourcePlan = revisionDraft?.planDraft || {};
  const planId = createId("kehoach");
  const plan = createInitialVersion({
    ...sourcePlan,
    id: planId,
    phienBan: String(revisionDraft?.revisionNumber ?? sourcePlan.phienBan ?? "00"),
    pheDuyet: sourcePlan.pheDuyet || "Dự toán và kế hoạch",
  }, { id: planId, timestamp });
  plan.phienBan = String(revisionDraft?.revisionNumber ?? sourcePlan.phienBan ?? "00");
  plan._procurementImportCurrent = true;
  state.kehoach ||= [];
  state.goithau ||= [];
  state.kehoach.push(plan);
  const packages = (revisionDraft?.packageDrafts || []).map((sourcePackage) => {
    const packageId = createId("goithau");
    const lots = mapLots(sourcePackage.danhSachPhanLo);
    const packageRecord = createInitialVersion({
      ...sourcePackage,
      id: packageId,
      keHoachId: planId,
      phienBan: sourcePackageVersion(sourcePackage),
      trangThai: biddingPackageStatus(sourcePackage.trangThai),
      isThuoc: sourceBoolean(sourcePackage.goiThauThuoc) === true ? 1 : 0,
      tuyChonMuaThem: yesNo(sourcePackage.tuyChonMuaThem),
      phanLo: yesNo(sourcePackage.phanLo),
      phanLoList: lots,
      giaTriDamBaoDuThau: sourcePackage.giaTriBaoDamDuThau ?? 0,
    }, { id: packageId, timestamp });
    packageRecord.phienBan = sourcePackageVersion(sourcePackage);
    packageRecord._procurementImportCurrent = true;
    return packageRecord;
  });
  state.goithau.push(...packages);
  draft.planId = planId;
  return { draft, plan, packages };
}

function sourcePackageIdentity(record) {
  const source = record?.sourceRevision || {};
  return String(
    source.stablePackageId
    || record?.soHieuGoiThau
    || record?.symbol
    || source.packageObservationId
    || record?.maGoiThau
    || "",
  ).trim().toLocaleLowerCase("vi");
}

function sourcePackageVersion(source, fallback = "00") {
  const value = source?.sourceRevision?.packageRevisionNumber
    ?? source?.noticeLink?.noticeVersion;
  const text = String(value ?? "").trim();
  if (/^\d+$/.test(text)) return text.padStart(2, "0");
  return source ? "00" : String(fallback || "00");
}

function removeSnapshotPackages(state, aggregate, packageIds) {
  if (!packageIds.size) return;
  const sourceIds = [];
  aggregate.mappings?.packageIds?.forEach((targetId, sourceId) => {
    if (packageIds.has(String(targetId))) sourceIds.push(String(sourceId));
  });
  state.goithau = (state.goithau || []).filter(
    (row) => !packageIds.has(String(row?.id || "")),
  );
  sourceIds.forEach((sourceId) => {
    const source = state.goithau.find((row) => String(row?.id || "") === sourceId);
    if (source) source.isLatest = 1;
  });
  for (const table of ["goithauhanghoa", "thongtinmothau", "hanghoaduthaunhathau"]) {
    state[table] = (state[table] || []).filter(
      (row) => !packageIds.has(String(row?.goiThauId || "")),
    );
    aggregate[table] = (aggregate[table] || []).filter(
      (row) => !packageIds.has(String(row?.goiThauId || "")),
    );
  }
  state.assignments = (state.assignments || []).filter((row) => !(
    row?.type === "goithau" && packageIds.has(String(row?.targetId || ""))
  ));
  aggregate.assignments = (aggregate.assignments || []).filter((row) => !(
    row?.type === "goithau" && packageIds.has(String(row?.targetId || ""))
  ));
  aggregate.goithau = aggregate.goithau.filter(
    (row) => !packageIds.has(String(row?.id || "")),
  );
}

export function materializeProcurementRevisionFromPrevious(
  state,
  previousPlanId,
  revisionDraft,
  { createId = generateRecordId, timestamp = new Date().toISOString() } = {},
) {
  const previousPlan = (state.kehoach || []).find(
    (plan) => String(plan?.id) === String(previousPlanId),
  );
  if (!previousPlan) throw new Error("PROCUREMENT_SOURCE_VERSION_CONFLICT");
  const draft = capturePlanBreakdownDraft(state, { action: "create" });
  const planId = createId("kehoach");
  const revisionNumber = String(revisionDraft?.revisionNumber || "");
  const plan = {
    ...structuredClone(previousPlan),
    ...(revisionDraft?.planDraft || {}),
    id: planId,
    rootId: previousPlan.rootId || previousPlan.id,
    phienBan: revisionNumber,
    isLatest: 1,
    rowVersion: undefined,
    updatedAt: timestamp,
    _procurementImportCurrent: true,
  };
  previousPlan.isLatest = 0;
  previousPlan._procurementImportCurrent = false;
  (state.goithau || []).forEach((candidate) => {
    if (String(candidate?.keHoachId || "") === String(previousPlan.id)) {
      candidate._procurementImportCurrent = false;
    }
  });
  state.kehoach.push(plan);
  const aggregate = snapshotPlanAggregate(state, {
    sourcePlanId: previousPlan.id,
    targetPlanId: planId,
    timestamp,
    createId,
  });
  applyPlanAggregateSnapshot(state, aggregate);
  const sourceByIdentity = new Map(
    (revisionDraft?.packageDrafts || []).map((source) => [
      sourcePackageIdentity(source), source,
    ]),
  );
  aggregate.goithau.forEach((packageRecord) => {
    packageRecord._procurementImportCurrent = true;
    const source = sourceByIdentity.get(sourcePackageIdentity(packageRecord));
    packageRecord.phienBan = sourcePackageVersion(source, packageRecord.phienBan);
    if (!source) return;
    Object.assign(packageRecord, source, {
      id: packageRecord.id,
      rootId: packageRecord.rootId,
      keHoachId: planId,
      phienBan: sourcePackageVersion(source, packageRecord.phienBan),
      isLatest: 1,
      trangThai: biddingPackageStatus(source.trangThai || packageRecord.trangThai),
      tuyChonMuaThem: yesNo(
        source.tuyChonMuaThem,
        packageRecord.tuyChonMuaThem || "Không",
      ),
      phanLo: yesNo(source.phanLo, packageRecord.phanLo || "Không"),
      phanLoList: Array.isArray(source.danhSachPhanLo)
        ? mapLots(source.danhSachPhanLo)
        : packageRecord.phanLoList,
      isThuoc: sourceBoolean(source.goiThauThuoc) === true
        ? 1
        : packageRecord.isThuoc,
      giaTriDamBaoDuThau: source.giaTriBaoDamDuThau
        ?? packageRecord.giaTriDamBaoDuThau,
    });
    sourceByIdentity.delete(sourcePackageIdentity(source));
  });
  const removedPackageIds = new Set(
    aggregate.goithau
      .filter((packageRecord) => !(
        revisionDraft?.packageDrafts || []
      ).some((source) => sourcePackageIdentity(source) === sourcePackageIdentity(packageRecord)))
      .map((packageRecord) => String(packageRecord.id)),
  );
  removeSnapshotPackages(state, aggregate, removedPackageIds);
  sourceByIdentity.forEach((source) => {
    const packageId = createId("goithau");
    const created = createInitialVersion({
      ...source,
      keHoachId: planId,
      phienBan: sourcePackageVersion(source),
      trangThai: biddingPackageStatus(source.trangThai),
      tuyChonMuaThem: yesNo(source.tuyChonMuaThem),
      phanLo: yesNo(source.phanLo),
      phanLoList: mapLots(source.danhSachPhanLo),
      isThuoc: sourceBoolean(source.goiThauThuoc) === true ? 1 : 0,
      giaTriDamBaoDuThau: source.giaTriBaoDamDuThau ?? 0,
    }, { id: packageId, timestamp });
    created.phienBan = sourcePackageVersion(source);
    created._procurementImportCurrent = true;
    state.goithau.push(created);
    aggregate.goithau.push(created);
  });
  draft.planId = planId;
  return { draft, plan, packages: aggregate.goithau, aggregate };
}

function setControlValue(document, id, value, { event = true } = {}) {
  const control = document?.getElementById?.(id);
  if (!control || value === null || value === undefined) return false;
  control.value = String(value);
  if (event && typeof globalThis.Event === "function") {
    control.dispatchEvent(new globalThis.Event("input", { bubbles: true }));
    control.dispatchEvent(new globalThis.Event("change", { bubbles: true }));
  }
  return true;
}

export function fillPlanFormFromProcurementDraft(document, planDraft, model) {
  const money = planDraft?.tongMucDauTu;
  const values = {
    "kh-ma": planDraft?.maKeHoach,
    "kh-ten": planDraft?.tenKeHoach,
    "kh-loaihinh": planDraft?.loaiHinhMuaSam,
    "kh-duan": planDraft?.tenDuAnDuToan,
    "kh-tongmuc": money == null ? "" : model?.formatVND?.(money) ?? String(money),
    "kh-nguonvon": planDraft?.nguonVon,
    "kh-quyetdinh": planDraft?.quyetDinhPheDuyet,
    "kh-ngaypheduyet": model?.formatForDateInput?.(planDraft?.ngayPheDuyet) ?? planDraft?.ngayPheDuyet,
    "kh-thoigiandang": model?.formatForDatetimeLocal?.(planDraft?.thoiGianDangMa) ?? planDraft?.thoiGianDangMa,
    "kh-pheduyet": planDraft?.pheDuyet || "Dự toán và kế hoạch",
  };
  Object.entries(values).forEach(([id, value]) => setControlValue(document, id, value));
  return values;
}

export function fillPackageFormFromProcurementDraft(document, packageDraft, controller) {
  const money = (value) => value == null ? "" : controller?.model?.formatVND?.(value) ?? String(value);
  const values = {
    "gt-ma": packageDraft?.maGoiThau,
    "gt-ten": packageDraft?.tenGoiThau,
    "gt-gia": money(packageDraft?.giaGoiThau),
    "gt-thoigian": packageDraft?.thoiGianThucHien,
    "gt-linhvuc": packageDraft?.linhVuc,
    "gt-hinhthuc": packageDraft?.hinhThucLuaChon,
    "gt-phuongthuc": packageDraft?.phuongThucLuaChon,
    "gt-phuongphapdanhgia": packageDraft?.phuongPhapDanhGia,
    "gt-nguonvon": packageDraft?.nguonVon,
    "gt-loaihopdong": packageDraft?.loaiHopDong,
    "gt-thoigiantochuc": packageDraft?.thoiGianToChuc,
    "gt-thoigianbatdautochuc": packageDraft?.thoiGianBatDauToChuc,
    "gt-quatmang": packageDraft?.quaMang,
    "gt-trongnuocquocte": packageDraft?.trongNuocQuocTe,
    "gt-tuychonmuathem": yesNo(packageDraft?.tuyChonMuaThem),
    "gt-phanlo": yesNo(packageDraft?.phanLo),
    "gt-giatribaomothau": money(packageDraft?.giaTriBaoDamDuThau),
  };
  Object.entries(values).forEach(([id, value]) => setControlValue(document, id, value));
  if (Array.isArray(packageDraft?.danhSachPhanLo)) {
    controller?._loadPhanLoRows?.(mapLots(packageDraft.danhSachPhanLo));
  }
  return values;
}
