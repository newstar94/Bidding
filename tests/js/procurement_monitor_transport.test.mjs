import assert from "node:assert/strict";
import test from "node:test";
import { MscCollectors } from "../../backend/integrations/muasamcong_browser/collectors.mjs";

test("scheduled check reads latest revisions and only two fresh sidecars", async () => {
  const calls = [];
  const collectors = new MscCollectors({ client: { request: async (operation, payload) => {
    calls.push([operation, payload]);
    if (operation === "NOTICE_LDT_VERSION_LIST") return { data: [
      { id: "v0", notifyNo: "IB2600271825", notifyVersion: "00" },
      { id: "v1", notifyNo: "IB2600271825", notifyVersion: "01", processApply: "LDT" },
    ] };
    if (operation === "NOTICE_OTHER_VERSION_LIST") return { data: [] };
    return { data: [] };
  } } });
  const result = await collectors.getNoticeUpdates("IB2600271825");
  assert.equal(result.revisionNumber, "01");
  assert.equal(result.revisionId, "v1");
  assert.deepEqual(result.sources.petition, { success: true, response: [] });
  assert.equal(calls.length, 4);
  assert.deepEqual(calls.at(-1)[1], { notifyNo: "IB2600271825", processApply: "LDT" });
  await collectors.getNoticeUpdates("IB2600271825");
  assert.equal(calls.length, 8); // no cached lookup/baseline masquerading as fresh data
});

test("one failed category stays failed without erasing the other", async () => {
  const collectors = new MscCollectors({ client: { request: async (operation) => {
    if (operation === "NOTICE_LDT_VERSION_LIST") return { data: [
      { id: "v0", notifyNo: "IB2600271825", notifyVersion: "00" },
    ] };
    if (operation === "NOTICE_OTHER_VERSION_LIST") return { data: [] };
    if (operation === "NOTICE_PETITION") throw new Error("upstream provider detail");
    return { data: [] };
  } } });
  const result = await collectors.getNoticeUpdates("IB2600271825");
  assert.deepEqual(result.sources.petition, { success: false });
  assert.equal(result.sources.clarification.success, true);
  assert.doesNotMatch(JSON.stringify(result), /upstream provider/);
});
