import assert from "node:assert/strict";
import test from "node:test";

import {
  catalogMarkup,
  draftEditorMarkup,
  plansMarkup,
  requestPlanActionInput,
  serializeDraftDocument,
} from "../../frontend/admin-platform/AdminPlans.js";

test("plan mutations use the shared accessible dialog and preserve required reasons", async () => {
  const requests = [];
  const requestValue = async (options) => {
    requests.push(options);
    return options.label ? "  Lý do đã duyệt  " : "";
  };

  assert.equal(await requestPlanActionInput("clone", { requestValue }), true);
  assert.equal(await requestPlanActionInput("stop-sales", { requestValue }), "Lý do đã duyệt");
  assert.equal(await requestPlanActionInput("publish", { requestValue }), "Lý do đã duyệt");
  assert.equal(requests.length, 3);
  assert.equal(requests[0].label, null);
  assert.match(requests[1].message, /Quyền lợi đã áp dụng không thay đổi/u);
  assert.equal(requests[2].label, "Lý do xuất bản (bắt buộc)");
});

test("plan mutations stop cleanly when the shared dialog is cancelled", async () => {
  const requestValue = async () => null;
  assert.equal(await requestPlanActionInput("clone", { requestValue }), false);
  assert.equal(await requestPlanActionInput("stop-sales", { requestValue }), null);
  assert.equal(await requestPlanActionInput("publish", { requestValue }), null);
});

function field(value = "", checked = false) {
  return { value: String(value), checked, classList: { add() {}, remove() {} } };
}

function editor(values) {
  return {
    querySelector(selector) {
      const name = selector.match(/data-admin-offer-field="([^"]+)"/u)?.[1];
      return values[name];
    },
  };
}

function draftRoot(advanced, offerValues) {
  return {
    querySelector(selector) {
      return selector === "#admin-plan-advanced-document" ? field(JSON.stringify(advanced)) : null;
    },
    querySelectorAll(selector) {
      return selector === "[data-admin-offer-editor]" ? offerValues.map(editor) : [];
    },
  };
}

test("plans catalog renders authoritative offers prices benefits and entitlement values", () => {
  const markup = catalogMarkup({
    releaseId: "release-live-7",
    releaseChecksum: "checksum-live-7",
    currency: "VND",
    quotaWarnings: [70, 90, 100],
    offers: [{
      code: "gold.connected.yearly",
      tier: "gold",
      variant: "connected",
      ownerKind: "organization",
      memberQuota: 15,
      includedProcurementQuota: 7000,
      price: { period: "yearly", currency: "VND", total: 35000000 },
      exportCapabilities: {
        "document.export.word": true,
        "document.export.excel": false,
        "document.export.award_result_excel": true,
      },
      violationCheckEnabled: true,
      salesState: "sellable",
      display: { name: "Vàng", variantLabel: "Kết nối", benefits: ["Quyền lợi từ release"], recommended: true },
      rawSecret: "must-not-render",
    }],
    creditPacks: [{ code: "procurement.20", quantity: 20, price: 99000, internal: "hidden" }],
  });
  assert.match(markup, /release-live-7/u);
  assert.match(markup, /Vàng/u);
  assert.match(markup, /gold[.]connected[.]yearly/u);
  assert.match(markup, /35[.]000[.]000/u);
  assert.match(markup, /Quyền lợi từ release/u);
  assert.match(markup, /Hạn mức thành viên:[\s\S]*15/u);
  assert.match(markup, /Lượt Mua Sắm Công kèm theo:[\s\S]*7[.]000/u);
  assert.match(markup, /Xuất Word:[\s\S]*Có/u);
  assert.match(markup, /Xuất Excel:[\s\S]*Không/u);
  assert.match(markup, /procurement[.]20[\s\S]*20[\s\S]*99[.]000/u);
  assert.doesNotMatch(markup, /must-not-render|hidden/u);
});

test("plans catalog keeps off and malformed authoritative states explicit", () => {
  assert.match(catalogMarkup({ availability: "off", offers: [], creditPacks: [], quotaWarnings: [] }), /Danh mục đang tắt/u);
  assert.match(catalogMarkup({ offers: [] }), /data-admin-state="error"/u);
});

