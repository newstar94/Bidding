import assert from "node:assert/strict";
import fs from "node:fs";
import test from "node:test";

import { MscCollectors } from "../../backend/integrations/muasamcong_browser/collectors.mjs";

const NOTICE_NO = "IB2600493339";
const VERSIONS = [
  { id: "217db3f1-9b19-4c93-a9e8-be3acc456da9", version: "02" },
  { id: "bb78355e-90b4-416a-97a7-929cd64acaca", version: "01" },
  { id: "3a8a45a8-adb2-474d-bc57-e38cb8959cf3", version: "00" },
];

// Relevant structure extracted from the supplied IB2600493339 version 02 detail.
function suppliedDetail() {
  return {
    bidoNotifyContractorM: {
      id: VERSIONS[0].id,
      notifyNo: NOTICE_NO,
      notifyVersion: "02",
      planNo: "PL2600275637",
      bidNo: "BP2600683818",
      processApply: "LDT",
      bidMode: "1_MTHS",
      publicDate: "2026-10-01T22:01:21.368",
      bidCloseDate: "2026-10-12T09:00:00",
      delayDTOList: null,
      getVersionDTOS: VERSIONS.map((row) => ({ ...row, no: null })),
    },
    bidpPlanDetail: {
      bidNo: "BP2600683818",
      planNo: "PL2600275637",
      planVersion: "01",
      linkNotifyInfo: JSON.stringify({
        notifyNo: NOTICE_NO,
        notifyVersion: "00",
        notifyId: VERSIONS[2].id,
      }),
    },
    bidNoContractorResponse: {
      bidNotification: {
        id: VERSIONS[0].id,
        notifyNo: NOTICE_NO,
        notifyVersion: "02",
        bidMode: "1_MTHS",
        processApply: "LDT",
        getVersionDTOS: VERSIONS.map((row) => ({ ...row, no: NOTICE_NO })),
      },
    },
  };
}

test("known notice version-list context accepts the observed version alias", async () => {
  for (const data of [
    { versionList: VERSIONS },
    suppliedDetail(),
  ]) {
    const collector = new MscCollectors({
      client: {
        async request(operation) {
          if (operation === "NOTICE_LDT_VERSION_LIST") return { data };
          throw new Error("PROCUREMENT_NOT_FOUND");
        },
      },
    });
    const result = await collector.listNoticeRevisions(NOTICE_NO);
    assert.deepEqual(result.revisions.map((row) => [row.revisionId, row.revisionNumber]),
      VERSIONS.map((row) => [row.id, row.version]));
  }
});

test("arbitrary version arrays are not treated as official notice revisions", async () => {
  const collector = new MscCollectors({
    client: {
      async request() {
        return { data: { unrelated: VERSIONS } };
      },
    },
  });
  await assert.rejects(collector.listNoticeRevisions(NOTICE_NO), {
    message: "PROCUREMENT_NOT_FOUND",
  });
});

test("notice version extraction cannot select an unrelated nested plan list", async () => {
  const noticeRows = VERSIONS.map((row) => ({
    ...row, notifyNo: NOTICE_NO, notifyVersion: row.version,
  }));
  for (const data of [
    { noticeRows, linkedPlan: {
      planNo: "PL2600275637",
      getVersionDTOS: [{ id: "plan-01", version: "01", no: "PL2600275637" }],
    } },
    { noticeRows, unrelated: { getVersionDTOS: [{ id: "other-01", version: "01" }] } },
    { versionList: [...noticeRows, { id: "plan-01", version: "01", no: "PL2600275637" }] },
  ]) {
    const collector = new MscCollectors({
      client: {
        async request(operation) {
          if (operation === "NOTICE_LDT_VERSION_LIST") return { data };
          throw new Error("PROCUREMENT_NOT_FOUND");
        },
      },
    });
    const result = await collector.listNoticeRevisions(NOTICE_NO);
    assert.deepEqual(result.revisions.map((row) => row.revisionId), VERSIONS.map((row) => row.id));
  }
});

