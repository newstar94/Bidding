import { ProcurementLookupClient } from "./ProcurementLookupClient.js";
import {
  captureWorkspaceLease,
  isWorkspaceLeaseCurrent,
  workspaceChangedError,
} from "../app/workspaceLease.js";
import { generateRecordId } from "../shared/idUtils.js";
import { formatForDatetimeLocal } from "../shared/formatters.js";
import { parseBidDateTime } from "../shared/dateParseUtils.js";

const NOTICE_CODE = /^(IB\d{10})(?:-(\d{2}))?$/i;
const PREVIEW_SCHEMA = "biddingflow-procurement-preview-v1";

function lookupError(code, message) {
  const error = new Error(message);
  error.code = code;
  return error;
}

function revisionNumber(value) {
  const text = String(value ?? "").trim();
  if (!/^\d{1,16}$/.test(text)) {
    throw lookupError("PROCUREMENT_REVISION_INVALID", "Không xác định được phiên bản thông báo mời thầu của gói thầu.");
  }
  return text.replace(/^0+(?=\d)/, "").padStart(2, "0");
}

/** Resolve the notice version belonging to this record, including plan imports. */
export function resolveInvitationNoticeTarget(pkg) {
  const source = pkg?.sourceRevision || {};
  const noticeCodes = [pkg?.maGoiThau, pkg?.noticeLink?.noticeNo];
  if (String(source.familyNo || "").trim().toUpperCase().startsWith("IB")) {
    noticeCodes.push(source.familyNo);
  }
  const matches = noticeCodes
    .filter((value) => String(value ?? "").trim())
    .map((value) => String(value).trim().toUpperCase().match(NOTICE_CODE));
  if (!pkg?.id || !matches.length || matches.some((match) => !match)) {
    throw lookupError("PROCUREMENT_CODE_INVALID", "Gói thầu chưa có mã thông báo mời thầu IB hợp lệ.");
  }
  const noticeNo = matches[0][1];
  if (matches.some((match) => match[1] !== noticeNo)) {
    throw lookupError("PROCUREMENT_CODE_INVALID", "Mã thông báo mời thầu không khớp nguồn của gói thầu.");
  }
  // source.revisionNumber is a PLAN version when familyNo starts with PL.
  const versions = [source.packageRevisionNumber, pkg?.noticeLink?.noticeVersion];
  if (String(source.familyNo || "").trim().toUpperCase().startsWith("IB")) {
    versions.push(source.revisionNumber);
  }
  versions.push(...matches.map((match) => match[2]));
  const normalized = versions
    .filter((value) => String(value ?? "").trim())
    .map(revisionNumber);
  // Local successors can retain the same official notice provenance.
  if (!normalized.length && String(pkg?.phienBan ?? "").trim()) {
    normalized.push(revisionNumber(pkg.phienBan));
  }
  if (!normalized.length || normalized.some((value) => value !== normalized[0])) {
    throw lookupError("PROCUREMENT_REVISION_INVALID", "Phiên bản thông báo mời thầu chưa rõ hoặc không khớp gói thầu đang mở.");
  }
  return Object.freeze({
    noticeNo,
    revisionNumber: normalized[0],
    packageId: String(pkg.id),
    rootId: String(pkg.rootId || pkg.id),
    rowVersion: String(pkg.rowVersion ?? 1),
  });
}

function targetsEqual(left, right) {
  return ["noticeNo", "revisionNumber", "packageId", "rootId", "rowVersion"]
    .every((field) => left[field] === right[field]);
}

function sourceIdentity(row, kind) {
  if (kind === "extension") return String(row?.sourceExtensionId || "").trim();
  return String(row?.sourceRequestNo || "").trim()
    || String(row?.sourceRequestId || "").trim();
}