test("plans view renders real release versions, status and draft revisions", () => {
  const markup = plansMarkup({
    currentRelease: {
      id: "release-1", versionLabel: "2026.09", mode: "live", scopeKey: "global",
      effectiveFrom: 1789000000, nonSellable: false, secret: "do-not-render",
    },
    scheduledRelease: {
      id: "release-2", versionLabel: "2026.10", mode: "shadow", scopeKey: "global",
      effectiveFrom: 1791000000, nonSellable: true,
    },
    drafts: [{
      id: "draft-1", status: "validated", revision: 7,
      base_release_id: "release-1", updated_at: "2026-09-10T00:00:00Z",
      document: "hidden-document",
    }],
    releaseHistory: [{
      id: "release-0", versionLabel: "2026.08", mode: "shadow", scopeKey: "global",
      effectiveFrom: 1786000000, nonSellable: true, baseReleaseId: "release-base",
      createdAt: "2026-08-01T00:00:00Z", internalSnapshot: "never-render",
    }],
  });
  assert.match(markup, /2026[.]09/u);
  assert.match(markup, /2026[.]10/u);
  assert.match(markup, /validated/u);
  assert.match(markup, />7</u);
  assert.match(markup, /Có thể bán/u);
  assert.match(markup, /Không bán/u);
  assert.match(markup, /Lịch sử phát hành thương mại/u);
  assert.match(markup, /2026[.]08/u);
  assert.match(markup, /release-base/u);
  assert.match(markup, /Giá theo tháng[\s\S]*N\/A/u);
  assert.match(markup, /Hạn mức lưu trữ[\s\S]*N\/A/u);
  assert.doesNotMatch(markup, /do-not-render|hidden-document|never-render/u);
});

test("plans view does not invent releases or plans when commercial data is absent", () => {
  const markup = plansMarkup({ currentRelease: null, scheduledRelease: null, drafts: [] });
  assert.match(markup, /data-admin-state="empty"/u);
  assert.match(markup, /Chưa có phiên bản/u);
  assert.doesNotMatch(markup, /99[.,]000|Gói vàng|Gold/u);
});

test("plans view exposes version actions without rendering the draft document in its listing", () => {
  const markup = plansMarkup({
    currentRelease: { id: "release-1", versionLabel: "v1", nonSellable: false },
    scheduledRelease: null,
    drafts: [{ id: "draft-1", status: "open", revision: 2, document: { secret: "not-in-list" } }],
  });
  assert.match(markup, /data-admin-plan-action="create"/u);
  assert.match(markup, /data-admin-plan-action="clone"/u);
  assert.match(markup, /data-admin-plan-action="stop-sales"/u);
  assert.match(markup, /data-admin-draft-open="draft-1"/u);
  assert.doesNotMatch(markup, /not-in-list/u);
});

test("draft editor escapes JSON and gates publish on successful validation", () => {
  const draft = {
    id: "draft-1",
    revision: 3,
    document: { offers: [{
      code: "<script>alert(1)</script>",
      tier: "gold",
      variant: "connected",
      ownerKind: "organization",
      price: { period: "yearly", currency: "VND", subtotal: 1, tax: 0, total: 1 },
      display: { name: "<img src=x onerror=alert(2)>", description: "</textarea><script>x</script>", benefits: ["<svg onload=x>"] },
    }] },
  };
  const blocked = draftEditorMarkup(draft, { errors: [{ path: "offers[0]", message: "Sai dữ liệu" }] });
  assert.match(blocked, /&lt;script&gt;alert\(1\)&lt;\/script&gt;/u);
  assert.match(blocked, /&lt;img src=x onerror=alert\(2\)&gt;/u);
  assert.match(blocked, /&lt;\/textarea&gt;&lt;script&gt;x&lt;\/script&gt;/u);
  assert.match(blocked, /&lt;svg onload=x&gt;/u);
  assert.match(blocked, /Các gói đăng ký/u);
  assert.match(blocked, /Cấu hình chính sách nâng cao/u);
  assert.doesNotMatch(blocked, /id="admin-plan-document"/u);
  assert.match(blocked, /data-admin-plan-action="publish" disabled/u);
  assert.match(blocked, /offers\[0\]/u);

  const ready = draftEditorMarkup(draft, {
    errors: [], validationDigest: "a".repeat(64), readinessExpiresAt: 9999999999,
  });
  assert.match(ready, /Kiểm tra đạt/u);
  assert.doesNotMatch(ready, /data-admin-plan-action="publish" disabled/u);

  const expired = draftEditorMarkup(draft, {
    errors: [], validationDigest: "a".repeat(64), readinessExpiresAt: 1,
  });
  assert.match(expired, /data-admin-plan-action="publish" disabled/u);
});

