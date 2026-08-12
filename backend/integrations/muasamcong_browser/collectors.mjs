import crypto from "node:crypto";

import { resolveEndpoint } from "./endpoint_catalog.mjs";


function asObject(value) {
  return value && typeof value === "object" && !Array.isArray(value) ? value : {};
}


function asArray(value) {
  return Array.isArray(value) ? value : [];
}


function walk(value, visitor, depth = 0) {
  if (depth > 10 || value === null || typeof value !== "object") return;
  visitor(value);
  const children = Array.isArray(value) ? value : Object.values(value);
  for (const child of children.slice(0, 2_000)) walk(child, visitor, depth + 1);
}


function findBestObject(value, fields, exactField = null, exactValue = null) {
  let best = null;
  let bestScore = -1;
  walk(value, (candidate) => {
    if (Array.isArray(candidate)) return;
    if (
      exactField
      && String(candidate[exactField] || "").trim().toUpperCase()
        .replace(/-\d{2}$/, "") !== String(exactValue || "").trim().toUpperCase().replace(/-\d{2}$/, "")
    ) return;
    const score = fields.reduce((total, field) => total + Number(candidate[field] != null), 0);
    if (score > bestScore) {
      best = candidate;
      bestScore = score;
    }
  });
  return best;
}


function responseVersions(response) {
  const direct = asArray(asObject(response).versionList);
  if (direct.length) return direct;
  let result = [];
  walk(response, (value) => {
    if (!Array.isArray(value)) return;
    const rows = value.filter((row) => row && typeof row === "object" && row.id);
    if (
      rows.length > result.length
      && rows.some((row) => row.planVersion != null || row.notifyVersion != null)
    ) result = rows;
  });
  return result;
}


function canonicalRevision(row, numberField, familyField, familyNo) {
  return {
    revisionId: String(row?.id || row?.revisionId || ""),
    revisionNumber: String(row?.[numberField] ?? row?.revisionNumber ?? "").padStart(2, "0"),
    familyNo: String(row?.[familyField] || familyNo || "").trim().toUpperCase(),
    processApply: String(row?.processApply || ""),
  };
}


function fingerprint(value, kind) {
  const keys = new Set();
  walk(value, (candidate) => {
    if (!Array.isArray(candidate)) Object.keys(candidate).forEach((key) => keys.add(key));
  });
  const characteristic = [...keys]
    .filter((key) => [
      "planNo", "planVersion", "notifyNo", "notifyVersion", "notifyId",
      "bidName", "bidPrice", "bidOpenId", "inputResultId", "bidOpenView",
      "lotNoValueDTOList", "techReqId", "contractorCode", "contractorName",
      "isWinner", "technicalStatus", "evaluatedPrice", "decisionNo",
      "approvalDecisionNo",
    ].includes(key))
    .sort();
  const digest = crypto.createHash("sha256")
    .update(characteristic.join("\n"))
    .digest("hex")
    .slice(0, 12);
  return `${kind}:${characteristic.length ? "v1" : "unknown"}:${digest}`;
}


function buildSearchPayload(code, type) {
  return [{
    pageSize: "20",
    pageNumber: "0",
    query: [{
      index: "es-contractor-selection",
      keyWord: code,
      keyWordNotMatch: "",
      matchType: "all-1",
      matchFields: [
        "planNo", "notifyNo", "planNoStand", "notifyNoStand", "bidName", "name",
        "pno", "pname", "contractCode", "investorName", "investorCode",
        "procuringEntityName", "procuringEntityCode",
      ],
      filters: [{ fieldName: "type", searchType: "in", fieldValues: [type] }],
    }],
  }];
}


function stableJson(value) {
  if (Array.isArray(value)) return `[${value.map(stableJson).join(",")}]`;
  if (value && typeof value === "object") {
    return `{${Object.keys(value).sort().map((key) => (
      `${JSON.stringify(key)}:${stableJson(value[key])}`
    )).join(",")}}`;
  }
  return JSON.stringify(value);
}


function contentHash(value) {
  return crypto.createHash("sha256").update(stableJson(value)).digest("hex");
}


const SECRET_KEY = /authorization|cookie|token|captcha|secret/i;


function sanitizedRequest(value) {
  if (Array.isArray(value)) return value.map(sanitizedRequest);
  if (!value || typeof value !== "object") return value;
  return Object.fromEntries(Object.entries(value).map(([key, child]) => [
    key,
    SECRET_KEY.test(key) ? "[REDACTED]" : sanitizedRequest(child),
  ]));
}


function packageRows(value) {
  let best = [];
  walk(value, (candidate) => {
    if (!Array.isArray(candidate)) return;
    const rows = candidate.filter((row) => (
      row && typeof row === "object" && !Array.isArray(row)
      && (row.idDetail || row.bidName || row.bidNo)
    ));
    if (rows.length > best.length) best = rows;
  });
  return best;
}


function packageKey(row, index) {
  return String(
    row?.idDetail || row?.id || row?.bidNo || `package-${index + 1}`,
  );
}


function sortRevisions(rows) {
  return [...rows].sort((left, right) => String(left.revisionNumber || "")
    .localeCompare(String(right.revisionNumber || ""), "vi", { numeric: true }));
}


function selectRevisions(rows, options) {
  const ordered = sortRevisions(rows);
  const mode = String(options?.revisionMode || "ALL").toUpperCase();
  if (mode === "ALL") return ordered;
  if (mode === "LATEST") return ordered.length ? [ordered.at(-1)] : [];
  if (mode === "SELECTED") {
    const selected = new Set(asArray(options?.revisionNumbers).map((value) => (
      String(value).padStart(2, "0")
    )));
    return ordered.filter((row) => selected.has(row.revisionNumber));
  }
  throw new Error("PROCUREMENT_ADAPTER_UNSUPPORTED");
}


