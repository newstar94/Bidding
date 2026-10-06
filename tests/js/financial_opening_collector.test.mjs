import assert from "node:assert/strict";
import test from "node:test";
import { readFile } from "node:fs/promises";
import { MscCollectors } from "../../backend/integrations/muasamcong_browser/collectors.mjs";
import { ProcurementImportClient } from "../../frontend/procurement/ProcurementImportClient.js";

for (const name of ["consulting", "goods_lots"]) {
  test(`financial collector uses HAR packType/viewType and core sources: ${name}`, async () => {
    const fixture = JSON.parse(await readFile(new URL(`../fixtures/muasamcong/opening/financial/${name}.json`, import.meta.url), "utf8"));
    const calls = [];
    const collector = new MscCollectors({ client: { async request(operation, payload) {
      calls.push([operation, payload]);
      if (operation === "NOTICE_LDT_DETAIL") return { data: {
        notifyNo: fixture.request.notifyNo, notifyId: fixture.request.notifyId,
        processApply: "LDT", bidMode: "1_HTHS",
      } };
      const key = `${operation.toLowerCase()}_2`;
      assert.ok(fixture.raw[key] !== undefined, "financial flow needs only the five captured endpoints");
      assert.deepEqual(payload, fixture.sourceRequests[key]);
      return { data: fixture.raw[key] };
    } } });
    const result = await collector.getOpeningBundle(fixture.request.notifyNo, fixture.request.notifyId, { openingPhase: "FINANCIAL" });
    assert.deepEqual(result.failures, []);
    assert.equal(calls.length, 6);
    assert.deepEqual(result.requiredOpeningSources.map((row) => row.operation).sort(), [
      "OPENING_BID", "OPENING_LOT", "OPENING_LOT_DETAIL", "OPENING_NOTIFY", "OPENING_ROUND",
    ]);
    assert.ok(result.requiredOpeningSources.every((row) => row.packType === 2));
    assert.deepEqual(result.raw.opening_bid_2, fixture.raw.opening_bid_2);
  });
}

test("prepare client forwards the financial phase while retaining the legacy body", async () => {
  const client = new ProcurementImportClient();
  const requests = [];
  client.post = async (...args) => { requests.push(args); return {}; };
  await client.prepareOpening({ packageId: "pkg", openingPhase: "FINANCIAL" });
  await client.prepareOpening({ packageId: "pkg" });
  assert.equal(requests[0][1].openingPhase, "FINANCIAL");
  assert.equal("openingPhase" in requests[1][1], false);
});
