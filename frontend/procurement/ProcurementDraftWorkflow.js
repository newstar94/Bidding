import { generateRecordId } from "../shared/idUtils.js";
import { createInitialVersion } from "../shared/VersionedEntityService.js";
import { capturePlanBreakdownDraft } from "../plans/planBreakdownDraft.js";
import { applyPlanAggregateSnapshot, snapshotPlanAggregate } from "../plans/planAggregateSnapshot.js";
import { normalizeStatus, presentStatus } from "../packages/LifecyclePolicy.js";

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

function normalizedSourceCode(value) {
  return String(value || "").trim().toLocaleLowerCase("vi");
}

function mapLots(lots, { createId = null, existingLots = [] } = {}) {
  const existingByCode = new Map((Array.isArray(existingLots) ? existingLots : [])
    .map((lot) => [normalizedSourceCode(lot?.maPhanLo), lot])
    .filter(([code]) => code));
  return (Array.isArray(lots) ? lots : []).map((lot) => ({
    id: lot.id
      || lot.lotId
      || existingByCode.get(normalizedSourceCode(lot.maPhanLo || lot.lotNo))?.id
      || createId?.("phanlo")
      || null,
    maPhanLo: lot.maPhanLo || lot.lotNo || "",
    tenPhanLo: lot.tenPhanLo || lot.lotName || "",
    giaTriPhanLo: lot.giaTriPhanLo ?? lot.lotPrice ?? 0,
    baoDamDuThau: lot.baoDamDuThau ?? lot.bidGuarantee ?? 0,
    thoiGianThucHien: lot.thoiGianThucHien || lot.executionPeriod || "",
  }));
}

function packageRecordHasLots(packageRecord) {
  return packageRecord?.phanLo === yesNo(true);
}

function mapSourcePackageLots(sourcePackage, {
  createId = null,
  existingLots = [],
  fallbackHasLots = false,
} = {}) {
  const sourceHasLots = sourceBoolean(sourcePackage?.phanLo);
  const hasLots = sourceHasLots === null ? fallbackHasLots : sourceHasLots;
  if (!hasLots) return [];
  return mapLots(sourcePackage?.danhSachPhanLo, { createId, existingLots });
}

function mapProcurementGoods(items, packageRecord, createId) {
  const hasLots = packageRecord?.phanLo === "Có";
  const lotByCode = new Map((packageRecord?.phanLoList || [])
    .map((lot) => [normalizedSourceCode(lot?.maPhanLo), lot])
    .filter(([code, lot]) => code && lot?.id));
  const seen = new Set();
  const result = [];
  (Array.isArray(items) ? items : []).forEach((item, index) => {
    const lot = hasLots
      ? lotByCode.get(normalizedSourceCode(item?.maPhanLo || item?.lotNo))
      : null;
    const code = String(
      item?.maHangHoa || item?.code || item?.sourceIndex || item?.sourceItemId || "",
    ).trim();
    const name = String(item?.tenHangHoa || item?.name || "").trim();
    const unit = String(item?.donViTinh || item?.unit || "").trim();
    const quantity = Number(item?.soLuong ?? item?.quantity);
    if ((hasLots && !lot) || !code || !name || !unit) return;
    if (!Number.isFinite(quantity) || quantity <= 0) return;
    const identity = `${lot?.id || ""}::${normalizedSourceCode(code)}`;
    if (seen.has(identity)) return;
    seen.add(identity);
    result.push({
      id: createId("goithauhanghoa"),
      goiThauId: packageRecord.id,
      phanLoId: hasLots ? lot.id : null,
      maHangHoa: code,
      tenHangHoa: name,
      nhomHangHoa: String(item?.nhomHangHoa || item?.group || "").trim(),
      donViTinh: unit,
      soLuong: quantity,
      yeuCauKyThuat: String(
        item?.yeuCauKyThuat || item?.technicalRequirement || "",
      ).trim(),
      kyMaHieuThamChieu: String(
        item?.kyMaHieuThamChieu || item?.referenceCode || "",
      ).trim(),
      xuatXuYeuCau: String(
        item?.xuatXuYeuCau || item?.requiredOrigin || "",
      ).trim(),
      diaDiemGiaoHang: String(
        item?.diaDiemGiaoHang || item?.deliveryLocation || "",
      ).trim(),
      thoiGianGiaoHang: String(
        item?.thoiGianGiaoHang || item?.deliveryTime || "",
      ).trim(),
      donGiaDuToan: item?.donGiaDuToan ?? null,
      thanhTienDuToan: item?.thanhTienDuToan ?? null,
      ghiChu: String(item?.ghiChu || item?.note || "").trim(),
      sortOrder: index,
    });
  });
  return result;
}