export function rawBundleSourceEnvelopes(bundle) {
  const isEnvelope = (source) => (
    source && typeof source.operation === "string" && typeof source.success === "boolean"
  );
  const envelopes = Object.values(asObject(bundle?.sources)).filter(isEnvelope);
  for (const revision of Object.values(asObject(bundle?.revisions))) {
    envelopes.push(...Object.values(asObject(revision?.sources)).filter(isEnvelope));
    for (const childGroup of ["packages", "lots", "children"]) {
      for (const child of Object.values(asObject(revision?.[childGroup]))) {
        envelopes.push(...Object.values(asObject(child?.sources)).filter(isEnvelope));
      }
    }
  }
  return envelopes;
}


export function buildRawSourceManifest(bundle) {
  const envelopes = rawBundleSourceEnvelopes(bundle);
  const revisions = Object.keys(asObject(bundle?.revisions)).sort((left, right) => (
    left.localeCompare(right, "vi", { numeric: true })
  ));
  return {
    sourceCount: envelopes.length,
    successCount: envelopes.filter((source) => source.success).length,
    failedCount: envelopes.filter((source) => !source.success).length,
    revisions,
    packages: Object.values(asObject(bundle?.revisions)).reduce(
      (total, revision) => total + Object.keys(asObject(revision?.packages)).length,
      0,
    ),
    operations: [...new Set(envelopes.map((source) => source.operation))],
  };
}


async function mapConcurrent(values, concurrency, iteratee) {
  const items = [...values];
  const results = new Array(items.length);
  let cursor = 0;
  const workers = Array.from(
    { length: Math.min(items.length, Math.max(1, Number(concurrency) || 1)) },
    async () => {
      while (cursor < items.length) {
        const index = cursor;
        cursor += 1;
        results[index] = await iteratee(items[index], index);
      }
    },
  );
  await Promise.all(workers);
  return results;
}


function findFirstValue(value, field) {
  let result;
  walk(value, (candidate) => {
    if (result === undefined && !Array.isArray(candidate) && candidate[field] != null) {
      result = candidate[field];
    }
  });
  return result;
}


function usableIdentifier(value) {
  const normalized = String(value ?? "").trim();
  return normalized && normalized.toLowerCase() !== "undefined" ? normalized : null;
}


function linkedPlanReference(detail, merged, planNo) {
  const normalizedPlanNo = String(planNo || "").trim().toUpperCase();
  const bidNo = usableIdentifier(merged?.bidNo || findFirstValue(detail, "bidNo"));
  const candidates = [];
  walk(detail, (item) => {
    if (Array.isArray(item)) return;
    const itemPlanNo = String(item?.planNo || "").trim().toUpperCase();
    const itemBidNo = String(item?.bidNo || "").trim().toUpperCase();
    if (itemPlanNo && itemPlanNo !== normalizedPlanNo) return;
    if (bidNo && itemBidNo && itemBidNo !== bidNo.toUpperCase()) return;
    const idPlan = usableIdentifier(item?.idPlan || item?.planRevisionId);
    const planVersion = usableIdentifier(item?.planVersion);
    if (idPlan || planVersion) candidates.push({ idPlan, planVersion });
  });
  const exact = candidates.find((item) => item.idPlan) || candidates[0] || {};
  return {
    idPlan: usableIdentifier(merged?.idPlan || merged?.planRevisionId) || exact.idPlan || null,
    planVersion: usableIdentifier(merged?.planVersion) || exact.planVersion || null,
  };
}


function resolveLinkedPlanRevision(planVersions, reference) {
  const versions = responseVersions(planVersions);
  const idPlan = usableIdentifier(reference?.idPlan);
  if (idPlan) {
    const matches = versions.filter((row) => String(row?.id || "") === idPlan);
    if (matches.length === 1) return matches[0];
  }
  const planVersion = usableIdentifier(reference?.planVersion);
  if (planVersion) {
    const normalized = String(planVersion).padStart(2, "0");
    const matches = versions.filter((row) => (
      String(row?.planVersion ?? "").padStart(2, "0") === normalized
    ));
    if (matches.length === 1) return matches[0];
  }
  return versions.length === 1 ? versions[0] : null;
}


function flagEnabled(value) {
  if (value === true || value === 1) return true;
  return ["1", "TRUE", "YES", "Y", "CO", "CÓ"].includes(
    String(value ?? "").trim().toUpperCase(),
  );
}


function sourceMetrics(metadata) {
  return Object.fromEntries(Object.entries(metadata || {})
    .filter(([, value]) => ["number", "boolean"].includes(typeof value)));
}


const OPENING_OPERATIONS = new Set([
  "OPENING_NOTIFY",
  "OPENING_ROUND",
  "OPENING_SUBMISSION",
  "OPENING_BID",
  "OPENING_LOT",
  "OPENING_LOT_DETAIL",
  "OPENING_FINANCIAL_AVAILABLE",
  "OPENING_FINANCIAL_DETAIL",
]);


const GENERIC_DETAIL_OPERATIONS = Object.freeze({
  "es-plan-overall-p": "PLAN_OVERALL_DETAIL",
  "es-ycbg": "QUOTE_REQUEST_DETAIL",
  "es-notify-prequalification": "PREQUALIFICATION_NOTICE_DETAIL",
  "es-notify-interest": "INTEREST_NOTICE_DETAIL",
  "es-bido-interest-notify": "BIDO_INTEREST_NOTICE_DETAIL",
  "es-prequalification-open": "PREQUALIFICATION_OPENING_DETAIL",
  "es-interest-open": "INTEREST_OPENING_DETAIL",
  "es-prequalification-result": "PREQUALIFICATION_RESULT_DETAIL",
  "es-interest-result": "INTEREST_RESULT_DETAIL",
  "es-bide-contractor-input-result-other": "INPUT_RESULT_OTHER_DETAIL",
  "es-shopping-result": "SHOPPING_RESULT_DETAIL",
  "es-ct-publish-frame": "CONTRACT_PUBLISH_FRAME_DETAIL",
});


