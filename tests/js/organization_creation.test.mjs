import assert from "node:assert/strict";
import test from "node:test";

import { createOrganization } from "../../frontend/auth/WorkspaceSwitcherController.js";

test("organization creation preserves the tax code and idempotency key", async () => {
  const calls = [];
  const organization = await createOrganization({
    taxCode: "0010123456",
    shortName: "HCP",
    idempotencyKey: "org-request-12345678",
  }, async (url, options) => {
    calls.push({ url, options });
    return new Response(JSON.stringify({ organization: { id: "org-1", name: "HCP" } }), {
      status: 200,
      headers: { "content-type": "application/json" },
    });
  });

  assert.deepEqual(organization, { id: "org-1", name: "HCP" });
  assert.equal(calls[0].url, "/api/organizations");
  assert.equal(calls[0].options.headers["Idempotency-Key"], "org-request-12345678");
  assert.equal(calls[0].options.retries, 2);
  assert.deepEqual(JSON.parse(calls[0].options.body), { tax_code: "0010123456", short_name: "HCP" });
});

test("organization creation surfaces the server conflict message", async () => {
  await assert.rejects(
    createOrganization({ taxCode: "0010123456", shortName: "HCP", idempotencyKey: "org-request-12345678" }, async () => new Response(
      JSON.stringify({ error: "Mã số thuế đã tồn tại." }),
      { status: 409, headers: { "content-type": "application/json" } },
    )),
    /Mã số thuế đã tồn tại/,
  );
});
