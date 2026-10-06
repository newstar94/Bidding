import assert from "node:assert/strict";
import test from "node:test";
import {
  addAdminServicePackage, calculateAdminVat, configureAdminExportMapping,
  groupAdminPackages, packagePreviewMarkup,
} from "../../frontend/admin-platform/AdminServicePackages.js";

test("new packages use blank independent monthly and annual prices and cannot overwrite existing offers", () => {
  const source = { offers: [], policies: { baseTerm: { kind: "fixed_days", days: 365 } }, unknown: { preserved: true } };
  const before = structuredClone(source);
  const result = addAdminServicePackage(source, { tier: "personal", variant: "internal", name: "Cá nhân", periods: ["yearly", "monthly"] });
  assert.deepEqual(source, before);
  assert.deepEqual(result.unknown, before.unknown);
  assert.deepEqual(result.policies.baseTerm, source.policies.baseTerm);
  assert.equal(result.policies.monthlyBaseTerm.kind, "blocked_decision");
  assert.equal(groupAdminPackages(result.offers).length, 1);
  for (const offer of result.offers) {
    assert.equal(offer.salesState, "non_sellable");
    assert.equal(offer.ownerKind, "account");
    assert.equal(offer.memberQuota, 1);
    assert.equal(offer.includedProcurementQuota, 0);
    assert.equal(offer.exportCapabilities, null);
    assert.equal(offer.price.total, null);
    assert.equal(offer.price.tax, null);
    assert.equal(offer.price.subtotal, null);
  }
  assert.throws(() => addAdminServicePackage(result, { tier: "personal", variant: "internal", name: "Trùng" }), /đã có giá năm/u);
  assert.throws(() => addAdminServicePackage(source, { tier: "enterprise", variant: "internal", name: "Mới" }), /hợp lệ/u);
});

test("package duplication keeps source fields and rights intact and resets the target prices", () => {
  const source = { offers: [{ tier: "silver", variant: "connected", ownerKind: "organization", code: "silver.connected.yearly", memberQuota: 7,
    price: { period: "yearly", currency: "VND", total: 1000, tax: 100, subtotal: 900, extra: true },
    exportCapabilities: { "document.export.word": true, "document.export.excel": false, "document.export.award_result_excel": true },
    includedProcurementQuota: 500, violationCheckEnabled: true, display: { name: "Nguồn", benefits: ["Đã duyệt"], extra: true }, extra: { keep: true } }], policies: {} };
  const before = structuredClone(source);
  const result = addAdminServicePackage(source, { tier: "gold", variant: "connected", name: "Mới", sourceIndex: 0 });
  assert.deepEqual(source, before);
  assert.deepEqual(result.offers[0], before.offers[0]);
  assert.deepEqual(result.offers[1].exportCapabilities, before.offers[0].exportCapabilities);
  assert.deepEqual(result.offers[1].extra, { keep: true });
  assert.equal(result.offers[1].price.extra, true);
  assert.equal(result.offers[1].includedProcurementQuota, null);
  assert.equal(result.offers[1].price.total, null);
});

test("explicit export configuration is limited to existing export capabilities", () => {
  const source = addAdminServicePackage({ offers: [] }, { tier: "gold", variant: "connected", name: "Gói" });
  const result = configureAdminExportMapping(source, 0);
  assert.equal(source.offers[0].exportCapabilities, null);
  assert.deepEqual(result.offers[0].exportCapabilities, { "document.export.word": false, "document.export.excel": false, "document.export.award_result_excel": false });
  assert.throws(() => configureAdminExportMapping(result, 0), /đang chờ/u);
});

test("VAT calculator rounds integer VND explicitly without floating point loss", () => {
  assert.deepEqual(calculateAdminVat("1200000", "10"), { tax: 120000, total: 1320000 });
  assert.deepEqual(calculateAdminVat("101", "7,50"), { tax: 8, total: 109 });
  assert.deepEqual(calculateAdminVat("15", "10"), { tax: 2, total: 17 });
  assert.deepEqual(calculateAdminVat("100", "0"), { tax: 0, total: 100 });
  for (const rate of ["", "-1", "101", "10.123", "NaN"]) assert.throws(() => calculateAdminVat("100", rate));
  assert.throws(() => calculateAdminVat("9007199254740991", "10"), /giới hạn/u);
});

test("unpriced preview does not imply a free offer and escapes administrator text", () => {
  const source = addAdminServicePackage({ offers: [] }, { tier: "personal", variant: "internal", name: "<script>x</script>" });
  const markup = packagePreviewMarkup(source, 0);
  assert.match(markup, /Chưa cấu hình/u);
  assert.match(markup, /&lt;script&gt;x/u);
  assert.doesNotMatch(markup, /<script>|>0(?:\s|&nbsp;)*₫/u);
  assert.match(markup, /Hàng tháng/u);
  assert.match(markup, /Hàng năm/u);
});