function exactSearchRecord(response, code, field) {
  const canonical = String(code).toUpperCase().replace(/-\d{2}$/, "");
  let result = null;
  walk(response, (candidate) => {
    if (result || Array.isArray(candidate)) return;
    const observed = String(candidate[field] || "").toUpperCase().replace(/-\d{2}$/, "");
    if (observed === canonical) result = candidate;
  });
  return result;
}


export class MscCollectors {
  constructor({
    client,
    clock = () => new Date().toISOString(),
    collectionConcurrency = 4,
  }) {
    this.client = client;
    this.clock = clock;
    this.collectionConcurrency = Math.max(
      1, Math.min(Number(collectionConcurrency) || 4, 16),
    );
    this.noticeRevisionHints = new Map();
  }

  async search(code, kind) {
    const type = kind === "PLAN" ? "es-plan-project-p" : "es-notify-contractor";
    const field = kind === "PLAN" ? "planNo" : "notifyNo";
    const request = buildSearchPayload(code, type);
    const response = await this.client.request("SEARCH", request);
    const record = exactSearchRecord(response.data, code, field);
    if (!record) throw new Error("PROCUREMENT_NOT_FOUND");
    return {
      record,
      raw: response.data,
      request,
      fingerprint: fingerprint(response.data, "search"),
      retrievedAt: this.clock(),
      metadata: response.metadata,
    };
  }

  async listPlanRevisions(planNo) {
    const response = await this.client.request("PLAN_VERSION_LIST", { planNo });
    const revisions = responseVersions(response.data)
      .filter((row) => row?.id)
      .map((row) => canonicalRevision(row, "planVersion", "planNo", planNo));
    if (!revisions.length) throw new Error("PROCUREMENT_NOT_FOUND");
    return { revisions, metadata: response.metadata };
  }

  async getPlanRevision(planNo, revisionId) {
    const response = await this.client.request("PLAN_DETAIL", { id: revisionId });
    const plan = findBestObject(
      response.data,
      ["planNo", "planVersion", "name", "investorName", "decisionNo", "investTotal"],
      "planNo",
      planNo,
    );
    if (!plan) throw new Error("PROCUREMENT_SCHEMA_CHANGED");
    return {
      raw: response.data,
      fingerprint: fingerprint(response.data, "plan"),
      metadata: response.metadata,
      retrievedAt: this.clock(),
    };
  }

  async listNoticeRevisions(noticeNo) {
    const collected = [];
    const failures = [];
    for (const [operation, processApply] of [
      ["NOTICE_LDT_VERSION_LIST", "LDT"],
      ["NOTICE_OTHER_VERSION_LIST", "KHAC"],
    ]) {
      try {
        const response = await this.client.request(operation, { notifyNo: noticeNo });
        for (const row of responseVersions(response.data)) {
          if (!row?.id) continue;
          const revision = canonicalRevision(row, "notifyVersion", "notifyNo", noticeNo);
          revision.processApply = String(row.processApply || processApply);
          collected.push(revision);
          this.noticeRevisionHints.set(revision.revisionId, revision.processApply);
        }
      } catch (error) {
        failures.push(error);
      }
    }
    const unique = [...new Map(collected.map((row) => [row.revisionId, row])).values()];
    if (!unique.length) {
      if (failures.length === 2 && failures.every((error) => String(error.message) !== "PROCUREMENT_NOT_FOUND")) {
        throw failures[0];
      }
      throw new Error("PROCUREMENT_NOT_FOUND");
    }
    return { revisions: unique };
  }

  async _noticeDetail(noticeNo, revisionId) {
    const hint = this.noticeRevisionHints.get(String(revisionId)) || "";
    const order = ["NOTICE_LDT_DETAIL", "NOTICE_OTHER_DETAIL", "NOTICE_ADB_DETAIL"];
    if (["ADB", "WB"].includes(hint)) order.unshift(order.pop());
    else if (hint === "KHAC") order.push(order.shift());
    let lastError = null;
    for (const operation of order) {
      try {
        const response = await this.client.request(operation, { id: revisionId });
        const notice = findBestObject(
          response.data,
          ["notifyNo", "notifyVersion", "bidName", "planNo", "bidMode", "processApply"],
          "notifyNo",
          noticeNo,
        );
        if (notice) return { response, notice, operation };
      } catch (error) {
        lastError = error;
      }
    }
    if (lastError && String(lastError.message) === "PROCUREMENT_SESSION_FAILED") throw lastError;
    throw new Error("PROCUREMENT_SCHEMA_CHANGED");
  }

  async getNoticeRevision(noticeNo, revisionId) {
    const { response, operation } = await this._noticeDetail(noticeNo, revisionId);
    return {
      raw: response.data,
      detailOperation: operation,
      fingerprint: fingerprint(response.data, "package-notice"),
      metadata: response.metadata,
      retrievedAt: this.clock(),
    };
  }