function seedProcurementGoods(
  state,
  packageRecord,
  sourcePackage,
  createId,
  aggregate = null,
) {
  state.goithauhanghoa ||= [];
  const alreadyMaterialized = state.goithauhanghoa.some(
    (item) => String(item?.goiThauId || "") === String(packageRecord?.id || ""),
  );
  if (alreadyMaterialized) return [];
  const rows = mapProcurementGoods(
    sourcePackage?.danhSachHangHoa,
    packageRecord,
    createId,
  );
  state.goithauhanghoa.push(...rows);
  if (aggregate) {
    aggregate.goithauhanghoa ||= [];
    aggregate.goithauhanghoa.push(...rows);
  }
  return rows;
}

function mapAdditionalPurchaseItems(items, createId) {
  return (Array.isArray(items) ? items : []).map((item) => ({
    id: createId("tuychonmuathem"),
    sourceItemId: item?.sourceItemId || item?.id || null,
    hangMuc: item?.hangMuc || item?.name || "",
    donVi: item?.donVi || item?.unit || "",
    soLuong: item?.soLuong ?? item?.quantity ?? null,
    tyLe: item?.tyLe ?? item?.percentage ?? item?.percent ?? null,
    giaTriUocTinh: item?.giaTriUocTinh ?? item?.estimateValueVnd ?? item?.price ?? 0,
  }));
}

export function biddingPackageStatus(value) {
  return presentStatus(value).label;
}

export function deriveBidGuaranteeValidityDays(value) {
  const match = String(value ?? "").trim().match(/^\d+/);
  if (!match) return null;
  const days = Number.parseInt(match[0], 10);
  return Number.isInteger(days) && days > 0 ? days + 30 : null;
}

function hasValue(value) {
  return value !== null && value !== undefined && String(value).trim() !== "";
}

function packageGuaranteeValidity(sourcePackage, fallback = null) {
  if (hasValue(fallback)) return fallback;
  if (hasValue(sourcePackage?.hieuLucDamBaoDuThau)) {
    return sourcePackage.hieuLucDamBaoDuThau;
  }
  return deriveBidGuaranteeValidityDays(sourcePackage?.hieuLucHsdt);
}

function hasPublishedProcurementNotice(source) {
  const link = source?.noticeLink || {};
  return String(link.state || "").toUpperCase() === "LINKED"
    && String(link.kind || "").toUpperCase() === "TBMT"
    && Boolean(String(link.noticeNo || source?.maGoiThau || "").trim())
    && Boolean(String(link.noticeRevisionId || "").trim())
    && link.noticeVersion !== null
    && link.noticeVersion !== undefined
    && String(link.noticeVersion).trim() !== "";
}

export function resolveProcurementImportedPackageStatus({
  sourceStatus,
  existingStatus = null,
  isNew = false,
  hasPublishedNotice = false,
} = {}) {
  const source = normalizeStatus(sourceStatus);
  const existing = existingStatus == null ? null : normalizeStatus(existingStatus);
  if ([
    "OPENED", "EVALUATING", "PARTIALLY_AWARDED", "AWARDED", "CANCELLED",
  ].includes(existing)) {
    return presentStatus(existing).label;
  }
  if (existing === "INVITED") return presentStatus("INVITED").label;
  if (source === "PREPARING") return presentStatus("PREPARING").label;
  if (source === "INVITED") return presentStatus("INVITED").label;
  if (["OPENED", "EVALUATING", "PARTIALLY_AWARDED", "AWARDED"].includes(source)) {
    return presentStatus("INVITED").label;
  }
  if (source === "CANCELLED") {
    return presentStatus(hasPublishedNotice ? "INVITED" : "UNKNOWN").label;
  }
  if (!isNew && existing === "PREPARING" && hasPublishedNotice) {
    return presentStatus("INVITED").label;
  }
  return presentStatus(hasPublishedNotice ? "INVITED" : "UNKNOWN").label;
}

