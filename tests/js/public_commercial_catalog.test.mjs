import assert from "node:assert/strict";
import test from "node:test";

import {
  classifyPublicCommercialResponse,
  formatCommercialMoney,
  presentCommercialOffer,
  visibleOffersForOwner,
} from "../../frontend/commercial-policy/PublicCommercialCatalog.js";

const offer = (overrides = {}) => ({
  code: "opaque.offer.code",
  tier: "opaque-tier",
  variant: "internal",
  ownerKind: "organization",
  salesState: "sellable",
  memberQuota: 12,
  includedProcurementQuota: 34,
  violationCheckEnabled: false,
  price: { period: "yearly", currency: "VND", subtotal: 1000, tax: 100, total: 1100 },
  display: {
    name: "Tên cấu hình",
    description: "Mô tả cấu hình",
    order: 7,
    badge: "Được đề xuất",
    recommended: true,
    visibility: "public",
    variantLabel: "Vận hành riêng",
    periodLabel: "/ năm",
    benefits: ["Lợi ích từ release"],
  },
  ...overrides,
});

test("classifies the compatible off and enabled public envelopes", () => {
  assert.equal(classifyPublicCommercialResponse({ availability: "off", offers: [], creditPacks: [], quotaWarnings: [] }).state, "off");
  assert.equal(classifyPublicCommercialResponse({ releaseId: "r1", releaseChecksum: "c1", offers: [], creditPacks: [], quotaWarnings: [] }).state, "empty");
  assert.equal(classifyPublicCommercialResponse({ releaseId: "r1", releaseChecksum: "c1", offers: [offer()], creditPacks: [], quotaWarnings: [] }).state, "available");
});

test("rejects malformed and invented availability envelopes", () => {
  assert.equal(classifyPublicCommercialResponse(null).state, "unavailable");
  assert.equal(classifyPublicCommercialResponse({ offers: [] }).state, "unavailable");
  assert.equal(classifyPublicCommercialResponse({ availability: "available", offers: [] }).state, "unavailable");
  assert.equal(classifyPublicCommercialResponse({ availability: "off", offers: [offer()] }).state, "unavailable");
});

test("presents opaque offer metadata without tier or variant inference", () => {
  const presented = presentCommercialOffer(offer());

  assert.equal(presented.name, "Tên cấu hình");
  assert.equal(presented.description, "Mô tả cấu hình");
  assert.equal(presented.badge, "Được đề xuất");
  assert.equal(presented.variantLabel, "Vận hành riêng");
  assert.equal(presented.periodLabel, "/ năm");
  assert.deepEqual(presented.benefits, ["Lợi ích từ release"]);
  assert.equal(presented.recommended, true);
  assert.equal(presented.priceLabel, "1.100\u00a0₫");
  assert.doesNotMatch(JSON.stringify(presented), /opaque-tier|Nội bộ|Kết nối/u);
});

test("owner filtering preserves authoritative response order and rejects hidden or stopped offers", () => {
  const offers = [
    offer({ code: "second", display: { ...offer().display, name: "Thứ hai", order: 99 } }),
    offer({ code: "hidden", display: { ...offer().display, visibility: "hidden" } }),
    offer({ code: "stopped", salesState: "stopped" }),
    offer({ code: "account", ownerKind: "account" }),
    offer({ code: "first", display: { ...offer().display, name: "Thứ nhất", order: 1 } }),
  ];

  assert.deepEqual(visibleOffersForOwner(offers, "organization").map((item) => item.code), ["second", "first"]);
});

test("formats VND without inferring a billing period", () => {
  assert.equal(formatCommercialMoney(1234567, "VND"), "1.234.567\u00a0₫");
  assert.equal(formatCommercialMoney(0, "VND"), "0\u00a0₫");
});