test("supplied version 02 detail cannot satisfy a request for version 00 or 01", async () => {
  for (const row of VERSIONS) {
    const calls = [];
    const collector = new MscCollectors({
      client: {
        async request(operation, payload) {
          calls.push([operation, payload]);
          return { data: suppliedDetail() };
        },
      },
    });
    if (row.version === "02") {
      const result = await collector.getNoticeRevision(NOTICE_NO, row.id);
      assert.equal(result.raw.bidoNotifyContractorM.notifyVersion, "02");
    } else {
      await assert.rejects(collector.getNoticeRevision(NOTICE_NO, row.id), {
        message: "PROCUREMENT_REVISION_INVALID",
      });
    }
    assert.deepEqual(calls, [["NOTICE_LDT_DETAIL", { id: row.id }]]);
  }
});

test("complete selected revision never falls back to search after an explicit detail mismatch", async () => {
  for (const mismatch of ["id", "version"]) {
    const row = VERSIONS[2];
    const detail = suppliedDetail();
    if (mismatch === "version") {
      detail.bidoNotifyContractorM.id = row.id;
      detail.bidNoContractorResponse.bidNotification.id = row.id;
    }
    const calls = [];
    const collector = new MscCollectors({
      client: {
        async request(operation, payload) {
          calls.push([operation, payload]);
          if (operation === "NOTICE_LDT_VERSION_LIST") return {
            data: { versionList: VERSIONS.map((version) => ({
              ...version, notifyNo: NOTICE_NO, notifyVersion: version.version,
            })) },
          };
          if (operation === "NOTICE_OTHER_VERSION_LIST") throw new Error("PROCUREMENT_NOT_FOUND");
          if (operation === "NOTICE_LDT_DETAIL") return { data: detail };
          return { data: [] };
        },
      },
    });
    const bundle = await collector.collectCompleteBundle({
      type: "es-notify-contractor",
      notifyNo: NOTICE_NO,
      notifyId: row.id,
      notifyVersion: row.version,
      processApply: "LDT",
    }, {
      detailLevel: "INVITATION", revisionMode: "SELECTED", revisionNumbers: [row.version],
    });
    assert.equal(bundle.revisions["00"].sources.noticeDetail.success, false);
    assert.equal(bundle.revisions["00"].sources.noticeDetail.error.code, "PROCUREMENT_REVISION_INVALID");
    assert.equal(bundle.revisions["00"].sources.noticeDetail.fallback, undefined);
    assert.equal(calls.some(([operation]) => operation === "NOTICE_TENDER_INFO"), false);
  }
});

test("notice details with omitted identity fields keep the established compatibility", async () => {
  const collector = new MscCollectors({
    client: {
      async request() {
        return { data: { notifyNo: NOTICE_NO, bidName: "Gói thầu", processApply: "LDT" } };
      },
    },
  });
  const result = await collector.getNoticeRevision(NOTICE_NO, VERSIONS[2].id);
  assert.equal(result.raw.notifyNo, NOTICE_NO);
});

test("selected current search revision still checks the detail version when lists are unavailable", async () => {
  const row = VERSIONS[2];
  const collector = new MscCollectors({
    client: {
      async request(operation) {
        if (["NOTICE_LDT_VERSION_LIST", "NOTICE_OTHER_VERSION_LIST"].includes(operation)) {
          throw new Error("PROCUREMENT_NOT_FOUND");
        }
        if (operation === "NOTICE_LDT_DETAIL") return {
          data: { notifyNo: NOTICE_NO, notifyId: row.id, notifyVersion: "02", processApply: "LDT" },
        };
        throw new Error("unexpected sidecar request");
      },
    },
  });
  const bundle = await collector.collectCompleteBundle({
    type: "es-notify-contractor", notifyNo: NOTICE_NO,
    notifyId: row.id, notifyVersion: "00", processApply: "LDT",
  }, { detailLevel: "INVITATION", revisionMode: "SELECTED", revisionNumbers: ["00"] });
  assert.equal(bundle.revisions["00"].sources.noticeDetail.success, false);
  assert.equal(bundle.revisions["00"].sources.noticeDetail.error.code, "PROCUREMENT_REVISION_INVALID");
});

