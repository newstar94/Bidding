import assert from "node:assert/strict";
import test from "node:test";

import { draftEditorMarkup, serializeDraftDocument } from "../../frontend/admin-platform/AdminPlans.js";

function candidateRoot(advanced, fields = []) {
  return {
    querySelector(selector) {
      return selector === "#admin-plan-advanced-document" ? { value: JSON.stringify(advanced) } : null;
    },
    querySelectorAll(selector) {
      return selector === "[data-admin-commercial-config]" ? fields : [];
    },
  };
}

function configField(path, original, value = original, kind = "text") {
  return { value, dataset: { adminCommercialConfig: path, adminConfigOriginal: original, adminConfigKind: kind } };
}

test("open sales errors use Vietnamese sections and link to settings without enabling publish", () => {
  const validation = {
    validationDigest: "test-digest", readinessExpiresAt: 9999999999,
    errors: [
      { path: "externalReadiness", code: "BLOCKED_EXTERNAL", message: "Thiếu xác nhận mở bán." },
      { path: "taxInvoice", code: "BLOCKED_EXTERNAL", message: "Thiếu thuế suất." },
      { path: "providerProfiles", code: "NO_HEALTHY_PROVIDER", message: "Thiếu cấu hình payOS." },
      { path: '<img src=x onerror="attack()">', message: '<script>attack()</script>' },
    ],
  };
  const before = structuredClone(validation);
  const markup = draftEditorMarkup({ id: "draft", revision: 1, document: { offers: [], taxInvoice: { invoiceEnabled: false } } }, validation);
  const panel = markup.match(/<div id="admin-plan-validation"[\s\S]*?<\/ul><\/div><\/div>/u)?.[0];
  assert.ok(panel);
  for (const label of ["Điều kiện mở bán", "Cấu hình thuế", "Thanh toán payOS"]) assert.ok(panel.includes(label));
  assert.doesNotMatch(panel, /<strong>(externalReadiness|taxInvoice|providerProfiles)<\/strong>/u);
  assert.match(panel, /data-admin-validation-target="tax"/u);
  assert.match(panel, /data-admin-validation-target="payment"/u);
  assert.match(panel, /&lt;img/u);
  assert.match(panel, /&lt;script&gt;/u);
  assert.doesNotMatch(panel, /<img|<script>/u);
  assert.match(markup, /data-admin-plan-action="publish" disabled/u);
  assert.deepEqual(validation, before);
});

test("tax and payOS controls display unresolved values without filling decisions or credentials", () => {
  const markup = draftEditorMarkup({ id: "draft", revision: 1, document: {
    offers: [],
    taxInvoice: { approvalReference: null, taxInclusive: null, taxBasisPoints: null, rounding: null, invoiceTrigger: null },
    providerProfiles: [{ provider: "payos", environment: "production", mode: "shadow", readiness: "blocked_external", credentialReference: null }],
    externalReadiness: { vatInvoice: null, payosMerchant: null, credentialWebhook: null, ecommercePrivacy: null, termsRefund: null },
    rollout: { mode: "shadow" },
  } });
  assert.match(markup, /data-admin-tax-settings/u);
  assert.match(markup, /data-admin-payment-settings/u);
  for (const path of ["taxInvoice.approvalReference", "taxInvoice.taxInclusive", "taxInvoice.taxBasisPoints", "providerProfiles.0.credentialReference"]) {
    assert.ok(markup.includes(`data-admin-commercial-config="${path}"`));
  }
  assert.match(markup, /data-admin-commercial-config="taxInvoice[.]taxInclusive"[^>]*><option value="" selected>/u);
  assert.match(markup, /data-admin-commercial-config="taxInvoice[.]taxBasisPoints"[^>]*value=""/u);
  assert.match(markup, /value="blocked_external" selected/u);
  assert.doesNotMatch(markup, /value="ready" selected|env:\/\/payos\/default|PAYOS_API_KEY|PAYOS_CHECKSUM_KEY/u);
  assert.match(markup, /Máy chủ vẫn kiểm tra/u);
  assert.match(markup, /data-admin-plan-action="publish" disabled/u);
});