async function assignLocalInvitationRowIds(revision, target) {
  await Promise.all([
    ["request", "clarificationRequests"],
    ["response", "clarificationResponses"],
    ["extension", "extensions"],
  ].flatMap(([kind, field]) => (Array.isArray(revision[field]) ? revision[field] : []).map(async (row) => {
    row.sourceNoticeVersion = revisionNumber(revision.revisionNumber);
    const identity = sourceIdentity(row, kind);
    if (!identity) return;
    const bytes = new TextEncoder().encode(JSON.stringify([
      target.packageId, target.noticeNo, row.sourceNoticeVersion, kind, identity,
    ]));
    const digest = await globalThis.crypto.subtle.digest("SHA-256", bytes);
    const prefix = kind === "extension" ? "gh" : "lr";
    row.localRowId = `${prefix}-${Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, "0")).join("")}`;
  })));
}

function compareRevisionNumbers(left, right) {
  return BigInt(left) < BigInt(right) ? -1 : BigInt(left) > BigInt(right) ? 1 : 0;
}

function aggregateInvitationHistory(preview, target) {
  const seen = new Set();
  const history = [];
  for (const source of preview.canonical.revisions) {
    const version = revisionNumber(source?.revisionNumber);
    if (String(source?.noticeNo || "").trim().toUpperCase() !== target.noticeNo || seen.has(version)) {
      throw lookupError("PROCUREMENT_REVISION_INVALID", "Dữ liệu lịch sử không khớp mã và phiên bản thông báo mời thầu.");
    }
    seen.add(version);
    history.push({ ...structuredClone(source), revisionNumber: version });
  }
  history.sort((left, right) => compareRevisionNumbers(left.revisionNumber, right.revisionNumber));
  const quotaSkipped = (Array.isArray(preview.usageCredits?.skipped) ? preview.usageCredits.skipped : [])
    .filter((item) => item.entityKind === "NOTICE" && item.sourceCode === target.noticeNo
      && item.reasonCode === "QUOTA_EXHAUSTED")
    .map((item) => revisionNumber(item.sourceRevision));
  const selected = history.find((source) => source.revisionNumber === target.revisionNumber);
  if (!selected) {
    if (quotaSkipped.includes(target.revisionNumber)) {
      const error = lookupError("QUOTA_EXHAUSTED", "Chưa lấy được phiên bản TBMT của gói thầu do không đủ lượt Mua Sắm Công.");
      error.details = { usageCredits: structuredClone(preview.usageCredits) };
      throw error;
    }
    throw lookupError("PROCUREMENT_REVISION_INVALID", "Không tìm thấy đúng phiên bản thông báo mời thầu của gói thầu đang mở.");
  }
  const missingRevisions = [...new Set([
    ...Object.keys(preview.rawBundle?.revisions || {}), ...quotaSkipped,
  ])]
    .map(revisionNumber)
    .filter((version) => !seen.has(version));
  return { selected, history, missingRevisions };
}

function aggregateAvailableRows(history, fields, availableField, statusField, missingRevisions) {
  const available = history.filter((revision) => revision[availableField] === true);
  const unavailableVersions = [
    ...history.filter((revision) => revision[availableField] !== true).map((revision) => revision.revisionNumber),
    ...missingRevisions,
  ];
  const result = {
    [availableField]: available.length > 0,
    [statusField]: unavailableVersions.length && available.length ? "PARTIAL_HISTORY"
      : available.length ? "AVAILABLE" : history.at(-1)?.[statusField] || "SOURCE_UNAVAILABLE",
  };
  for (const field of fields) {
    result[field] = available.flatMap((revision) => Array.isArray(revision[field]) ? revision[field] : []);
  }
  return result;
}