  async getOpeningBundle(noticeNo, revisionId) {
    const { response: detailResponse, notice, operation } = await this._noticeDetail(
      noticeNo,
      revisionId,
    );
    const processApply = String(notice.processApply || "LDT").toUpperCase();
    const bidMode = String(notice.bidMode || "").toUpperCase();
    const payload = {
      notifyNo: noticeNo,
      notifyId: notice.notifyId || notice.id || revisionId,
      type: "TBMT",
    };
    const sources = { noticeDetail: detailResponse.data };
    const failures = [];
    if (["KHAC", "ADB", "WB"].includes(processApply)) {
      const openingOperation = ["ADB", "WB"].includes(processApply)
        ? "OPENING_ADB"
        : "OPENING_OTHER";
      try {
        sources.opening = (await this.client.request(openingOperation, { id: revisionId })).data;
      } catch (error) {
        failures.push({ operation: openingOperation, error: String(error.message) });
      }
    } else {
      const collectPackType = async (packType) => {
        const tasks = [];
        const baseOperations = ["OPENING_NOTIFY", "OPENING_ROUND", "OPENING_BID"];
        for (const openingOperation of baseOperations) {
          tasks.push((async () => {
            try {
            const key = `${openingOperation.toLowerCase()}_${packType}`;
            sources[key] = (
              await this.client.request(openingOperation, { ...payload, packType })
            ).data;
            } catch (error) {
              failures.push({ operation: openingOperation, packType, error: String(error.message) });
            }
          })());
        }
        await Promise.all(tasks);
        const roundData = sources[`opening_round_${packType}`];
        const bidData = sources[`opening_bid_${packType}`];
        const isMultiLot = flagEnabled(findFirstValue(roundData, "isMultiLot"))
          || flagEnabled(findFirstValue(bidData, "isMultiLot"));
        if (isMultiLot) {
          await Promise.all(["OPENING_LOT", "OPENING_LOT_DETAIL"].map(async (openingOperation) => {
            try {
              const key = `${openingOperation.toLowerCase()}_${packType}`;
              sources[key] = (
                await this.client.request(openingOperation, { ...payload, packType })
              ).data;
            } catch (error) {
              failures.push({ operation: openingOperation, packType, error: String(error.message) });
            }
          }));
        }
        return roundData;
      };
      const technicalPackType = bidMode === "1_MTHS" ? 0 : 1;
      const roundData = await collectPackType(technicalPackType);
      const bidStatus = String(findFirstValue(roundData, "bidStatus") || "").toUpperCase();
      if (
        bidMode === "1_HTHS"
        && ["OPEN_DXTC", "PUB_KQLCNT"].includes(bidStatus)
      ) {
        try {
          sources.opening_financial_available = (
            await this.client.request("OPENING_FINANCIAL_AVAILABLE", { id: payload.notifyId })
          ).data;
        } catch (error) {
          failures.push({ operation: "OPENING_FINANCIAL_AVAILABLE", error: String(error.message) });
        }
        await collectPackType(2);
        try {
          sources.opening_financial_detail_2 = (
            await this.client.request("OPENING_FINANCIAL_DETAIL", {
              ...payload, packType: 2, viewType: 0,
            })
          ).data;
        } catch (error) {
          failures.push({ operation: "OPENING_FINANCIAL_DETAIL", packType: 2, error: String(error.message) });
        }
      }
    }
    if (Object.keys(sources).length === 1 && failures.length) {
      throw new Error(failures[0].error);
    }
    return {
      raw: sources,
      failures,
      processApply,
      bidMode,
      noticeDetailOperation: operation,
      fingerprint: fingerprint(sources, "opening"),
      metadata: {
        ...(detailResponse.metadata || {}),
        operation: "OPENING_BUNDLE",
      },
      retrievedAt: this.clock(),
    };
  }

  async getResultBundle(noticeNo, revisionId, hints = {}) {
    const { response: detailResponse, notice } = await this._noticeDetail(
      noticeNo,
      revisionId,
    );
    const resultNotice = { ...notice, ...asObject(hints) };
    const processApply = String(resultNotice.processApply || "LDT").toUpperCase();
    const sources = { noticeDetail: detailResponse.data };
    const failures = [];
    const tasks = [];
    if (resultNotice.inputResultId) {
      const operation = processApply === "KHAC"
        ? "SELECTION_RESULT_OTHER"
        : "SELECTION_RESULT";
      tasks.push((async () => {
        try {
          sources.selectionResult = (
            await this.client.request(operation, { id: resultNotice.inputResultId })
          ).data;
        } catch (error) {
          failures.push({ operation, error: String(error.message) });
        }
      })());
    }
    if (resultNotice.techReqId) {
      tasks.push((async () => {
        try {
          sources.technicalResult = (
            await this.client.request("TECHNICAL_RESULT", { id: resultNotice.techReqId })
          ).data;
        } catch (error) {
          failures.push({ operation: "TECHNICAL_RESULT", error: String(error.message) });
        }
      })());
    }
    await Promise.all(tasks);
    return {
      raw: sources,
      failures,
      fingerprint: fingerprint(sources, "result"),
      metadata: {
        ...(detailResponse.metadata || {}),
        operation: "RESULT_BUNDLE",
      },
      retrievedAt: this.clock(),
    };
  }