test("unmodified controls preserve missing null unknown and explicitly edited advanced configuration", () => {
  const source = {
    taxInvoice: { taxInclusive: false, taxBasisPoints: null, rounding: "existing_rule", sellerProfile: { legalName: "Bên bán", unknown: true } },
    providerProfiles: [{ provider: "fake", mode: "shadow" }, { provider: "payos", credentialReference: null, custom: { keep: true } }],
    externalReadiness: { vatInvoice: null, unknownReference: "preserve" },
    rollout: { mode: "shadow", cohorts: ["cohort-1"] },
    offers: [],
  };
  const advanced = structuredClone(source);
  advanced.taxInvoice.rounding = "half_up";
  const root = candidateRoot(advanced, [
    configField("taxInvoice.taxInclusive", "false", "false", "boolean"),
    configField("taxInvoice.taxBasisPoints", "", "", "percentage"),
    configField("taxInvoice.approvalReference", ""),
    configField("taxInvoice.rounding", "existing_rule"),
    configField("providerProfiles.1.credentialReference", ""),
    configField("externalReadiness.vatInvoice", ""),
    configField("taxInvoice.sellerProfile.legalName", "Bên bán"),
    configField("taxInvoice.sellerProfile.taxCode", ""),
  ]);
  const result = serializeDraftDocument(root, source);
  assert.deepEqual(result, advanced);
  assert.equal(Object.hasOwn(result.taxInvoice, "approvalReference"), false);
  assert.equal(Object.hasOwn(result.taxInvoice.sellerProfile, "taxCode"), false);
  assert.equal(source.taxInvoice.rounding, "existing_rule");
});

test("tax and payOS edits serialize exactly while retaining other profiles and metadata", () => {
  const advanced = {
    taxInvoice: { approvalReference: null, taxInclusive: null, taxBasisPoints: null, sellerProfile: { unknown: "keep" }, extra: "keep" },
    providerProfiles: [{ provider: "fake", mode: "shadow", opaque: 7 }, { provider: "payos", environment: "production", credentialReference: null, readiness: "blocked_external", opaque: 9 }],
    externalReadiness: { unknownReference: "keep" }, rollout: { mode: "shadow", cohorts: ["keep"] },
  };
  const root = candidateRoot(advanced, [
    configField("taxInvoice.taxInclusive", "", "false", "boolean"),
    configField("taxInvoice.taxBasisPoints", "", "8.25", "percentage"),
    configField("taxInvoice.approvalReference", "", "approved-tax-reference"),
    configField("taxInvoice.rounding", "", "half_up"),
    configField("taxInvoice.invoiceTrigger", "", "activation_applied"),
    configField("taxInvoice.sellerProfile.legalName", "", "Đơn vị bán dịch vụ"),
    configField("taxInvoice.sellerProfile.taxCode", "", "0123456789"),
    configField("providerProfiles.1.credentialReference", "", "secret://configured-reference"),
    configField("providerProfiles.1.checkoutTtlSeconds", "", "600", "integer"),
    configField("externalReadiness.vatInvoice", "", "confirmed-reference"),
    configField("rollout.mode", "shadow", "pilot"),
  ]);
  const result = serializeDraftDocument(root, { ...advanced, offers: [] });
  assert.equal(result.taxInvoice.taxInclusive, false);
  assert.equal(result.taxInvoice.taxBasisPoints, 825);
  assert.equal(result.taxInvoice.rounding, "half_up");
  assert.equal(result.taxInvoice.invoiceTrigger, "activation_applied");
  assert.equal(result.taxInvoice.sellerProfile.taxCode, "0123456789");
  assert.equal(result.taxInvoice.sellerProfile.unknown, "keep");
  assert.equal(result.taxInvoice.extra, "keep");
  assert.deepEqual(result.providerProfiles[0], advanced.providerProfiles[0]);
  assert.equal(result.providerProfiles[1].credentialReference, "secret://configured-reference");
  assert.equal(result.providerProfiles[1].checkoutTtlSeconds, 600);
  assert.equal(result.providerProfiles[1].readiness, "blocked_external");
  assert.equal(result.providerProfiles[1].opaque, 9);
  assert.equal(result.externalReadiness.unknownReference, "keep");
  assert.deepEqual(result.rollout, { mode: "pilot", cohorts: ["keep"] });
  assert.equal(advanced.taxInvoice.taxBasisPoints, null);
});

test("explicit clears remain unresolved and percentage validation rejects rounding or range guesses", () => {
  const advanced = { taxInvoice: { taxBasisPoints: 800, taxInclusive: true } };
  const cleared = serializeDraftDocument(candidateRoot(advanced, [
    configField("taxInvoice.taxBasisPoints", "8", "", "percentage"),
    configField("taxInvoice.taxInclusive", "true", "", "boolean"),
  ]), { offers: [] });
  assert.equal(cleared.taxInvoice.taxBasisPoints, null);
  assert.equal(cleared.taxInvoice.taxInclusive, null);
  for (const value of ["8.255", "-1", "100.01", "1e1", "not a number"]) {
    assert.throws(() => serializeDraftDocument(candidateRoot({}, [configField("taxInvoice.taxBasisPoints", "", value, "percentage")]), { offers: [] }), /Thuế suất/u);
  }
  assert.throws(() => serializeDraftDocument(candidateRoot({ providerProfiles: [{ provider: "payos" }] }, [configField("providerProfiles.0.minAmount", "", "1.5", "integer")]), { offers: [] }), /số nguyên/u);
});

