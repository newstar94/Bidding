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
  assert.deepEqual(result.policies, before.policies);
  assert.equal(packageMonthlyBase(result, 0), 400);
  assert.equal(packageMonthlyBase(before, 0), 200);
});

test("blank fractional negative and overflow amounts cannot become valid prices", () => {
  for (const value of ["", "-1", "1.5", "NaN", "900719925474100"]) assert.throws(() => calculateMonthlyPackagePrices(value, policy));
  assert.throws(() => calculateMonthlyPackagePrices("2000", {}), /cấu hình thuế/u);
});