  async _collectPlanCompleteBundle(record, options = {}) {
    const retrievedAt = this.clock();
    const failures = [];
    const bundle = {
      schemaVersion: "biddingflow-muasamcong-raw-bundle-v2",
      provider: "MUASAMCONG",
      entity: {
        kind: "PLAN",
        canonicalCode: String(record?.planNo || "").trim().toUpperCase(),
        planNo: String(record?.planNo || "").trim().toUpperCase(),
      },
      detailLevel: "COMPLETE",
      revisionMode: String(options.revisionMode || "ALL").toUpperCase(),
      retrievedAt,
      sources: {},
      revisions: {},
      failures,
    };
    const makeEnvelope = (operation, payload) => {
      const endpoint = resolveEndpoint(operation);
      return {
        operation,
        endpoint: endpoint.path,
        request: sanitizedRequest(payload),
        response: null,
        success: false,
        attempted: true,
        retrievedAt: this.clock(),
      };
    };
    const makeFailureEnvelope = (operation, payload, code) => ({
      operation,
      endpoint: operation === "PLAN_VERSION_SELECTION"
        ? "internal:revision-selection"
        : resolveEndpoint(operation).path,
      request: sanitizedRequest(payload),
      response: null,
      success: false,
      attempted: false,
      error: { code },
      retrievedAt: this.clock(),
    });
    const capture = async (target, key, operation, payload, context = {}) => {
      const source = makeEnvelope(operation, payload);
      target[key] = source;
      try {
        const result = await this.client.request(operation, payload);
        source.response = sanitizedRequest(result.data);
        source.success = true;
        source.contentHash = contentHash(source.response);
        const fingerprintKind = operation === "PLAN_DETAIL"
          ? "plan"
          : operation === "PLAN_PACKAGE_DETAIL"
            ? "plan-package"
            : operation.toLowerCase();
        source.schemaFingerprint = fingerprint(result.data, fingerprintKind);
        source.metrics = Object.fromEntries(Object.entries(result.metadata || {})
          .filter(([, value]) => ["number", "boolean"].includes(typeof value)));
        return result.data;
      } catch (error) {
        const code = String(error?.message || "PROCUREMENT_UPSTREAM_UNAVAILABLE");
        if (context.optional && code === "PROCUREMENT_NOT_FOUND") {
          source.response = null;
          source.success = true;
          source.absent = true;
          source.contentHash = contentHash(null);
          source.schemaFingerprint = `${operation.toLowerCase()}:absent`;
          return null;
        }
        source.error = { code };
        failures.push({ operation, ...context, error: code });
        return null;
      }
    };

    const searchSource = options.searchSource || {};
    const searchEnvelope = makeEnvelope("SEARCH", searchSource.request || null);
    searchEnvelope.response = sanitizedRequest(searchSource.raw || record);
    searchEnvelope.success = true;
    searchEnvelope.attempted = Boolean(searchSource.raw);
    searchEnvelope.contentHash = contentHash(searchEnvelope.response);
    searchEnvelope.schemaFingerprint = searchSource.fingerprint
      || fingerprint(searchEnvelope.response, "search");
    searchEnvelope.metrics = Object.fromEntries(
      Object.entries(searchSource.metadata || {})
        .filter(([, value]) => ["number", "boolean"].includes(typeof value)),
    );
    bundle.sources.search = searchEnvelope;

    const versionResponse = await capture(
      bundle.sources,
      "versionList",
      "PLAN_VERSION_LIST",
      { planNo: bundle.entity.planNo },
    );
    const revisions = responseVersions(versionResponse)
      .filter((row) => row?.id)
      .map((row) => canonicalRevision(
        row, "planVersion", "planNo", bundle.entity.planNo,
      ));
    const currentId = String(record?.id || "");
    if (currentId && !revisions.some((row) => row.revisionId === currentId)) {
      revisions.push({
        revisionId: currentId,
        revisionNumber: String(record?.planVersion ?? "").padStart(2, "0"),
        familyNo: bundle.entity.planNo,
        processApply: String(record?.processApply || ""),
      });
    }
    const unique = [...new Map(revisions.map((row) => [row.revisionId, row])).values()];
    const selected = selectRevisions(unique, options);
    if (!selected.length) {
      const failure = {
        operation: "PLAN_VERSION_SELECTION",
        error: unique.length ? "PROCUREMENT_REVISION_INVALID" : "PROCUREMENT_NOT_FOUND",
      };
      failures.push(failure);
      bundle.sources.revisionSelection = makeFailureEnvelope(
        failure.operation,
        {
          revisionMode: bundle.revisionMode,
          revisionNumbers: asArray(options.revisionNumbers),
        },
        failure.error,
      );
    }

    await mapConcurrent(selected, this.collectionConcurrency, async (revision) => {
      const label = revision.revisionNumber || revision.revisionId;
      const revisionNode = {
        revisionId: revision.revisionId,
        revisionNumber: label,
        sources: {},
        packages: {},
      };
      bundle.revisions[label] = revisionNode;
      const detail = await capture(
        revisionNode.sources,
        "planDetail",
        "PLAN_DETAIL",
        { id: revision.revisionId },
        { revision: label, revisionId: revision.revisionId },
      );
      if (!detail) return;
      const packages = packageRows(detail);
      await mapConcurrent(packages, this.collectionConcurrency, async (row, index) => {
        const stableKey = packageKey(row, index);
        const packageNode = {
          stableKey,
          identifiers: {
            id: row.id == null ? null : String(row.id),
            idDetail: row.idDetail == null ? null : String(row.idDetail),
            idPlan: row.idPlan == null ? null : String(row.idPlan),
            bidNo: row.bidNo == null ? null : String(row.bidNo),
          },
          sources: {},
        };
        revisionNode.packages[stableKey] = packageNode;
        const detailId = row.idDetail || row.id;
        if (!detailId) {
          const failure = {
            operation: "PLAN_PACKAGE_DETAIL",
            revision: label,
            package: stableKey,
            error: "PROCUREMENT_ADAPTER_UNSUPPORTED",
          };
          failures.push(failure);
          packageNode.sources.planPackageDetail = makeFailureEnvelope(
            failure.operation,
            { id: null },
            failure.error,
          );
          return;
        }
        await capture(
          packageNode.sources,
          "planPackageDetail",
          "PLAN_PACKAGE_DETAIL",
          { id: detailId },
          { revision: label, revisionId: revision.revisionId, package: stableKey },
        );
      });
    });

    const envelopes = rawBundleSourceEnvelopes(bundle);
    bundle.complete = failures.length === 0;
    bundle.status = bundle.complete ? "FOUND_COMPLETE" : "FOUND_PARTIAL";
    bundle.manifest = buildRawSourceManifest(bundle);
    bundle.fingerprint = fingerprint(bundle, "complete-bundle");
    bundle.metrics = {
      upstream: {
        requestCount: envelopes.filter((source) => source.attempted).length,
        networkMs: envelopes.reduce(
          (total, source) => total + Number(source.metrics?.networkWaitMs || 0),
          0,
        ),
      },
      browserStartupMs: Math.max(
        0,
        ...envelopes.map((source) => Number(source.metrics?.browserStartupMs || 0)),
      ),
      sessionAcquireMs: envelopes.reduce(
        (total, source) => total + Number(source.metrics?.sessionAcquireMs || 0),
        0,
      ),
      sessionCacheHit: envelopes.some((source) => source.metrics?.sessionCacheHit === true),
      collector: {
        revisions: bundle.manifest.revisions.length,
        packageDetails: bundle.manifest.packages,
      },
    };
    return bundle;
  }

