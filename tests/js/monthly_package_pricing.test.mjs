import assert from "node:assert/strict";
import test from "node:test";
import { applyPackageMonthlyBase, calculateMonthlyPackagePrices, packageMonthlyBase } from "../../frontend/admin-platform/MonthlyPackagePricing.js";
const policy = { taxInclusive: true, taxBasisPoints: 0, rounding: "ceil" };

test("the monthly listed price is the base and the annual listed price is ten times it", () => {
  const prices = calculateMonthlyPackagePrices("2000", policy);
  assert.equal(prices.monthly.total, 2000);
  assert.equal(prices.yearly.total, 20000);
  assert.equal(prices.yearly.monthlyBaseAmount, 2000);
  assert.equal(prices.yearly.period, "yearly");
});

test("each term recomputes VAT with the existing policy instead of multiplying a rounded monthly tax", () => {
  const prices = calculateMonthlyPackagePrices("101", { ...policy, taxBasisPoints: 750 });
  assert.equal(prices.monthly.tax, 8);
  assert.equal(prices.yearly.tax, 71);
  assert.equal(prices.yearly.total, 1010);
  assert.equal(prices.yearly.subtotal + prices.yearly.tax, prices.yearly.total);
  const exclusive = calculateMonthlyPackagePrices("101", { ...policy, taxInclusive: false, taxBasisPoints: 750 });
  assert.equal(exclusive.yearly.subtotal, 1010);
  assert.equal(exclusive.yearly.tax, 76);
});

test("price updates preserve both terms' rights quotas identity and every unrelated package", () => {
  const source = { taxInvoice: policy, policies: { monthlyBaseTerm: { kind: "fixed_days", days: 30 } }, offers: [
    { tier: "personal", variant: "connected", ownerKind: "account", code: "personal.connected.yearly", price: { period: "yearly", total: 2000, extra: "keep" }, includedProcurementQuota: 1000, exportCapabilities: { word: true } },
    { tier: "personal", variant: "connected", ownerKind: "account", code: "personal.connected.monthly", price: { period: "monthly", total: 300 }, includedProcurementQuota: 50 },
    { tier: "gold", variant: "connected", ownerKind: "organization", price: { period: "yearly", total: 5000 } },
  ] };
  const before = structuredClone(source);
  const result = applyPackageMonthlyBase(source, 1, "400");
  assert.deepEqual(source, before);
  assert.equal(result.offers[0].price.total, 4000);
  assert.equal(result.offers[1].price.total, 400);
  assert.equal(result.offers[0].price.extra, "keep");
  assert.equal(result.offers[0].includedProcurementQuota, 1000);
  assert.equal(result.offers[1].includedProcurementQuota, 50);
  assert.deepEqual(result.offers[0].exportCapabilities, before.offers[0].exportCapabilities);
  assert.deepEqual(result.offers[2], before.offers[2]);
  assert.deepEqual(result.policies.monthlyBaseTerm, { kind: "fixed_days", days: 30 });
  assert.deepEqual(result.policies.baseTerm, { kind: "fixed_days", days: 365 });
  assert.equal(packageMonthlyBase(result, 0), 400);
  assert.equal(packageMonthlyBase(before, 0), 200);
});

test("blank fractional negative and overflow amounts cannot become valid prices", () => {
  for (const value of ["", "-1", "1.5", "NaN", "900719925474100"]) assert.throws(() => calculateMonthlyPackagePrices(value, policy));
  assert.throws(() => calculateMonthlyPackagePrices("2000", {}), /cấu hình thuế/u);
});


test("entering a monthly base creates the missing term and enables its Admin switch", async () => {
  const { packagePreviewMarkup } = await import("../../frontend/admin-platform/AdminServicePackages.js");
  const source = { taxInvoice: policy, policies: { baseTerm: { kind: "fixed_days", days: 365 } }, offers: [{
    tier: "personal", variant: "internal", ownerKind: "account", code: "personal.internal.yearly",
    price: { period: "yearly", total: 2000, tax: 0, subtotal: 2000 }, salesState: "sellable",
    memberQuota: 1, includedProcurementQuota: 0, exportCapabilities: { "document.export.word": true },
    display: { name: "Cá nhân", periodLabel: "Hàng năm" },
  }] };
  const before = structuredClone(source);
  const result = applyPackageMonthlyBase(source, 0, "399000");
  assert.deepEqual(source, before);
  assert.equal(result.offers.length, 2);
  const month = result.offers.find(offer => offer.price.period === "monthly");
  assert.equal(month.code, "personal.internal.monthly");
  assert.equal(month.price.total, 399000);
  assert.equal(month.salesState, "sellable");
  assert.equal(result.offers[0].price.total, 3990000);
  assert.deepEqual(month.exportCapabilities, before.offers[0].exportCapabilities);
  assert.deepEqual(result.policies.monthlyBaseTerm, { kind: "fixed_days", days: 30 });
  assert.equal(result.policies.baseTerm.days, 365);
  assert.doesNotMatch(packagePreviewMarkup(result, 0), /data-admin-package-period="1"[^>]*disabled/u);
  assert.equal(applyPackageMonthlyBase(result, 1, "400000").offers.length, 2);
});


test("monthly-only basic packages create their annual price without copying a monthly label", () => {
  const source = { taxInvoice: policy, offers: [{ tier: "silver", variant: "internal", ownerKind: "organization",
    code: "silver.internal.monthly", price: { period: "monthly", total: 2000 },
    salesState: "sellable", includedProcurementQuota: 0, memberQuota: 5,
    display: { periodLabel: "Hàng tháng" }, exportCapabilities: { "document.export.word": true },
  }] };
  const next = applyPackageMonthlyBase(source, 0, "2000");
  assert.equal(next.offers[1].price.period, "yearly");
  assert.equal(next.offers[1].price.total, 20000);
  assert.equal(next.offers[1].display.periodLabel, undefined);
  assert.equal(next.offers[1].memberQuota, 5);
  assert.equal(next.offers[1].salesState, "sellable");
  const colliding = structuredClone(source);
  colliding.offers.push({ code: "silver.internal.yearly", tier: "gold", variant: "internal", ownerKind: "organization", price: { period: "yearly" } });
  assert.throws(() => applyPackageMonthlyBase(colliding, 0, "2000"), /đã tồn tại/u);
  assert.equal(colliding.offers.length, 2);
});
