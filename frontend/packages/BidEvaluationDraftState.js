import {
  parseEvaluationMetadataStrict,
  serializeEvaluationMetadata,
} from "./evaluationMetadata.js";

const BID_FIELD_READERS = Object.freeze({
  danhGiaHopLe: [".mt-dg-hop-le", readText],
  danhGiaNangLuc: [".mt-dg-nang-luc", readText],
  danhGiaKyThuat: [".mt-dg-ky-thuat", readText],
  danhGiaKetLuan: [".mt-dg-ketluan", readText],
  danhGiaTaiChinh: [".mt-dg-xep-hang", readText],
  lamRoHopLe: [".mt-lam-ro-hop-le", readText],
  lamRoNangLuc: [".mt-lam-ro-nang-luc", readText],
  lamRoKyThuat: [".mt-lam-ro-ky-thuat", readText],
  lamRoTaiChinh: [".mt-lam-ro-tai-chinh", readText],
  nguyenNhanKhongDatHopLe: [".mt-reason-fail-hople", readText],
  nguyenNhanKhongDatNangLuc: [".mt-reason-fail-nangluc", readText],
  nguyenNhanKhongDatKyThuat: [".mt-reason-fail-kythuat", readText],
  giaDuThau: [".mt-gia-du-thau", readMoney],
  giaSauGiamGia: [".mt-gia-sau-giam-gia", readMoney],
  giaXepHang: [".mt-gia-xep-hang", readMoney],
  giaDeNghiTrungThau: [".mt-gia-de-nghi-trung-thau", readMoney],
  giaTriDamBao: [".mt-gia-tri-dam-bao", readMoney],
  tyLeGiamGia: [".mt-ty-le-giam-gia", readDecimal],
  hieuLucHsdt: [".mt-hieu-luc-hsdt", readInteger],
  hieuLucBaoDamNgay: [".mt-hieu-luc-bao-dam-ngay", readInteger],
  thoiGianThucHien: [".mt-thoi-gian-thuc-hien", readText],
  chapThuanGiaDeNghiTrungThauDuoi50: [".mt-low-price-acceptance", readLowPriceAcceptance],
});

export const BID_EVALUATION_FIELD_BY_SELECTOR = Object.freeze(Object.fromEntries(
  Object.entries(BID_FIELD_READERS).map(([field, [selector]]) => [selector, field]),
));

export const BID_EVALUATION_SELECTOR_BY_FIELD = Object.freeze(Object.fromEntries(
  Object.entries(BID_EVALUATION_FIELD_BY_SELECTOR).map(([selector, field]) => [field, selector]),
));

function readText(control) {
  return String(control?.value ?? control?.textContent ?? "").trim();
}

function readMoney(control, parseMoney) {
  const raw = readText(control);
  return raw ? parseMoney(raw) : "";
}

function readDecimal(control) {
  const raw = readText(control).replace(/,/g, ".");
  if (!raw) return "";
  const value = Number.parseFloat(raw);
  return Number.isFinite(value) ? value : "";
}

function readInteger(control) {
  const raw = readText(control).replace(/[^0-9-]/g, "");
  if (!raw) return "";
  const value = Number.parseInt(raw, 10);
  return Number.isFinite(value) ? value : "";
}

function readLowPriceAcceptance(_control, _parseMoney, row) {
  const value = row?.querySelector?.(".mt-low-price-acceptance:checked")?.value;
  if (value === "true") return true;
  if (value === "false") return false;
  return null;
}

function normalizedResult(value) {
  return String(value || "").trim().toLocaleLowerCase("vi-VN");
}

function dependencyInvalidations(patch, current) {
  if (Object.prototype.hasOwnProperty.call(patch, "danhGiaHopLe")) {
    const validity = normalizedResult(patch.danhGiaHopLe);
    if (validity && validity !== "đạt") {
      Object.assign(patch, {
        danhGiaNangLuc: "",
        danhGiaKyThuat: "",
        danhGiaKetLuan: "Không đạt yêu cầu về tính hợp lệ",
        danhGiaTaiChinh: "--",
      });
      return patch;
    }
    if (validity === "đạt" && normalizedResult(current?.danhGiaHopLe) !== "đạt") {
      if (String(current?.danhGiaKetLuan || "").startsWith("Không đạt yêu cầu về tính hợp lệ")) {
        patch.danhGiaKetLuan = "";
        patch.danhGiaTaiChinh = "--";
      }
    }
  }
  if (Object.prototype.hasOwnProperty.call(patch, "danhGiaNangLuc")) {
    const capacity = normalizedResult(patch.danhGiaNangLuc);
    if (capacity && capacity !== "đạt") {
      Object.assign(patch, {
        danhGiaKyThuat: "",
        danhGiaKetLuan: "Không đạt yêu cầu về năng lực, kinh nghiệm",
        danhGiaTaiChinh: "--",
      });
    } else if (
      capacity === "đạt"
      && normalizedResult(current?.danhGiaNangLuc) !== "đạt"
      && String(current?.danhGiaKetLuan || "").startsWith("Không đạt yêu cầu về năng lực")
    ) {
      patch.danhGiaKetLuan = "";
      patch.danhGiaTaiChinh = "--";
    }
  }
  return patch;
}

