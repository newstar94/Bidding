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
        for (const openingOperation of [
          "OPENING_NOTIFY", "OPENING_ROUND", "OPENING_BID", "OPENING_LOT", "OPENING_LOT_DETAIL",
        ]) {
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
        return sources[`opening_round_${packType}`];
      };
      const technicalPackType = bidMode === "1_MTHS" ? 0 : 1;
      const roundData = await collectPackType(technicalPackType);
      const bidStatus = String(findFirstValue(roundData, "bidStatus") || "").toUpperCase();
      if (
        bidMode === "1_HTHS"
        && ["OPEN_DXTC", "PUB_KQLCNT"].includes(bidStatus)
      ) {
        await collectPackType(2);
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

  async collectCompleteBundle(record, options = {}) {
    const type = String(record?.type || "");
    if (type === "es-plan-project-p") {
      return this._collectPlanCompleteBundle(record, options);
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
    } else if (type === "es-notify-contractor") {
      const revisions = await this.listNoticeRevisions(String(record.notifyNo || ""));
      for (const revision of revisions.revisions) {
        const label = revision.revisionNumber || revision.revisionId;
        const detail = await this.getNoticeRevision(record.notifyNo, revision.revisionId);
        sources[`noticeDetail_${label}`] = detail.raw;
        const status = String(findFirstValue(detail.raw, "status") || "").toUpperCase();
        const hasOpening = Boolean(findFirstValue(detail.raw, "successBidOpenDate"))
          || ["OPEN_BID", "OPEN_DXKT", "OPEN_DXTC", "PUB_KQLCNT"].includes(status)
          || (
            String(revision.revisionId) === String(record.notifyId || record.id || "")
            && Boolean(record.bidOpenId)
          );
        if (hasOpening) {
          try {
            sources[`noticeOpening_${label}`] = (
              await this.getOpeningBundle(record.notifyNo, revision.revisionId)
            ).raw;
          } catch (error) {
            failures.push({
              operation: "OPENING_BUNDLE",
              revisionId: revision.revisionId,
              error: String(error.message),
            });
          }
        }
        if (
          String(revision.revisionId) === String(record.notifyId || record.id || "")
          && (record.inputResultId || record.techReqId)
        ) {
          try {
            sources[`noticeResult_${label}`] = (
              await this.getResultBundle(
                record.notifyNo,
                revision.revisionId,
                record,
              )
            ).raw;
          } catch (error) {
            failures.push({
              operation: "RESULT_BUNDLE",
              revisionId: revision.revisionId,
              error: String(error.message),
            });
          }
        }
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

