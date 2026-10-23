import assert from "node:assert/strict";
import test from "node:test";

import { verificationSummary } from "../../frontend/admin/OrganizationVerification.js";
import { reviewVerification } from "../../frontend/admin-platform/AdminOrganizationVerifications.js";
import { normalizeOrganizations } from "../../frontend/auth/accessContext.js";
import { createOrganizationRequest, organizationTaxCodeProblem } from "../../frontend/auth/WorkspaceSwitcherController.js";

const json = (payload, status = 200) => new Response(JSON.stringify(payload), {
  status, headers: { "Content-Type": "application/json" },
});

test("tax code shape is checked before creation without a checksum", () => {
  assert.equal(organizationTaxCodeProblem("0101234567"), "");
  assert.equal(organizationTaxCodeProblem("0101 234 567"), "");
  assert.equal(organizationTaxCodeProblem("0101234567-001"), "");
  assert.match(organizationTaxCodeProblem("abc"), /10 chữ số/u);
  assert.match(organizationTaxCodeProblem(""), /Vui lòng nhập/u);
});

test("creation returns the claimed-by-verified hint without changing the organization", async () => {
  const created = await createOrganizationRequest(
    { taxCode: "0101234567", shortName: "HCP", idempotencyKey: "org-request-12345678" },
    async () => json({ taxCodeClaimedByVerifiedOrganization: true, organization: { id: "org-1", tax_code_verified: false } }),
  );
  assert.equal(created.taxCodeClaimedByVerifiedOrganization, true);
  assert.deepEqual(created.organization, { id: "org-1", tax_code_verified: false });
  await assert.rejects(
    createOrganizationRequest(
      { taxCode: "0101234567", shortName: "HCP", idempotencyKey: "org-request-12345678" },
      async () => json({ error: "Bạn đã tạo đủ số tổ chức cho phép trong 24 giờ.", code: "rate_limit_exceeded", retry_after: 3600 }, 429),
    ),
    /đủ số tổ chức/u,
  );
});

test("the verified badge is a strict boolean on the client model", () => {
  const organizations = normalizeOrganizations({
    organizations: [
      { id: "a", name: "A", tax_code_verified: true },
      { id: "b", name: "B", tax_code_verified: "true" },
      { id: "c", name: "C" },
    ],
  });
  assert.deepEqual(organizations.map((item) => item.tax_code_verified), [true, false, false]);
});

test("manager summary explains every verification state", () => {
  assert.deepEqual(
    { ...verificationSummary({ status: "verified", method: "legacy", taxCode: "0101234567" }), detail: "" },
    { tone: "success", title: "Đã xác minh", detail: "", canSubmit: false },
  );
  const pending = verificationSummary({
    status: "unverified", taxCode: "0101234567",
    request: { status: "pending", originalFilename: "dkkd.pdf", createdAt: 1_800_000_000 },
  });
  assert.equal(pending.canSubmit, false);
  assert.equal(pending.canCancel, true);
  const rejected = verificationSummary({
    status: "unverified", taxCode: "0101234567", claimedByVerifiedOrganization: true,
    request: { status: "rejected", reviewNote: "Ảnh mờ" },
  });
  assert.equal(rejected.canSubmit, true);
  assert.equal(rejected.tone, "warning");
  assert.match(rejected.detail, /Ảnh mờ/u);
  assert.match(rejected.detail, /tổ chức khác giữ/u);
  assert.equal(verificationSummary({ status: "unverified", taxCode: "" }).canSubmit, false);
  assert.match(verificationSummary({ status: "verified", method: "legacy", taxCode: "" }).detail, /từ trước/u);
});

test("admin review re-authenticates once and then retries the same decision", async () => {
  const calls = [];
  let reauthenticated = false;
  const fetchImpl = async (url, options) => {
    calls.push({ url, body: JSON.parse(options.body) });
    if (url === "/api/auth/privileged-reauth") { reauthenticated = true; return json({ success: true }); }
    if (!reauthenticated) return json({ error: "Cần xác thực lại mật khẩu để tiếp tục." }, 403);
    return json({ success: true, status: "approved" });
  };
  const result = await reviewVerification("request-12345678", "approve", { replaceExisting: true }, {
    fetchImpl, requestPassword: async () => "secret",
  });
  assert.deepEqual(result, { success: true, status: "approved" });
  assert.deepEqual(calls.map((call) => call.url), [
    "/api/admin/organization-verifications/request-12345678/approve",
    "/api/auth/privileged-reauth",
    "/api/admin/organization-verifications/request-12345678/approve",
  ]);
  assert.deepEqual(calls[2].body, { replaceExisting: true });
  await assert.rejects(
    reviewVerification("../../etc", "approve", {}, { fetchImpl, requestPassword: async () => null }),
  );
});
