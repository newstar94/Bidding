import assert from "node:assert/strict";
import fs from "node:fs";
import test from "node:test";

import { adminChuanHoaMarkup, confirmChuanHoaEntitlement } from "../../frontend/admin-platform/AdminChuanHoa.js";
import { postAdminIntegrationJson } from "../../frontend/admin-platform/AdminApi.js";

test("Chuẩn Hóa admin surface labels source, bounded directories, and mutation state", () => {
  const markup = adminChuanHoaMarkup({
    status: "available",
    data: { status: "available", capabilities: { accounts: true, subscriptions: true, billing: true, activation: true } },
  });
  assert.match(markup, /Nguồn sự thật/u);
  assert.match(markup, /Backend Chuẩn Hóa/u);
  assert.match(markup, /data-chuan-hoa-resource="subscriptions"/u);
  assert.match(markup, /data-chuan-hoa-resource="payments"/u);
  assert.match(markup, /data-chuan-hoa-resource="audit"/u);
  assert.match(markup, /data-chuan-hoa-extend/u);
  assert.match(markup, /Gia hạn entitlement/u);
});

test("Chuẩn Hóa admin surface keeps mutation hidden when target capability is unavailable", () => {
  const markup = adminChuanHoaMarkup({ status: "not_ready", data: { capabilities: { accounts: true } } });
  assert.doesNotMatch(markup, /data-chuan-hoa-extend/u);
  assert.match(markup, /không tự retry/u);
});

test("entitlement mutation requires explicit target-app confirmation", () => {
  const messages = [];
  assert.equal(confirmChuanHoaEntitlement({ userId: "user-7", durationDays: 30 }, message => {
    messages.push(message);
    return false;
  }), false);
  assert.match(messages[0], /Chuẩn Hóa/u);
  assert.match(messages[0], /user-7/u);
  assert.equal(confirmChuanHoaEntitlement({ userId: "user-7", durationDays: 30 }, () => true), true);
});

test("cross-application mutations never ask the client to retry", async () => {
  const requests = [];
  const fetchImpl = async (url, options) => {
    requests.push({ url, options });
    return new Response(JSON.stringify({ error: "upstream unavailable" }), { status: 503, headers: { "content-type": "application/json" } });
  };
  await assert.rejects(() => postAdminIntegrationJson("/api/admin/integrations/chuan-hoa/entitlements/extend", {
    idempotencyKey: "chuan-hoa-test-key-1234",
    body: { userId: "user-7", productId: "product-1", featureCodes: ["a"], durationDays: 30, reason: "test" },
    fetchImpl,
  }));
  assert.equal(requests.length, 1);
});

test("Chuẩn Hóa collections expose bounded server pagination controls", () => {
  const source = fs.readFileSync(new URL("../../frontend/admin-platform/AdminChuanHoa.js", import.meta.url), "utf8");
  assert.match(source, /pageSize: 25/u);
  assert.match(source, /data-chuan-hoa-page="prev"/u);
  assert.match(source, /data-chuan-hoa-page="next"/u);
  assert.match(source, /current \* pageSize < total/u);
});