  async _collectNoticeCompleteBundle(record, options = {}) {
    const canonicalNoticeNo = String(record?.notifyNo || "").trim().toUpperCase();
    const retrievedAt = this.clock();
    const failures = [];
    const bundle = {
      schemaVersion: "biddingflow-muasamcong-raw-bundle-v2",
      provider: "MUASAMCONG",
      entity: {
        kind: "NOTICE",
        canonicalCode: canonicalNoticeNo,
        noticeNo: canonicalNoticeNo,
      },
      detailLevel: "COMPLETE",
      revisionMode: String(options.revisionMode || "ALL").toUpperCase(),
      retrievedAt,
      sources: {},
      revisions: {},
      failures,
    };
    const envelope = (operation, payload, attempted = true) => ({
      operation,
      endpoint: resolveEndpoint(operation).path,
      request: sanitizedRequest(payload),
      response: null,
      success: false,
      attempted,
      retrievedAt: this.clock(),
    });
    const capture = async (target, key, operation, payload, context = {}) => {
      const source = envelope(operation, payload);
      target[key] = source;
      try {
        const result = await this.client.request(operation, payload);
        source.response = sanitizedRequest(result.data);
        source.success = true;
        source.contentHash = contentHash(source.response);
        source.schemaFingerprint = fingerprint(result.data, operation.toLowerCase());
        source.metrics = sourceMetrics(result.metadata);
        return result.data;
      } catch (error) {
        const code = String(error?.message || "PROCUREMENT_UPSTREAM_UNAVAILABLE");
        if (context.optional && code === "PROCUREMENT_NOT_FOUND") {
          source.response = null;
          source.success = true;
          source.absent = true;
          source.contentHash = contentHash(null);
          source.schemaFingerprint = `${operation.toLowerCase()}:absent`;
          return null;
        }
        source.error = { code };
        failures.push({ operation, ...context, error: code });
        return null;
      }
    };
    const searchSource = options.searchSource || {};
    const search = envelope("SEARCH", searchSource.request || null, Boolean(searchSource.raw));
    search.response = sanitizedRequest(searchSource.raw || record);
    search.success = true;
    search.contentHash = contentHash(search.response);
    search.schemaFingerprint = searchSource.fingerprint || fingerprint(search.response, "search");
    search.metrics = sourceMetrics(searchSource.metadata);
    bundle.sources.search = search;

    const versionResponses = await Promise.all(
      ["NOTICE_LDT_VERSION_LIST", "NOTICE_OTHER_VERSION_LIST"].map(async (operation) => capture(
        bundle.sources,
        operation === "NOTICE_LDT_VERSION_LIST" ? "ldtVersionList" : "otherVersionList",
        operation,
        { notifyNo: canonicalNoticeNo },
        { optional: true },
      )),
    );
    const listed = { revisions: [] };
    for (const [key, processApply] of [["ldtVersionList", "LDT"], ["otherVersionList", "KHAC"]]) {
      for (const row of responseVersions(bundle.sources[key]?.response)) {
        if (!row?.id) continue;
        const revision = canonicalRevision(row, "notifyVersion", "notifyNo", canonicalNoticeNo);
        revision.processApply = String(row.processApply || processApply);
        listed.revisions.push(revision);
        this.noticeRevisionHints.set(revision.revisionId, revision.processApply);
      }
    }
    const revisions = listed.revisions;
    const currentId = usableIdentifier(record?.notifyId || record?.id);
    if (currentId && !revisions.some((row) => row.revisionId === currentId)) {
      revisions.push({
        revisionId: currentId,
        revisionNumber: String(record?.notifyVersion ?? "").padStart(2, "0"),
        familyNo: canonicalNoticeNo,
        processApply: String(record?.processApply || "LDT"),
      });
    }
    if (!revisions.length) {
      throw new Error("PROCUREMENT_NOT_FOUND");
    }
    const selected = selectRevisions(
      [...new Map(revisions.map((row) => [row.revisionId, row])).values()],
      options,
    );
    if (!selected.length) {
      failures.push({ operation: "NOTICE_VERSION_SELECTION", error: "PROCUREMENT_REVISION_INVALID" });
    }

    const contractPromise = capture(
      bundle.sources,
      "contractList",
      "NOTICE_CONTRACT_LIST",
      { notifyNo: canonicalNoticeNo },
    );
    await Promise.all([mapConcurrent(selected, this.collectionConcurrency, async (revision) => {
      const label = revision.revisionNumber || revision.revisionId;
      const node = {
        revisionId: revision.revisionId,
        revisionNumber: label,
        processApply: revision.processApply,
        sources: {},
      };
      bundle.revisions[label] = node;
      let detail;
      let detailOperation;
      try {
        const found = await this._noticeDetail(canonicalNoticeNo, revision.revisionId);
        detail = found.response.data;
        detailOperation = found.operation;
      } catch (error) {
        const operation = revision.processApply === "LDT" ? "NOTICE_LDT_DETAIL" : "NOTICE_OTHER_DETAIL";
        failures.push({ operation, revision: label, error: String(error.message) });
        const isExactCurrentRevision = (
          String(revision.revisionId) === String(currentId)
          && exactSearchRecord(record, canonicalNoticeNo, "notifyNo") === record
        );
        if (!isExactCurrentRevision) {
          const source = envelope(operation, { id: revision.revisionId });
          source.error = { code: String(error.message) };
          node.sources.noticeDetail = source;
          return;
        }
        detail = asObject(record);
        detailOperation = "SEARCH";
      }
      const detailSource = envelope(detailOperation, { id: revision.revisionId });
      detailSource.response = sanitizedRequest(detail);
      detailSource.success = true;
      if (detailOperation === "SEARCH") detailSource.fallback = true;
      detailSource.contentHash = contentHash(detailSource.response);
      detailSource.schemaFingerprint = fingerprint(detail, "package-notice");
      node.sources.noticeDetail = detailSource;

      const notice = findBestObject(
        detail,
        ["notifyNo", "notifyVersion", "notifyId", "bidMode", "processApply", "isMultiLot"],
        "notifyNo",
        canonicalNoticeNo,
      ) || {};
      const merged = {
        ...notice,
        ...(String(revision.revisionId) === String(currentId) ? asObject(record) : {}),
      };
      const processApply = String(merged.processApply || revision.processApply || "LDT").toUpperCase();
      const bidMode = String(merged.bidMode || "").toUpperCase();
      const notifyId = usableIdentifier(merged.notifyId || merged.id) || revision.revisionId;
      if (processApply === "LDT") {
        await Promise.all([
          capture(node.sources, "tenderInfo", "NOTICE_TENDER_INFO", { id: notifyId }, { revision: label }),
          capture(node.sources, "hsmt", "NOTICE_HSMT", { id: notifyId, processApply }, { revision: label }),
          capture(node.sources, "petition", "NOTICE_PETITION", { notifyNo: canonicalNoticeNo, processApply }, { revision: label, optional: true }),
          capture(node.sources, "clarification", "NOTICE_CLARIFICATION", { notifyNo: canonicalNoticeNo, processApply }, { revision: label, optional: true }),
          capture(node.sources, "prebidConference", "NOTICE_PREBID_CONFERENCE", { notifyNo: canonicalNoticeNo, processApply }, { revision: label, optional: true }),
        ]);
      }
      const planNo = usableIdentifier(merged.planNo || findFirstValue(detail, "planNo"));
      const planReference = linkedPlanReference(detail, merged, planNo);
      let packageDetailId = usableIdentifier(
        merged.idDetail
        || merged.bidPlanDetailId
        || merged.bidId
        || findFirstValue(detail, "idDetail")
        || findFirstValue(detail, "bidPlanDetailId"),
      );
      if (planNo) {
        const planVersions = await capture(
          node.sources, "planVersionList", "PLAN_VERSION_LIST", { planNo }, { revision: label },
        );
        const linkedPlanRevision = resolveLinkedPlanRevision(
          planVersions, planReference,
        );
        const planRevisionId = usableIdentifier(linkedPlanRevision?.id);
        if (planRevisionId) {
          const planDetail = await capture(
            node.sources, "planDetail", "PLAN_DETAIL", { id: planRevisionId }, { revision: label },
          );
          if (!packageDetailId) {
            const bidNo = usableIdentifier(merged.bidNo || findFirstValue(detail, "bidNo"));
            const matches = packageRows(planDetail).filter((row) => (
              bidNo && String(row?.bidNo || "").trim().toUpperCase() === bidNo.toUpperCase()
            ));
            if (matches.length === 1) {
              packageDetailId = usableIdentifier(matches[0].idDetail || matches[0].id);
            }
          }
        } else if (responseVersions(planVersions).length > 1) {
          const source = envelope("PLAN_DETAIL", { id: null });
          source.error = { code: "PROCUREMENT_REVISION_INVALID" };
          node.sources.planDetail = source;
          failures.push({
            operation: "PLAN_DETAIL",
            revision: label,
            error: "PROCUREMENT_REVISION_INVALID",
          });
        }
      }
      if (packageDetailId) {
        await capture(
          node.sources, "planPackageDetail", "PLAN_PACKAGE_DETAIL", { id: packageDetailId }, { revision: label },
        );
      }

      const status = String(findFirstValue(detail, "status") || merged.status || "").toUpperCase();
      const hasOpening = Boolean(findFirstValue(detail, "successBidOpenDate"))
        || ["OPEN_BID", "OPEN_DXKT", "OPEN_DXTC", "PUB_KQLCNT"].includes(status)
        || Boolean(usableIdentifier(merged.bidOpenId));
      if (hasOpening) {
        let opening;
        try {
          opening = await this.getOpeningBundle(canonicalNoticeNo, revision.revisionId);
        } catch (error) {
          failures.push({
            operation: "OPENING_BUNDLE",
            revision: label,
            error: String(error.message),
          });
          opening = { raw: {}, failures: [] };
        }
        const failuresByKey = new Map((opening.failures || []).map((failure) => [
          `${failure.operation}:${failure.packType ?? ""}`, failure,
        ]));
        for (const [key, response] of Object.entries(opening.raw || {})) {
          if (key === "noticeDetail") continue;
          const matched = key.match(/^(opening_[a-z_]+?)(?:_(\d))?$/);
          if (!matched) continue;
          const operation = matched[1].toUpperCase();
          if (!OPENING_OPERATIONS.has(operation)) continue;
          const packType = matched[2] == null ? null : Number(matched[2]);
          const payload = operation === "OPENING_FINANCIAL_AVAILABLE"
            ? { id: notifyId }
            : { notifyNo: canonicalNoticeNo, notifyId, type: "TBMT", ...(packType == null ? {} : { packType }) };
          const source = envelope(operation, payload);
          source.response = sanitizedRequest(response);
          source.success = true;
          source.contentHash = contentHash(source.response);
          source.schemaFingerprint = fingerprint(response, operation.toLowerCase());
          node.sources[key] = source;
          failuresByKey.delete(`${operation}:${packType ?? ""}`);
        }
        for (const failure of failuresByKey.values()) {
          const packType = failure.packType == null ? null : Number(failure.packType);
          const key = `${failure.operation.toLowerCase()}${packType == null ? "" : `_${packType}`}`;
          const payload = failure.operation === "OPENING_FINANCIAL_AVAILABLE"
            ? { id: notifyId }
            : { notifyNo: canonicalNoticeNo, notifyId, type: "TBMT", ...(packType == null ? {} : { packType }) };
          const source = envelope(failure.operation, payload);
          source.error = { code: failure.error };
          node.sources[key] = source;
          failures.push({ ...failure, revision: label });
        }
      }

      node.identifiers = {
        notifyId,
        planNo,
        planRevisionId: planReference.idPlan || null,
        planVersion: planReference.planVersion || null,
        bidMode,
        processApply,
        isMultiLot: flagEnabled(
          merged.isMultiLot || findFirstValue(detail, "isMultiLot"),
        ),
      };

      const inputResultId = usableIdentifier(merged.inputResultId || findFirstValue(detail, "inputResultId"));
      const techReqId = usableIdentifier(merged.techReqId || findFirstValue(detail, "techReqId"));
      await Promise.all([
        inputResultId && capture(
          node.sources,
          "selectionResult",
          processApply === "KHAC" ? "SELECTION_RESULT_OTHER" : "SELECTION_RESULT",
          { id: inputResultId },
          { revision: label },
        ),
        techReqId && capture(
          node.sources, "technicalResult", "TECHNICAL_RESULT", { id: techReqId }, { revision: label },
        ),
      ].filter(Boolean));

      if (bidMode.startsWith("2_")) {
        const phaseTwo = await capture(
          node.sources, "phaseTwo", "NOTICE_PHASE_TWO", { notifyNo: canonicalNoticeNo }, { revision: label },
        );
        const phaseTwoId = usableIdentifier(findFirstValue(phaseTwo, "id"));
        if (phaseTwoId) {
          await capture(
            node.sources, "hsmtPhaseTwo", "NOTICE_HSMT_PHASE_TWO", { id: phaseTwoId }, { revision: label },
          );
        }
      }
    }), contractPromise]);
    const envelopes = rawBundleSourceEnvelopes(bundle);
    bundle.complete = failures.length === 0;
    bundle.status = bundle.complete ? "FOUND_COMPLETE" : "FOUND_PARTIAL";
    bundle.manifest = buildRawSourceManifest(bundle);
    bundle.fingerprint = fingerprint(bundle, "complete-bundle");
    bundle.metrics = {
      upstream: {
        requestCount: envelopes.filter((source) => source.attempted).length,
        networkMs: envelopes.reduce((sum, source) => sum + Number(source.metrics?.networkWaitMs || 0), 0),
      },
      collector: {
        revisions: bundle.manifest.revisions.length,
        openings: envelopes.filter((source) => source.operation.startsWith("OPENING_")).length,
        results: envelopes.filter((source) => ["SELECTION_RESULT", "TECHNICAL_RESULT"].includes(source.operation)).length,
        contracts: asArray(bundle.sources.contractList?.response).length,
      },
    };
    return bundle;
  }

