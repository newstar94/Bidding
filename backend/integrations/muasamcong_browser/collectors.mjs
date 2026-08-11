import crypto from "node:crypto";


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
  constructor({ client, clock = () => new Date().toISOString() }) {
    this.client = client;
    this.clock = clock;
    this.noticeRevisionHints = new Map();
  }

  async search(code, kind) {
    const type = kind === "PLAN" ? "es-plan-project-p" : "es-notify-contractor";
    const field = kind === "PLAN" ? "planNo" : "notifyNo";
    const response = await this.client.request("SEARCH", buildSearchPayload(code, type));
    const record = exactSearchRecord(response.data, code, field);
    if (!record) throw new Error("PROCUREMENT_NOT_FOUND");
    return { record, metadata: response.metadata };
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

  async collectCompleteBundle(record) {
    const type = String(record?.type || "");
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
    if (type === "es-plan-project-p") {
      const versions = await this.listPlanRevisions(String(record.planNo || ""));
      for (const revision of versions.revisions) {
        sources[`planDetail_${revision.revisionNumber}`] = (
          await this.getPlanRevision(record.planNo, revision.revisionId)
        ).raw;
      }
    } else if (type === "es-bidp-project-p") {
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