const CLARIFICATIONS = JSON.parse(fs.readFileSync(new URL(
  "../fixtures/muasamcong/notice/clarifications_IB2600493339.json", import.meta.url,
), "utf8"));

function historicalDetail(row) {
  const delayRows = {
    "00": [{
      id: "b0d28818-c8b5-4624-b347-df1b5bc94474", notifyNo: NOTICE_NO,
      notifyVersion: "00", notifyType: "TBMT", createdDate: "2026-09-17T15:21:32.535",
      bidCloseDate: "2026-09-18T10:00:00", bidCloseDelayDate: "2026-09-28T10:00:00",
      reason: "Gia hạn thời gian đóng, mở thầu để điều chỉnh E-HSMT",
    }],
    "01": [{
      id: "97e9b307-3e08-4de0-8c2d-f2272a53e3f0", notifyNo: NOTICE_NO,
      notifyVersion: "01", notifyType: "TBMT", createdDate: "2026-09-27T13:02:05.194",
      bidCloseDate: "2026-09-28T10:00:00", bidCloseDelayDate: "2026-10-01T10:00:00",
      reason: "Gia hạn thời điểm đóng mở thầu để trả lời yêu cầu làm rõ E-HSMT đảm bảo đúng thời gian quy định",
    }, {
      id: "e87ff07d-6e1d-4ed6-a839-d5e034967162", notifyNo: NOTICE_NO,
      notifyVersion: "01", notifyType: "TBMT", createdDate: "2026-09-29T17:00:25.708",
      bidCloseDate: "2026-10-01T10:00:00", bidCloseDelayDate: "2026-10-12T09:00:00",
      reason: "Gia hạn thời điểm đóng thầu để sửa đổi E-HSMT",
    }],
    "02": null,
  };
  const parent = {
    id: row.id, notifyNo: NOTICE_NO, notifyVersion: row.version,
    bidName: "Gói thầu kiểm thử", processApply: "LDT", bidMode: "1_MTHS",
    delayDTOList: delayRows[row.version],
  };
  return {
    bidoNotifyContractorM: { ...parent, delayDTOList: null },
    bidNoContractorResponse: { bidNotification: parent },
  };
}

function historyCollector({ clarificationError, collectionConcurrency = 1 } = {}) {
  const calls = [];
  const collector = new MscCollectors({
    collectionConcurrency,
    client: {
      async request(operation, payload) {
        calls.push([operation, payload]);
        if (operation === "NOTICE_LDT_VERSION_LIST") return { data: { versionList: VERSIONS } };
        if (operation === "NOTICE_OTHER_VERSION_LIST") return { data: [] };
        if (operation === "NOTICE_LDT_DETAIL") {
          const detail = historicalDetail(VERSIONS.find((row) => row.id === payload.id));
          return { data: { bidoNotifyContractorM: detail.bidoNotifyContractorM } };
        }
        if (operation === "NOTICE_TENDER_INFO") {
          return { data: historicalDetail(VERSIONS.find((row) => row.id === payload.id)) };
        }
        if (operation === "NOTICE_CLARIFICATION") {
          if (clarificationError) throw new Error(clarificationError);
          return { data: structuredClone(CLARIFICATIONS), metadata: { networkWaitMs: 7 } };
        }
        return { data: [] };
      },
    },
  });
  return { collector, calls };
}

const CURRENT_NOTICE = {
  type: "es-notify-contractor", notifyNo: NOTICE_NO,
  notifyId: VERSIONS[0].id, notifyVersion: "02", processApply: "LDT",
};