test("structured draft serialization updates modeled fields and preserves unknown fields", () => {
  const original = {
    schemaVersion: 7,
    rollout: { mode: "shadow", unknownRolloutKey: "keep" },
    unknownTopLevel: { keep: true },
    offers: [{
      code: "gold.connected.yearly",
      tier: "gold",
      variant: "connected",
      ownerKind: "organization",
      memberQuota: 10,
      includedProcurementQuota: 100,
      price: { period: "yearly", currency: "VND", subtotal: 1000, tax: 100, total: 1100, unknownPriceKey: "keep" },
      exportCapabilities: {
        "document.export.word": true,
        "document.export.excel": false,
        "document.export.award_result_excel": false,
      },
      violationCheckEnabled: false,
      salesState: "sellable",
      display: { name: "Vàng", description: "Cũ", badge: "hot", order: 1, recommended: false, visibility: "public", benefits: ["Cũ"] },
      unknownOfferKey: { keep: true },
    }],
  };
  const root = draftRoot({
    schemaVersion: 7,
    rollout: { mode: "shadow", unknownRolloutKey: "keep" },
    unknownTopLevel: { keep: true },
    offers: [{ code: "must-not-override" }],
  }, [{
    "display.name": field("Vàng mới"),
    "display.description": field("Mô tả mới"),
    "display.order": field("5"),
    "display.recommended": field("", true),
    "display.visibility": field("hidden"),
    "display.benefits": field("Quyền lợi 1\n\n Quyền lợi 2 "),
    "price.subtotal": field("2000"),
    "price.tax": field("200"),
    "price.total": field("2201"),
    memberQuota: field("20"),
    includedProcurementQuota: field("300"),
    violationCheckEnabled: field("", true),
    salesState: field("stopped"),
    "capability:document.export.word": field("", false),
    "capability:document.export.excel": field("", true),
    "capability:document.export.award_result_excel": field("", true),
  }]);

  const result = serializeDraftDocument(root, original);
  const offer = result.offers[0];
  assert.deepEqual(result.unknownTopLevel, { keep: true });
  assert.equal(result.rollout.unknownRolloutKey, "keep");
  assert.equal(offer.code, "gold.connected.yearly");
  assert.equal(offer.tier, "gold");
  assert.equal(offer.variant, "connected");
  assert.equal(offer.ownerKind, "organization");
  assert.equal(offer.price.period, "yearly");
  assert.equal(offer.price.currency, "VND");
  assert.equal(offer.price.unknownPriceKey, "keep");
  assert.deepEqual(offer.unknownOfferKey, { keep: true });
  assert.equal(offer.price.total, 2201, "total remains the explicitly entered authoritative candidate");
  assert.equal(offer.display.name, "Vàng mới");
  assert.equal(offer.display.description, "Mô tả mới");
  assert.equal(offer.display.order, 5);
  assert.equal(offer.display.recommended, true);
  assert.equal(offer.display.visibility, "hidden");
  assert.deepEqual(offer.display.benefits, ["Quyền lợi 1", "Quyền lợi 2"]);
  assert.equal(offer.memberQuota, 20);
  assert.equal(offer.includedProcurementQuota, 300);
  assert.equal(offer.violationCheckEnabled, true);
  assert.equal(offer.salesState, "stopped");
  assert.deepEqual(offer.exportCapabilities, {
    "document.export.word": false,
    "document.export.excel": true,
    "document.export.award_result_excel": true,
  });
});

test("structured draft serialization preserves unresolved capability mapping", () => {
  const original = {
    policies: { keep: true },
    offers: [{
      code: "legacy.internal.yearly",
      price: { period: "yearly", currency: "VND", subtotal: 1, tax: 0, total: 1 },
      memberQuota: 1,
      includedProcurementQuota: 0,
      exportCapabilities: null,
      violationCheckEnabled: false,
      salesState: "non_sellable",
      display: { name: "Legacy", benefits: [] },
    }],
  };
  const result = serializeDraftDocument(draftRoot({ policies: { keep: true } }, [{
    "display.name": field("Legacy"),
    "display.description": field(""),
    "display.order": field(""),
    "display.recommended": field("", false),
    "display.visibility": field(""),
    "display.benefits": field(""),
    "price.subtotal": field("1"),
    "price.tax": field("0"),
    "price.total": field("1"),
    memberQuota: field("1"),
    includedProcurementQuota: field("0"),
    violationCheckEnabled: field("", false),
    salesState: field("non_sellable"),
  }]), original);
  assert.equal(result.offers[0].exportCapabilities, null);
});

test("structured draft serialization rejects malformed advanced JSON and integers", () => {
  const original = { offers: [{}] };
  const badJson = draftRoot({}, []);
  badJson.querySelector = () => field("{");
  assert.throws(() => serializeDraftDocument(badJson, { offers: [] }), /JSON cấu hình nâng cao/u);

  const values = {
    "display.name": field("Tên"), "display.description": field(""), "display.order": field(""),
    "display.recommended": field("", false), "display.visibility": field(""), "display.benefits": field(""),
    "price.subtotal": field("1.5"), "price.tax": field("0"), "price.total": field("1"),
    memberQuota: field("1"), includedProcurementQuota: field("0"),
    violationCheckEnabled: field("", false), salesState: field("sellable"),
  };
  assert.throws(() => serializeDraftDocument(draftRoot({}, [values]), original), /Giá trước thuế phải là số nguyên/u);
});