/** Fetch all extensions and clarifications through the record's version, without saving. */
export async function lookupPackageInvitationUpdates({
  pkg,
  model,
  client = new ProcurementLookupClient(),
  signal,
} = {}) {
  const target = resolveInvitationNoticeTarget(pkg);
  const lease = captureWorkspaceLease(model);
  const storage = model?.workspaceStorage;
  const assertCurrent = () => {
    if (signal?.aborted || !isWorkspaceLeaseCurrent(model, lease)
      || model?.workspaceStorage !== storage) throw workspaceChangedError();
    const packageRows = model?.state?.goithau;
    const current = Array.isArray(packageRows)
      ? packageRows.find((row) => String(row?.id) === target.packageId)
      : pkg;
    try {
      if (!targetsEqual(target, resolveInvitationNoticeTarget(pkg))
        || !targetsEqual(target, resolveInvitationNoticeTarget(current))) {
        throw workspaceChangedError();
      }
    } catch {
      throw workspaceChangedError();
    }
  };
  assertCurrent();
  const preview = await client.lookup({
    code: target.noticeNo,
    workspaceLease: String(model?.workspaceScope?.organizationId || "").trim() || null,
    detailLevel: "COMPLETE",
    revisionMode: "ALL",
  }, { signal });
  assertCurrent();
  const canonical = preview?.canonical;
  if (preview?.schemaVersion !== PREVIEW_SCHEMA || preview?.kind !== "PACKAGE"
    || preview?.canonicalCode !== target.noticeNo
    || canonical?.canonicalCode !== target.noticeNo
    || !Array.isArray(canonical?.revisions)) {
    throw lookupError("PROCUREMENT_SCHEMA_CHANGED", "Kết quả lấy dữ liệu không khớp thông báo mời thầu.");
  }
  const { selected, history, missingRevisions } = aggregateInvitationHistory(preview, target);
  await Promise.all(history.map((revision) => assignLocalInvitationRowIds(revision, target)));
  const clarificationHistory = history.filter((source) => compareRevisionNumbers(source.revisionNumber, target.revisionNumber) <= 0);
  const missingClarificationRevisions = missingRevisions.filter((version) => compareRevisionNumbers(version, target.revisionNumber) <= 0);
  const revision = {
    ...selected,
    ...aggregateAvailableRows(clarificationHistory, ["clarificationRequests", "clarificationResponses"], "clarificationAvailable", "clarificationStatus", missingClarificationRevisions),
    ...aggregateAvailableRows(history, ["extensions"], "extensionAvailable", "extensionStatus", missingRevisions),
  };
  assertCurrent();
  return {
    target, revision,
    ...(preview.usageCredits ? { usageCredits: structuredClone(preview.usageCredits) } : {}),
    history: {
      missingRevisions,
      revisions: history.map((source) => ({
        revisionNumber: source.revisionNumber,
        clarificationIncluded: compareRevisionNumbers(source.revisionNumber, target.revisionNumber) <= 0,
        clarificationAvailable: source.clarificationAvailable === true,
        clarificationStatus: source.clarificationStatus || "SOURCE_UNAVAILABLE",
        extensionAvailable: source.extensionAvailable === true,
        extensionStatus: source.extensionStatus || "SOURCE_UNAVAILABLE",
      })),
    },
  };
}

function normalizedContent(value) {
  return String(value ?? "").replace(/\r\n?/g, "\n").trim();
}

function sourceKey(row, kind) {
  if (row?.sourceKey) return String(row.sourceKey);
  const identity = row?.localRowId ? String(row.localRowId) : sourceIdentity(row, kind);
  return identity ? JSON.stringify([kind, row?.sourceNoticeVersion || "", identity]) : "";
}

