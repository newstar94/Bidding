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

test("public details preserve every Admin right alongside custom marketing benefits", () => {
  const source = offer({ variant: "connected", exportCapabilities: {
    "document.export.word": true, "document.export.excel": false, "document.export.award_result_excel": true,
  } });
  assert.deepEqual(presentCommercialOffer(source).details, [
    { label: "Hạn mức thành viên", value: "12" },
    { label: "Lượt lấy dữ liệu tự động kèm theo", value: "34" },
    { label: "Kiểm tra vi phạm nhà thầu", value: "Không" },
    { label: "Xuất Word", value: "Có" },
    { label: "Xuất Excel", value: "Không" },
    { label: "Xuất kết quả lựa chọn nhà thầu", value: "Có" },
    { label: "Lợi ích từ release" },
  ]);
  assert.deepEqual(presentCommercialOffer(offer({ exportCapabilities: null })).details[3], { label: "Xuất Word", value: "Chưa cấu hình" });
  assert.deepEqual(presentCommercialOffer(offer()).details[1], { label: "Không lấy dữ liệu tự động" });
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


test("legacy catalog copy uses automatic-data labels without mutating the release", () => {
  const source = offer({ variant: "connected", display: {
    name: "Nâng cao", description: "Bổ sung lấy dữ liệu Mua Sắm Công",
    variantLabel: "Lấy dữ liệu tự động", benefits: ["100 lượt lấy hồ sơ Mua Sắm Công", "Xuất Word"],
  } });
  const original = structuredClone(source);
  const presented = presentCommercialOffer(source);
  assert.equal(presented.description, "Bổ sung lấy dữ liệu tự động");
  assert.deepEqual(presented.benefits, ["100 lượt lấy dữ liệu tự động", "Xuất Word"]);
  assert.ok(presented.details.some(item => item.label === "100 lượt lấy dữ liệu tự động"));
  assert.doesNotMatch(JSON.stringify(presented), /Mua Sắm Công/iu);
  assert.deepEqual(source, original);
});