function importedAppraisal(existing = null) {
  if (existing && (
    String(existing.yeuCauThamDinhHsmtCode || "").trim()
    || String(existing.yeuCauThamDinhHsmt || "").trim()
  )) {
    return {
      yeuCauThamDinhHsmt: existing.yeuCauThamDinhHsmt,
      yeuCauThamDinhHsmtCode: existing.yeuCauThamDinhHsmtCode,
    };
  }
  return {
    yeuCauThamDinhHsmt: "Không",
    yeuCauThamDinhHsmtCode: "NOT_REQUIRED",
  };
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
    const lots = mapSourcePackageLots(sourcePackage, { createId });
    const packageRecord = createInitialVersion({
      ...sourcePackage,
      id: packageId,
      keHoachId: planId,
      phienBan: sourcePackageVersion(sourcePackage),
      trangThai: resolveProcurementImportedPackageStatus({
        sourceStatus: sourcePackage.trangThai,
        isNew: true,
        hasPublishedNotice: hasPublishedProcurementNotice(sourcePackage),
      }),
      ...importedAppraisal(),
      isThuoc: sourceBoolean(sourcePackage.goiThauThuoc) === true ? 1 : 0,
      tuyChonMuaThem: yesNo(sourcePackage.tuyChonMuaThem),
      phanLo: yesNo(sourcePackage.phanLo),
      phanLoList: lots,
      tuyChonMuaThemList: mapAdditionalPurchaseItems(
        sourcePackage.tuyChonMuaThemList,
        createId,
      ),
      giaTriDamBaoDuThau: sourcePackage.giaTriBaoDamDuThau ?? 0,
      hieuLucDamBaoDuThau: packageGuaranteeValidity(sourcePackage),
    }, { id: packageId, timestamp });
    packageRecord.phienBan = sourcePackageVersion(sourcePackage);
    packageRecord._procurementImportCurrent = true;
    return packageRecord;
  });
  state.goithau.push(...packages);
  packages.forEach((packageRecord, index) => {
    seedProcurementGoods(
      state,
      packageRecord,
      revisionDraft?.packageDrafts?.[index],
      createId,
    );
  });
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

export function procurementRevisionNumbersEqual(left, right) {
  const normalize = (value) => {
    const text = String(value ?? "").trim();
    return /^\d+$/.test(text) ? String(Number.parseInt(text, 10)) : text;
  };
  return normalize(left) === normalize(right);
}