/** Append source rows while retaining every current row, including incomplete edits. */
export function mergeInvitationUpdateRows(currentRows, sourceRows, {
  kind,
  formatDateTime = formatForDatetimeLocal,
  generateId = generateRecordId,
} = {}) {
  const request = kind === "request";
  const extension = kind === "extension";
  if (!request && !extension && kind !== "response") throw new TypeError("Invalid invitation row kind.");
  const timeField = extension ? "thoiGianDongThau" : request ? "thoiGianYeuCau" : "thoiGianTraLoi";
  const contentField = extension ? "lyDoGiaHan" : request ? "noiDungYeuCau" : "noiDungTraLoi";
  const sourceTimeField = extension ? "newClosingAt" : request ? "requestedAt" : "respondedAt";
  const sourceContentField = extension ? "reason" : "content";
  const persistedImportId = extension ? /^gh-[a-f0-9]{64}$/ : /^lr-[a-f0-9]{64}$/;
  const rows = (Array.isArray(currentRows) ? currentRows : []).map((row) => ({ ...row }));
  const currentById = new Map();
  const currentBySourceKey = new Map();
  const unkeyedContentRows = new Map();
  const sourceKeys = new Set();
  const contentIdentity = (time, content) => JSON.stringify([
    formatDateTime(time), normalizedContent(content),
  ]);
  rows.forEach((row) => {
    const id = String(row.id || "");
    if (id) currentById.set(id, row);
    const key = sourceKey(row, kind);
    if (key) {
      sourceKeys.add(key);
      currentBySourceKey.set(key, row);
    }
    if (!key && !persistedImportId.test(id)
      && row[timeField] && normalizedContent(row[contentField])) {
      const identity = contentIdentity(row[timeField], row[contentField]);
      const candidates = unkeyedContentRows.get(identity) || [];
      candidates.push(row);
      unkeyedContentRows.set(identity, candidates);
    }
  });
  let added = 0;
  let skipped = 0;
  let matched = 0;
  let linked = 0;
  (Array.isArray(sourceRows) ? sourceRows : []).forEach((sourceRow) => {
    const time = formatDateTime(sourceRow?.[sourceTimeField]);
    const content = String(sourceRow?.[sourceContentField] ?? "");
    const identity = contentIdentity(time, content);
    const key = sourceKey(sourceRow, kind);
    const localId = String(sourceRow?.localRowId || "");
    if (!time || !normalizedContent(content)) {
      skipped += 1;
      return;
    }
    const existing = (key && currentBySourceKey.get(key)) || (localId && currentById.get(localId))
      || unkeyedContentRows.get(identity)?.shift();
    if (existing) {
      if (localId && String(existing.id || "") !== localId) {
        currentById.delete(String(existing.id || ""));
        existing.id = localId;
        currentById.set(localId, existing);
        linked += 1;
      }
      if (key && !existing.sourceKey) {
        existing.sourceKey = key;
        matched += 1;
      }
      if (extension && sourceRow.previousClosingAt && !existing.sourcePreviousClosingAt) {
        existing.sourcePreviousClosingAt = String(sourceRow.previousClosingAt);
        matched += 1;
      }
      if (key) sourceKeys.add(key);
      if (key) currentBySourceKey.set(key, existing);
      skipped += 1;
      return;
    }
    if (key && sourceKeys.has(key)) {
      skipped += 1;
      return;
    }
    const row = {
      id: localId || generateId(extension ? "giahan" : request ? "yeucaulamro" : "traloilamro"),
      [timeField]: time,
      [contentField]: content,
      ...(key ? { sourceKey: key } : {}),
      ...(extension && sourceRow.previousClosingAt
        ? { sourcePreviousClosingAt: String(sourceRow.previousClosingAt) } : {}),
    };
    rows.push(row);
    currentById.set(row.id, row);
    if (key) sourceKeys.add(key);
    if (key) currentBySourceKey.set(key, row);
    added += 1;
  });
  let reordered = false;
  if (extension && Array.isArray(sourceRows) && sourceRows.length) {
    const before = rows.map((row) => row.id);
    rows.sort((left, right) => {
      const leftTime = parseBidDateTime(left.thoiGianDongThau)?.getTime();
      const rightTime = parseBidDateTime(right.thoiGianDongThau)?.getTime();
      const leftValid = Number.isFinite(leftTime);
      const rightValid = Number.isFinite(rightTime);
      if (!leftValid || !rightValid) return Number(rightValid) - Number(leftValid);
      return leftTime - rightTime;
    });
    reordered = rows.some((row, index) => row.id !== before[index]);
  }
  return { rows, added, skipped, matched, linked, reordered };
}
