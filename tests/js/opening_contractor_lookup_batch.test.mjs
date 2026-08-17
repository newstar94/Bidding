import assert from "node:assert/strict";
import fs from "node:fs";
import test from "node:test";

import {
  enrichOpeningRowsWithPartnerInfo,
  refreshSavedOpeningViolationChecks,
} from "../../frontend/packages/openingContractorLookup.js";
import { collectOpeningBidsFromRows } from "../../frontend/packages/bidProcessOpeningData.js";
import { lookupPartnerInfo } from "../../frontend/partners/partnerTaxLookup.js";


function openingRow(code) {
  const fields = new Map([
    [".mt-ma-nha-thau", { value: code }],
    [".mt-ten-nha-thau", { value: "" }],
    [".mt-loai-nha-thau", { value: "Independent" }],
  ]);
  return {
    dataset: {},
    getAttribute(attribute) {
      return attribute === "data-id" ? `bid-${code}` : null;
    },
    querySelector(selector) {
      return fields.get(selector) || null;
    },
  };
}


async function withLookupFetch(fetchImpl, callback) {
  const previousFetch = globalThis.fetch;
  const previousElement = globalThis.Element;
  globalThis.fetch = fetchImpl;
  globalThis.Element = class Element {};
  try {
    return await callback();
  } finally {
    if (previousFetch === undefined) delete globalThis.fetch;
    else globalThis.fetch = previousFetch;
    if (previousElement === undefined) delete globalThis.Element;
    else globalThis.Element = previousElement;
  }
}


function partnerResponse(code, representativeName = `Representative ${code}`) {
  return new Response(JSON.stringify({
    found: true,
    name: `Contractor ${code}`,
    org_code: code,
    representative_name: representativeName,
  }), {
    status: 200,
    headers: { "content-type": "application/json" },
  });
}


test("opening enrichment looks up a repeated contractor code only once", async () => {
  const rows = [openingRow("vn0306089887"), openingRow("vn0306089887")];
  let calls = 0;

  await withLookupFetch(async (url) => {
    calls += 1;
    const code = new URL(String(url), "http://local").searchParams.get("orgCode");
    return partnerResponse(code, "Tran Anh Khoa");
  }, () => enrichOpeningRowsWithPartnerInfo(rows, { getLatestNhaThau: () => [] }));

  assert.equal(calls, 1);
  assert.deepEqual(
    rows.map((row) => row._leadMemberLookupData?.nguoiDaiDien),
    ["Tran Anh Khoa", "Tran Anh Khoa"],
  );
});


test("opening lookup can preserve a transient HTTP failure instead of reporting not-found", async () => {
  await withLookupFetch(async () => new Response(JSON.stringify({
    code: "rate_limit_exceeded",
  }), {
    status: 429,
    headers: { "content-type": "application/json", "retry-after": "120" },
  }), async () => {
    await assert.rejects(
      lookupPartnerInfo({ orgCode: "vn0306089887", throwOnError: true }),
      (error) => error?.status === 429 && error?.code === "rate_limit_exceeded",
    );
    assert.equal(await lookupPartnerInfo({ orgCode: "vn0306089887" }), null);
  });
});


test("opening enrichment uses bounded concurrency for many new contractors", async () => {
  const rows = Array.from({ length: 12 }, (_, index) => openingRow(`vn${String(3000000000 + index)}`));
  let active = 0;
  let maxActive = 0;

  await withLookupFetch(async (url) => {
    active += 1;
    maxActive = Math.max(maxActive, active);
    await new Promise((resolve) => setTimeout(resolve, 10));
    active -= 1;
    const code = new URL(String(url), "http://local").searchParams.get("orgCode");
    return partnerResponse(code);
  }, () => enrichOpeningRowsWithPartnerInfo(rows, { getLatestNhaThau: () => [] }));

  assert.ok(maxActive <= 3, `expected at most 3 active lookups, received ${maxActive}`);
  assert.ok(rows.every((row) => row._leadMemberLookupData?.nguoiDaiDien));
});


test("an existing contractor without a representative is enriched again", async () => {
  const code = "vn0316155458";
  const row = openingRow(code);
  let calls = 0;
  const existing = {
    id: "contractor-1",
    maNhaThau: code,
    tenNhaThau: "Existing contractor",
    nguoiDaiDien: "",
  };

  await withLookupFetch(async () => {
    calls += 1;
    return partnerResponse(code, "Huynh Minh Hien");
  }, () => enrichOpeningRowsWithPartnerInfo([row], {
    getLatestNhaThau: () => [existing],
  }));

  assert.equal(calls, 1);
  assert.equal(row._leadMemberLookupData?.nguoiDaiDien, "Huynh Minh Hien");
});


test("new lookup fields complete and restage an existing incomplete contractor", async () => {
  const code = "vn0316155458";
  const row = openingRow(code);
  const existing = {
    id: "contractor-1",
    rootId: "contractor-1",
    phienBan: "00",
    isLatest: 1,
    maNhaThau: code,
    tenNhaThau: "Existing contractor",
    nguoiDaiDien: "",
  };
  const model = {
    state: {
      goithau: [{ id: "package-1", thoiGianMoThau: "2026-08-17" }],
      nhathau: [existing],
      thongtinmothau: [],
    },
    getLatestNhaThau: () => [existing],
    parseVND: (value) => Number(value || 0),
  };

  await withLookupFetch(
    async () => partnerResponse(code, "Huynh Minh Hien"),
    () => enrichOpeningRowsWithPartnerInfo([row], model),
  );
  const changedContractors = [];
  collectOpeningBidsFromRows({
    rows: [row],
    gtId: "package-1",
    model,
    isDirectOrSpecial: false,
    changedContractors,
  });

  assert.equal(existing.nguoiDaiDien, "Huynh Minh Hien");
  assert.deepEqual(changedContractors, [existing]);
});


test("saved-opening violation refresh is also concurrency bounded", async () => {
  const bids = Array.from({ length: 10 }, (_, index) => ({
    id: `bid-${index}`,
    maDinhDanh: `vn${String(3100000000 + index)}`,
    loaiNhaThau: "Independent",
  }));
  let active = 0;
  let maxActive = 0;

  await withLookupFetch(async () => {
    active += 1;
    maxActive = Math.max(maxActive, active);
    await new Promise((resolve) => setTimeout(resolve, 10));
    active -= 1;
    return new Response(JSON.stringify({ violationStatus: "NO_ACTIVE_VIOLATION" }), {
      status: 200,
      headers: { "content-type": "application/json" },
    });
  }, () => refreshSavedOpeningViolationChecks("package-1", bids));

  assert.ok(maxActive <= 3, `expected at most 3 active checks, received ${maxActive}`);
});


test("post-commit opening checks do not block the save success path", () => {
  const source = fs.readFileSync("frontend/packages/BidProcessWorkflow.js", "utf8");

  assert.doesNotMatch(source, /await\s+refreshSavedOpeningViolationChecks\s*\(/u);
  assert.doesNotMatch(source, /await\s+this\.view\.showPackageDetails\s*\(detailPackageId\)/u);
});