test("COMPLETE ALL preserves each exact notice history and fetches grouped clarifications once", async () => {
  for (const collectionConcurrency of [1, 3]) {
    const { collector, calls } = historyCollector({ collectionConcurrency });
    const bundle = await collector.collectCompleteBundle(CURRENT_NOTICE, {
      detailLevel: "COMPLETE", revisionMode: "ALL",
    });
    assert.deepEqual(Object.keys(bundle.revisions).sort(), ["00", "01", "02"]);
    assert.equal(bundle.status, "FOUND_COMPLETE");
    assert.deepEqual(calls.filter(([operation]) => operation === "NOTICE_LDT_DETAIL")
      .map(([, payload]) => payload.id).sort(), VERSIONS.map((row) => row.id).sort());
    assert.deepEqual(calls.filter(([operation]) => operation === "NOTICE_TENDER_INFO")
      .map(([, payload]) => payload).sort((a, b) => a.id.localeCompare(b.id)),
    VERSIONS.map((row) => ({ id: row.id })).sort((a, b) => a.id.localeCompare(b.id)));
    assert.deepEqual(calls.filter(([operation]) => operation === "NOTICE_CLARIFICATION"), [
      ["NOTICE_CLARIFICATION", { notifyNo: NOTICE_NO, processApply: "LDT" }],
    ]);
    const clarificationSources = Object.values(bundle.revisions).map((node) => node.sources.clarification);
    assert.equal(clarificationSources.filter((source) => source.attempted).length, 1);
    assert.equal(clarificationSources.filter((source) => source.reused).length, 2);
    assert.equal(clarificationSources.reduce((sum, source) => sum + Number(source.metrics?.networkWaitMs || 0), 0), 7);
    for (const row of VERSIONS) {
      const node = bundle.revisions[row.version];
      assert.equal(node.sources.noticeDetail.response.bidNoContractorResponse, undefined);
      assert.equal(node.sources.noticeDetail.response.bidoNotifyContractorM.delayDTOList, null);
      assert.equal(node.sources.tenderInfo.operation, "NOTICE_TENDER_INFO");
      assert.equal(node.sources.tenderInfo.endpoint,
        "/lcnt_tbmt_ttc_ldt");
      assert.deepEqual(node.sources.tenderInfo.request, { id: row.id });
      const raw = node.sources.tenderInfo.response;
      assert.equal(raw.bidoNotifyContractorM.id, row.id);
      assert.equal(raw.bidoNotifyContractorM.notifyVersion, row.version);
      assert.equal(raw.bidoNotifyContractorM.delayDTOList, null);
      assert.equal(raw.bidNoContractorResponse.bidNotification.delayDTOList?.length ?? 0,
        row.version === "00" ? 1 : row.version === "01" ? 2 : 0);
      assert.deepEqual(node.sources.clarification.response, CLARIFICATIONS);
    }
    clarificationSources[0].response.biduClarifyReqInvAndContentViewVersionDTOList[0].notifyVersion = "changed";
    assert.equal(clarificationSources[1].response.biduClarifyReqInvAndContentViewVersionDTOList[0].notifyVersion, "01");
  }
});

test("failed grouped clarification fetch stays non-authoritative for every source revision", async () => {
  const { collector, calls } = historyCollector({ clarificationError: "PROCUREMENT_TIMEOUT" });
  const bundle = await collector.collectCompleteBundle(CURRENT_NOTICE, {
    detailLevel: "COMPLETE", revisionMode: "ALL",
  });
  assert.equal(calls.filter(([operation]) => operation === "NOTICE_CLARIFICATION").length, 1);
  assert.equal(bundle.status, "FOUND_PARTIAL");
  assert.deepEqual(bundle.failures.filter((failure) => failure.operation === "NOTICE_CLARIFICATION")
    .map((failure) => failure.revision).sort(), ["00", "01", "02"]);
  Object.values(bundle.revisions).forEach((node) => {
    assert.equal(node.sources.clarification.success, false);
    assert.equal(node.sources.clarification.response, null);
    assert.equal(node.sources.clarification.error.code, "PROCUREMENT_TIMEOUT");
  });
});

test("INVITATION ALL used by plan enrichment never requests grouped clarification", async () => {
  const { collector, calls } = historyCollector();
  const bundle = await collector.collectCompleteBundle(CURRENT_NOTICE, {
    detailLevel: "INVITATION", revisionMode: "ALL",
  });
  assert.equal(calls.some(([operation]) => operation === "NOTICE_CLARIFICATION"), false);
  assert.equal(calls.some(([operation]) => operation === "NOTICE_CONTRACT_LIST"), false);
  Object.values(bundle.revisions).forEach((node) => {
    assert.equal(node.sources.clarification, undefined);
    assert.equal(node.sources.tenderInfo.operation, "NOTICE_TENDER_INFO");
  });
});