  async collectCompleteBundle(record, options = {}) {
    const type = String(record?.type || "");
    if (type === "es-plan-project-p") {
      return this._collectPlanCompleteBundle(record, options);
    }
    if (type === "es-notify-contractor") {
      return this._collectNoticeCompleteBundle(record, options);
    }
    const sources = { searchRecord: record };
    const failures = [];
    const capture = async (key, operation, payload) => {
      try {
        const data = (await this.client.request(operation, payload)).data;
        sources[key] = data;
        return data;
      } catch (error) {
        failures.push({ operation, error: String(error.message) });
        return null;
      }
    };
    if (type === "es-bidp-project-p") {
      const versionResponse = await this.client.request(
        "PROJECT_VERSION_LIST",
        { pno: record.pno },
      );
      for (const version of responseVersions(versionResponse.data)) {
        if (!version?.id) continue;
        sources[`projectDetail_${version.pversion || version.id}`] = (
          await this.client.request("PROJECT_DETAIL", { id: version.id })
        ).data;
      }
    } else if (type === "es-ct-contract") {
      const contractDetail = await capture(
        "contractDetail", "CONTRACT_DETAIL", { id: record.id },
      );
      await capture(
        "contractLinked",
        "CONTRACT_LINKED",
        { contractCode: record.contractCode },
      );
      const contract = findBestObject(
        contractDetail,
        ["contractCode", "notifyId", "resultId", "isInternet", "processApply"],
      ) || {};
      if (
        contract.notifyId
        && Number(contract.isInternet) === 1
        && ["KQLCNT", "ECONTRACT"].includes(String(contract.processApply || ""))
      ) {
        await capture(
          "contractTender", "CONTRACT_TENDER", { id: contract.notifyId },
        );
        await capture(
          "contractHsmt",
          "CONTRACT_HSMT",
          { id: contract.notifyId, processApply: "LDT" },
        );
      }
      if (
        contract.resultId
        && Number(contract.isInternet) !== 1
        && String(contract.processApply || "") !== "KQ_KHAC"
      ) {
        await capture(
          "contractSelectionResult",
          "SELECTION_RESULT",
          { id: contract.resultId },
        );
      }
    } else if (GENERIC_DETAIL_OPERATIONS[type] && record.id) {
      await capture(
        "primaryDetail", GENERIC_DETAIL_OPERATIONS[type], { id: record.id },
      );
    } else {
      throw new Error("PROCUREMENT_ADAPTER_UNSUPPORTED");
    }
    return {
      type,
      fetchedAt: this.clock(),
      sources,
      failures,
      fingerprint: fingerprint(sources, "complete-bundle"),
    };
  }
}