test("payOS edits cannot silently update a profile reordered through advanced JSON", () => {
  const root = candidateRoot({ providerProfiles: [{ provider: "fake" }] }, [configField("providerProfiles.0.credentialReference", "", "new-reference")]);
  assert.throws(() => serializeDraftDocument(root, { offers: [] }), /Danh sách cấu hình payOS đã thay đổi/u);
});

test("invoice switch has separate wording and preserves unresolved legacy decisions", () => {
  for (const invoiceEnabled of [undefined, null, false, true]) {
    const taxInvoice = invoiceEnabled === undefined ? { invoiceTrigger: "disabled" } : { invoiceEnabled, invoiceTrigger: "verified_payment" };
    const raw = invoiceEnabled === undefined || invoiceEnabled === null ? "" : String(invoiceEnabled);
    const result = serializeDraftDocument(candidateRoot({ taxInvoice }, [configField("taxInvoice.invoiceEnabled", raw, raw, "boolean")]), { offers: [] });
    assert.deepEqual(result.taxInvoice, taxInvoice);
    const markup = draftEditorMarkup({ id: "draft", revision: 1, document: { offers: [], taxInvoice } });
    const control = markup.match(/<select[^>]*data-admin-commercial-config="taxInvoice[.]invoiceEnabled"[^>]*>[\s\S]*?<\/select>/u)?.[0];
    assert.ok(control);
    assert.match(control, /Không xuất hóa đơn/u);
    assert.match(control, /Có xuất hóa đơn/u);
    assert.doesNotMatch(control, /gồm VAT/u);
    assert.ok(control.includes(`<option value="${raw}" selected>`));
    assert.match(markup, /Thông tin bên bán khi bật xuất hóa đơn/u);
    if (invoiceEnabled === undefined) assert.match(markup, /value="disabled" selected/u);
  }
});

test("turning invoices on or off keeps tax prices and future seller configuration", () => {
  const advanced = {
    taxInvoice: { invoiceEnabled: false, invoiceTrigger: "verified_payment", taxInclusive: true, taxBasisPoints: 0, sellerProfile: { legalName: "Bên bán", email: "invoice@example.invalid" } },
    creditPacks: [{ price: 99000 }],
  };
  const enabled = serializeDraftDocument(candidateRoot(advanced, [configField("taxInvoice.invoiceEnabled", "false", "true", "boolean")]), { offers: [] });
  assert.equal(enabled.taxInvoice.invoiceEnabled, true);
  assert.equal(enabled.taxInvoice.invoiceTrigger, "verified_payment");
  assert.deepEqual(enabled.taxInvoice.sellerProfile, advanced.taxInvoice.sellerProfile);
  assert.deepEqual(enabled.creditPacks, advanced.creditPacks);
  const disabled = serializeDraftDocument(candidateRoot(enabled, [configField("taxInvoice.invoiceEnabled", "true", "false", "boolean")]), { offers: [] });
  assert.deepEqual(disabled.taxInvoice, advanced.taxInvoice);
});

test("clearing optional seller information removes that field without injecting a null value", () => {
  const advanced = { taxInvoice: { invoiceEnabled: false, sellerProfile: { legalName: "Bên bán", email: "invoice@example.invalid", taxCode: "0123456789" } } };
  const result = serializeDraftDocument(candidateRoot(advanced, [configField("taxInvoice.sellerProfile.email", "invoice@example.invalid", "")]), { offers: [] });
  assert.deepEqual(result.taxInvoice.sellerProfile, { legalName: "Bên bán", taxCode: "0123456789" });
  assert.equal(advanced.taxInvoice.sellerProfile.email, "invoice@example.invalid");
});

test("configuration fields escape their authoritative values and preserve unknown choices", () => {
  const markup = draftEditorMarkup({ id: "draft", revision: 1, document: {
    offers: [], taxInvoice: { approvalReference: '"><script>attack()</script>', rounding: "legacy_rounding", taxBasisPoints: 825 },
    providerProfiles: [{ provider: "payos", alias: '<img src=x onerror="attack()">', environment: "production", readiness: "legacy_status" }],
  } });
  assert.doesNotMatch(markup, /<script>attack\(\)<\/script>|<img src=x/u);
  assert.match(markup, /value="legacy_rounding" selected/u);
  assert.match(markup, /value="legacy_status" selected/u);
  assert.match(markup, /data-admin-commercial-config="taxInvoice[.]taxBasisPoints"[^>]*value="8[.]25"/u);
});