export function materializeProcurementRevisionIntoExisting(
  state,
  existingPlanId,
  revisionDraft,
  { createId = generateRecordId, timestamp = new Date().toISOString() } = {},
) {
  const plan = (state.kehoach || []).find(
    (candidate) => String(candidate?.id) === String(existingPlanId),
  );
  if (!plan) throw new Error("PROCUREMENT_SOURCE_VERSION_CONFLICT");
  const revisionNumber = String(revisionDraft?.revisionNumber || "");
  if (!procurementRevisionNumbersEqual(plan.phienBan, revisionNumber)) {
    throw new Error("PROCUREMENT_SOURCE_VERSION_CONFLICT");
  }

  const draft = capturePlanBreakdownDraft(state, {
    planId: existingPlanId,
    action: "create",
  });
  const rowVersion = plan.rowVersion;
  Object.assign(plan, revisionDraft?.planDraft || {}, {
    id: plan.id,
    rootId: plan.rootId || plan.id,
    phienBan: revisionNumber,
    isLatest: 1,
    rowVersion,
    updatedAt: timestamp,
    _procurementImportCurrent: true,
  });

  const existingPackages = (state.goithau || []).filter(
    (pkg) => String(pkg?.keHoachId || "") === String(plan.id),
  );
  const existingByIdentity = new Map(
    existingPackages.map((pkg) => [sourcePackageIdentity(pkg), pkg]),
  );
  const packages = (revisionDraft?.packageDrafts || []).map((sourcePackage) => {
    const identity = sourcePackageIdentity(sourcePackage);
    const existing = identity ? existingByIdentity.get(identity) : null;
    if (!existing) {
      const packageId = createId("goithau");
      const created = createInitialVersion({
        ...sourcePackage,
        id: packageId,
        keHoachId: plan.id,
        phienBan: sourcePackageVersion(sourcePackage),
        trangThai: resolveProcurementImportedPackageStatus({
          sourceStatus: sourcePackage.trangThai,
          isNew: true,
          hasPublishedNotice: hasPublishedProcurementNotice(sourcePackage),
        }),
        ...importedAppraisal(),
        tuyChonMuaThem: yesNo(sourcePackage.tuyChonMuaThem),
        phanLo: yesNo(sourcePackage.phanLo),
        phanLoList: mapSourcePackageLots(sourcePackage, { createId }),
        tuyChonMuaThemList: mapAdditionalPurchaseItems(
          sourcePackage.tuyChonMuaThemList,
          createId,
        ),
        isThuoc: sourceBoolean(sourcePackage.goiThauThuoc) === true ? 1 : 0,
        giaTriDamBaoDuThau: sourcePackage.giaTriBaoDamDuThau ?? 0,
        hieuLucDamBaoDuThau: packageGuaranteeValidity(sourcePackage),
      }, { id: packageId, timestamp });
      created.phienBan = sourcePackageVersion(sourcePackage);
      created._procurementImportCurrent = true;
      state.goithau.push(created);
      seedProcurementGoods(state, created, sourcePackage, createId);
      return created;
    }
    const existingRowVersion = existing.rowVersion;
    const existingGuaranteeValidity = existing.hieuLucDamBaoDuThau;
    const appraisal = importedAppraisal(existing);
    Object.assign(existing, sourcePackage, {
      id: existing.id,
      rootId: existing.rootId || existing.id,
      keHoachId: plan.id,
      phienBan: sourcePackageVersion(sourcePackage, existing.phienBan),
      isLatest: 1,
      rowVersion: existingRowVersion,
      updatedAt: timestamp,
      trangThai: resolveProcurementImportedPackageStatus({
        sourceStatus: sourcePackage.trangThai,
        existingStatus: existing.trangThai,
        hasPublishedNotice: hasPublishedProcurementNotice(sourcePackage),
      }),
      ...appraisal,
      tuyChonMuaThem: yesNo(sourcePackage.tuyChonMuaThem),
      phanLo: yesNo(sourcePackage.phanLo),
      phanLoList: mapSourcePackageLots(sourcePackage, {
        createId,
        existingLots: existing.phanLoList,
      }),
      tuyChonMuaThemList: mapAdditionalPurchaseItems(
        sourcePackage.tuyChonMuaThemList,
        createId,
      ),
      isThuoc: sourceBoolean(sourcePackage.goiThauThuoc) === true ? 1 : 0,
      giaTriDamBaoDuThau: sourcePackage.giaTriBaoDamDuThau ?? 0,
      hieuLucDamBaoDuThau: packageGuaranteeValidity(
        sourcePackage,
        existingGuaranteeValidity,
      ),
      _procurementImportCurrent: true,
    });
    seedProcurementGoods(state, existing, sourcePackage, createId);
    existingByIdentity.delete(identity);
    return existing;
  });
  draft.planId = plan.id;
  return { draft, plan, packages };
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
    const existingGuaranteeValidity = packageRecord.hieuLucDamBaoDuThau;
    const appraisal = importedAppraisal(packageRecord);
    Object.assign(packageRecord, source, {
      id: packageRecord.id,
      rootId: packageRecord.rootId,
      keHoachId: planId,
      phienBan: sourcePackageVersion(source, packageRecord.phienBan),
      isLatest: 1,
      trangThai: resolveProcurementImportedPackageStatus({
        sourceStatus: source.trangThai,
        existingStatus: packageRecord.trangThai,
        hasPublishedNotice: hasPublishedProcurementNotice(source),
      }),
      ...appraisal,
      tuyChonMuaThem: yesNo(
        source.tuyChonMuaThem,
        packageRecord.tuyChonMuaThem || "Không",
      ),
      phanLo: yesNo(source.phanLo, packageRecord.phanLo || "Không"),
      phanLoList: (
        Array.isArray(source.danhSachPhanLo)
        || sourceBoolean(source.phanLo) !== null
      )
        ? mapSourcePackageLots(source, {
          createId,
          existingLots: packageRecord.phanLoList,
          fallbackHasLots: packageRecordHasLots(packageRecord),
        })
        : packageRecord.phanLoList,
      tuyChonMuaThemList: Array.isArray(source.tuyChonMuaThemList)
        ? mapAdditionalPurchaseItems(source.tuyChonMuaThemList, createId)
        : packageRecord.tuyChonMuaThemList,
      isThuoc: sourceBoolean(source.goiThauThuoc) === true
        ? 1
        : packageRecord.isThuoc,
      giaTriDamBaoDuThau: source.giaTriBaoDamDuThau
        ?? packageRecord.giaTriDamBaoDuThau,
      hieuLucDamBaoDuThau: packageGuaranteeValidity(
        source,
        existingGuaranteeValidity,
      ),
    });
    seedProcurementGoods(state, packageRecord, source, createId, aggregate);
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
      trangThai: resolveProcurementImportedPackageStatus({
        sourceStatus: source.trangThai,
        isNew: true,
        hasPublishedNotice: hasPublishedProcurementNotice(source),
      }),
      ...importedAppraisal(),
      tuyChonMuaThem: yesNo(source.tuyChonMuaThem),
      phanLo: yesNo(source.phanLo),
      phanLoList: mapSourcePackageLots(source, { createId }),
      tuyChonMuaThemList: mapAdditionalPurchaseItems(
        source.tuyChonMuaThemList,
        createId,
      ),
      isThuoc: sourceBoolean(source.goiThauThuoc) === true ? 1 : 0,
      giaTriDamBaoDuThau: source.giaTriBaoDamDuThau ?? 0,
      hieuLucDamBaoDuThau: packageGuaranteeValidity(source),
    }, { id: packageId, timestamp });
    created.phienBan = sourcePackageVersion(source);
    created._procurementImportCurrent = true;
    state.goithau.push(created);
    aggregate.goithau.push(created);
    seedProcurementGoods(state, created, source, createId, aggregate);
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