class BidEvaluationDirtyState {
  constructor() {
    this.sequence = 0;
    this.reportFields = new Map();
    this.bidFields = new Map();
  }

  markReportField(field) {
    if (!field) return;
    this.reportFields.set(String(field), ++this.sequence);
  }

  markBidField(bidId, field) {
    const id = String(bidId || "").trim();
    if (!id || !field) return;
    if (!this.bidFields.has(id)) this.bidFields.set(id, new Map());
    this.bidFields.get(id).set(String(field), ++this.sequence);
  }

  fieldsForBid(bidId) {
    return new Set(this.bidFields.get(String(bidId || ""))?.keys() || []);
  }

  hasChanges() {
    return this.reportFields.size > 0
      || [...this.bidFields.values()].some((fields) => fields.size > 0);
  }

  checkpoint() {
    return {
      reportFields: new Map(this.reportFields),
      bidFields: new Map([...this.bidFields].map(([id, fields]) => [id, new Map(fields)])),
    };
  }

  acknowledge(checkpoint, result) {
    if (!result?.ok || !checkpoint) return false;
    checkpoint.reportFields?.forEach((token, field) => {
      if (this.reportFields.get(field) === token) this.reportFields.delete(field);
    });
    checkpoint.bidFields?.forEach((fields, bidId) => {
      const current = this.bidFields.get(bidId);
      fields.forEach((token, field) => {
        if (current?.get(field) === token) current.delete(field);
      });
      if (current?.size === 0) this.bidFields.delete(bidId);
    });
    return true;
  }
}

export function createBidEvaluationDirtyState() {
  return new BidEvaluationDirtyState();
}

export function collectBidEvaluationDraftPatches({
  rows = [],
  bids = [],
  dirtyState,
  parseMoney = (value) => value,
} = {}) {
  if (!dirtyState || typeof dirtyState.fieldsForBid !== "function") return [];
  const bidsById = new Map((bids || []).map((bid) => [String(bid?.id || ""), bid]));
  const patches = [];
  for (const row of rows || []) {
    const bidId = String(row?.getAttribute?.("data-bid-id") || "");
    const current = bidsById.get(bidId);
    if (!current) continue;
    const fields = dirtyState.fieldsForBid(bidId);
    if (fields.size === 0) continue;
    const patch = {
      id: current.id,
      ...(Number.isInteger(current.rowVersion) ? { rowVersion: current.rowVersion } : {}),
    };
    fields.forEach((field) => {
      const definition = BID_FIELD_READERS[field];
      if (!definition) return;
      const [selector, reader] = definition;
      const control = row.querySelector?.(selector);
      if (!control || control.disabled) return;
      patch[field] = reader(control, parseMoney, row);
    });
    dependencyInvalidations(patch, current);
    if (Object.keys(patch).some((field) => field !== "id" && field !== "rowVersion")) {
      patches.push(patch);
    }
  }
  return patches;
}

export function applyBidEvaluationPatches(bids = [], patches = []) {
  const byId = new Map((bids || []).map((bid) => [String(bid?.id || ""), bid]));
  patches.forEach((patch) => {
    const target = byId.get(String(patch?.id || ""));
    if (!target) return;
    Object.entries(patch).forEach(([field, value]) => {
      if (field !== "id" && field !== "rowVersion") target[field] = value;
    });
  });
  return bids;
}

export function evaluationDraftScopeKey(lotIds = []) {
  return [...new Set((lotIds || []).map(String).filter(Boolean))].sort().join("|");
}

function draftBlock(report, now) {
  return {
    ...(report || {}),
    saved: false,
    trangThai: "draft",
    hoanThanhLuc: null,
    draftSavedAt: now(),
  };
}

function mergeDraftIntoRound(roundBlock, report, lotIds, now) {
  const block = draftBlock(report, now);
  const scopeKey = evaluationDraftScopeKey(lotIds);
  if (!scopeKey) return { ...(roundBlock || {}), ...block };
  return {
    ...(roundBlock || {}),
    draftScopes: {
      ...(roundBlock?.draftScopes || {}),
      [scopeKey]: {
        ...(roundBlock?.draftScopes?.[scopeKey] || {}),
        ...block,
        lotIds: [...new Set(lotIds.map(String))],
      },
    },
  };
}

export function buildBidEvaluationDraftMetadata({
  existing,
  round = "single",
  lotIds = [],
  report = {},
  now = () => new Date().toISOString(),
} = {}) {
  const metadata = parseEvaluationMetadataStrict(existing);
  if (round === "technical" || round === "financial") {
    metadata.is1G2T = true;
    metadata.technical = metadata.technical && typeof metadata.technical === "object"
      ? metadata.technical
      : { saved: false };
    metadata.financial = metadata.financial && typeof metadata.financial === "object"
      ? metadata.financial
      : { saved: false };
    metadata[round] = mergeDraftIntoRound(metadata[round], report, lotIds, now);
    metadata[round].saved = false;
    return serializeEvaluationMetadata(metadata);
  }
  return serializeEvaluationMetadata(mergeDraftIntoRound(metadata, report, lotIds, now));
}