function setRadioValue(document, name, value) {
  const radio = document?.querySelector?.(
    `input[name="${name}"][value="${String(value)}"]`,
  );
  if (!radio || radio.disabled) return false;
  document?.querySelectorAll?.(`input[name="${name}"]`)?.forEach?.((candidate) => {
    candidate.checked = candidate === radio;
  });
  radio.checked = true;
  if (typeof globalThis.Event === "function") {
    radio.dispatchEvent(new globalThis.Event("input", { bubbles: true }));
    radio.dispatchEvent(new globalThis.Event("change", { bubbles: true }));
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
  const date = (value) => value
    ? controller?.model?.formatForDateInput?.(value) ?? value
    : "";
  const datetime = (value) => value
    ? controller?.model?.formatForDatetimeLocal?.(value) ?? value
    : "";
  const guaranteeValidity = packageGuaranteeValidity(packageDraft) ?? "";
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
    "gt-soquyetdinh": packageDraft?.soQuyetDinh,
    "gt-ngayquyetdinh": date(packageDraft?.ngayQuyetDinh),
    "gt-thoigiandangtai": datetime(packageDraft?.thoiGianDangTai),
    "gt-thoigiandongthau": datetime(packageDraft?.thoiGianDongThau),
    "gt-thoigianmothau": datetime(packageDraft?.thoiGianMoThau),
    "gt-thoigianmoehsdxtc": datetime(packageDraft?.thoiGianMoEhsdxtc),
    "gt-hieuluchsdt": packageDraft?.hieuLucHsdt ?? "",
    "gt-hieuluchbaomothau": guaranteeValidity,
    "gt-trangthai": biddingPackageStatus(packageDraft?.trangThai),
  };
  Object.entries(values).forEach(([id, value]) => setControlValue(document, id, value));
  const medicinePackage = sourceBoolean(packageDraft?.goiThauThuoc);
  if (medicinePackage !== null) {
    setRadioValue(document, "gt-goithauthuoc", medicinePackage ? "1" : "0");
  }
  if (
    Array.isArray(packageDraft?.danhSachPhanLo)
    || sourceBoolean(packageDraft?.phanLo) !== null
  ) {
    controller?._loadPhanLoRows?.(mapSourcePackageLots(packageDraft));
  }
  if (Array.isArray(packageDraft?.tuyChonMuaThemList)) {
    controller?._loadTuyChonMuaThemRows?.(packageDraft.tuyChonMuaThemList);
  }
  // Lot loading recalculates aggregate money fields. MSC can provide a
  // package-level value while leaving every lot-level guarantee empty; keep
  // the authoritative package total visible without inventing a per-lot
  // allocation.
  if (packageDraft?.giaGoiThau != null) {
    setControlValue(document, "gt-gia", money(packageDraft.giaGoiThau), { event: false });
  }
  if (packageDraft?.giaTriBaoDamDuThau != null) {
    setControlValue(
      document,
      "gt-giatribaomothau",
      money(packageDraft.giaTriBaoDamDuThau),
      { event: false },
    );
  }
  return values;
}
