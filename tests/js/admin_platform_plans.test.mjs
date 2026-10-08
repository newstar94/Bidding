import assert from "node:assert/strict";
import test from "node:test";

import {
  addMonthlyOffer,
  catalogMarkup,
  draftEditorMarkup,
  plansMarkup,
  publicationStatusMessage,
  requestPlanActionInput,
  serializeDraftDocument,
} from "../../frontend/admin-platform/AdminPlans.js";

test("Admin adds a monthly candidate without inventing prices or mutating annual offers and rights", () => {
  const source = { offers: [{
    code: "gold.connected.yearly", tier: "gold", variant: "connected", ownerKind: "organization",
    price: { period: "yearly", currency: "VND", subtotal: 12000000, tax: 0, total: 12000000 },
    memberQuota: 15, includedProcurementQuota: 7000, violationCheckEnabled: true,
    exportCapabilities: { "document.export.word": true }, salesState: "sellable",
    display: { name: "Tên từ Admin", benefits: ["Quota cũ"], periodLabel: "/ năm" },
  }], policies: { baseTerm: { kind: "fixed_days", days: 365 } } };
  const before = JSON.stringify(source);
  const result = addMonthlyOffer(source, 0);
  assert.equal(JSON.stringify(source), before);
  assert.deepEqual(result.offers[0], source.offers[0]);
  const month = result.offers[1];
  assert.equal(month.code, "gold.connected.monthly");
  assert.equal(month.price.period, "monthly");
  assert.equal(month.price.total, null);
  assert.equal(month.price.tax, null);
  assert.equal(month.includedProcurementQuota, null);
  assert.equal(month.salesState, "non_sellable");
  assert.equal(month.display.periodLabel, undefined);
  assert.deepEqual(month.exportCapabilities, source.offers[0].exportCapabilities);
  assert.equal(month.memberQuota, 15);
  assert.equal(month.violationCheckEnabled, true);
  assert.deepEqual(result.policies.baseTerm, source.policies.baseTerm);
  assert.equal(result.policies.monthlyBaseTerm.kind, "blocked_decision");
  assert.throws(() => addMonthlyOffer(result, 0), /đã có cấu hình/u);
});

test("plan mutations use the shared accessible dialog and record publication automatically", async () => {
  const requests = [];
  const requestValue = async (options) => {
    requests.push(options);
    return options.label ? "  Lý do đã duyệt  " : "";
  };

  assert.equal(await requestPlanActionInput("clone", { requestValue }), true);
  assert.equal(await requestPlanActionInput("stop-sales", { requestValue }), "Lý do đã duyệt");
  assert.equal(await requestPlanActionInput("publish", { requestValue }), "Xuất bản gói dịch vụ");
  assert.equal(requests.length, 3);
  assert.equal(requests[0].label, null);
  assert.match(requests[1].message, /Quyền lợi đã áp dụng không thay đổi/u);
  assert.equal(requests[2].label, null);
});

test("adding a monthly term uses an explicitly configured monthly base without changing annual rights or quotas", () => {
  const source = { taxInvoice: { taxInclusive: true, taxBasisPoints: 0, rounding: "ceil" }, offers: [{
    code: "gold.connected.yearly", tier: "gold", variant: "connected", ownerKind: "organization",
    price: { period: "yearly", currency: "VND", subtotal: 20000, tax: 0, total: 20000, monthlyBaseAmount: 2000 },
    includedProcurementQuota: 1000, memberQuota: 15, exportCapabilities: { "document.export.word": true }, display: {},
  }] };
  const before = structuredClone(source);
  const next = addMonthlyOffer(source, 0);
  assert.deepEqual(source, before);
  assert.deepEqual(next.offers[0], before.offers[0]);
  assert.equal(next.offers[1].price.total, 2000);
  assert.equal(next.offers[1].price.monthlyBaseAmount, 2000);
  assert.equal(next.offers[1].includedProcurementQuota, null);
  assert.equal(next.offers[1].salesState, "non_sellable");
});

test("plan mutations stop cleanly when the shared dialog is cancelled", async () => {
  const requestValue = async () => null;
  assert.equal(await requestPlanActionInput("clone", { requestValue }), false);
  assert.equal(await requestPlanActionInput("stop-sales", { requestValue }), null);
  assert.equal(await requestPlanActionInput("publish", { requestValue }), null);
});

test("publication confirmation keeps the offer summary without requiring manual input", async () => {
  let options;
  const requestValue = async value => { options = value; return ""; };
  assert.equal(await requestPlanActionInput("publish", { requestValue, summary: "Cá nhân · Cơ bản · năm: 20.000 đ." }), "Xuất bản gói dịch vụ");
  assert.equal(options.label, null);
  assert.equal(options.validateValue, undefined);
  assert.equal(options.confirmLabel, "Xuất bản");
  assert.match(options.message, /Cá nhân · Cơ bản · năm: 20\.000 đ\./u);
  assert.doesNotMatch(options.message, /Lý do|ít nhất 3 ký tự/u);
});

test("publication stays disabled when the validation digest cannot satisfy the server contract", () => {
  for (const validationDigest of ["a", "a".repeat(63), "a".repeat(65)]) {
    const markup = draftEditorMarkup({ id: "draft", revision: 1, document: { offers: [] } }, {
      errors: [], validationDigest, readinessExpiresAt: 9999999999,
    });
    assert.match(markup, /data-admin-plan-action="publish" disabled/u);
  }
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

test("monthly duration entered in Admin survives serialization without changing annual policy", () => {
  const policies = {
    baseTerm: { kind: "fixed_days", days: 365 },
    monthlyBaseTerm: { kind: "blocked_decision", reason: "pending" },
    creditPackExpiry: { kind: "fixed_days", days: 90 },
  };
  const root = draftRoot({ policies }, []);
  const querySelector = root.querySelector;
  const monthlyDays = field("28");
  root.querySelector = (selector) => selector === "#admin-monthly-term-days"
    ? monthlyDays : querySelector(selector);
  const result = serializeDraftDocument(root, { offers: [], policies });
  assert.equal(result.policies.monthlyBaseTerm.kind, "fixed_days");
  assert.equal(result.policies.monthlyBaseTerm.days, 28);
  assert.deepEqual(result.policies.baseTerm, policies.baseTerm);
  assert.deepEqual(result.policies.creditPackExpiry, policies.creditPackExpiry);
  assert.equal(policies.monthlyBaseTerm.kind, "blocked_decision");
  monthlyDays.value = "";
  assert.throws(() => serializeDraftDocument(root, { offers: [] }), /phải là số nguyên/u);
});

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
    creditPacks: [{ code: "procurement.20", quantity: 20, price: 99000, internal: "must-not-render-pack" }],
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
  assert.doesNotMatch(markup, /must-not-render/u);
});

test("plans catalog keeps off and malformed authoritative states explicit", () => {
  assert.match(catalogMarkup({ availability: "off", offers: [], creditPacks: [], quotaWarnings: [] }), /Danh mục đang tắt/u);
  assert.match(catalogMarkup({ offers: [] }), /data-admin-state="error"/u);
});

function currentAdminCatalog(name = "Bản mới trong Admin") {
  return {
    releaseId: "release-current-shadow", releaseChecksum: "current-checksum",
    currency: "VND", creditPacks: [], quotaWarnings: [70, 90, 100],
    offers: [{
      code: "gold.internal.yearly", tier: "gold", variant: "internal", ownerKind: "organization",
      memberQuota: 10, includedProcurementQuota: 0,
      price: { period: "yearly", currency: "VND", subtotal: 20000, tax: 0, total: 20000 },
      exportCapabilities: { "document.export.word": true }, violationCheckEnabled: false,
      salesState: "stopped", display: { name, visibility: "hidden", benefits: ["Quyền lợi của bản mới"] },
    }],
  };
}

test("Admin shows all current published offers independently of unavailable off or stale public pricing", () => {
  const currentCatalog = currentAdminCatalog();
  const staleCatalog = currentAdminCatalog("Bảng giá công khai cũ");
  staleCatalog.releaseId = "release-public-old";
  staleCatalog.offers[0].price.total = 999999;
  for (const options of [
    { catalog: { availability: "off", offers: [], creditPacks: [], quotaWarnings: [] } },
    { catalog: staleCatalog },
    { catalogError: { status: 503, code: "COMMERCIAL_POLICY_DECISION_REQUIRED", message: "Chưa có release công khai." } },
  ]) {
    const markup = plansMarkup({
      currentRelease: { id: currentCatalog.releaseId, mode: "shadow", scopeKey: "global", nonSellable: false },
      currentCatalog, drafts: [],
    }, options);
    assert.match(markup, /Bản mới trong Admin/u);
    assert.match(markup, /20[.]000/u);
    assert.match(markup, /Quyền lợi của bản mới/u);
    assert.match(markup, /Đã dừng bán/u);
    assert.match(markup, /Không hiện trên bảng giá/u);
    assert.match(markup, /data-admin-package-edit-code="gold[.]internal[.]yearly"/u);
    assert.doesNotMatch(markup, /Bảng giá công khai cũ|999[.]999/u);
  }
});

test("Admin uses public pricing only for older overview responses without currentCatalog", () => {
  const catalog = currentAdminCatalog("Danh mục từ máy chủ cũ");
  assert.match(plansMarkup({ drafts: [] }, { catalog }), /Danh mục từ máy chủ cũ/u);
  const explicitAbsent = plansMarkup({ currentRelease: null, currentCatalog: null, drafts: [] }, { catalog });
  assert.doesNotMatch(explicitAbsent, /Danh mục từ máy chủ cũ/u);
  assert.match(explicitAbsent, /data-admin-state="empty"/u);
});

test("direct public transition is offered only for the current internal release and keeps its source id", () => {
  const currentCatalog = currentAdminCatalog();
  const shadowRelease = { id: "release-current-shadow", mode: "shadow", nonSellable: false };
  const markup = plansMarkup({ currentRelease: shadowRelease, currentCatalog, drafts: [] });
  const buttons = markup.match(/<button\b[^>]*data-admin-plan-action="make-public"[^>]*>[\s\S]*?<\/button>/gu);
  assert.ok(buttons?.length, "the current internal release needs a direct public action");
  for (const button of buttons) {
    assert.match(button, /Chuyển sang Công khai/u);
    assert.match(button, /data-release-id="release-current-shadow"/u);
  }
  for (const currentRelease of [null, { ...shadowRelease, mode: "production" }, { ...shadowRelease, mode: "pilot" }, { ...shadowRelease, nonSellable: true }]) {
    const otherMode = plansMarkup({
      currentRelease, currentCatalog, drafts: [],
      scheduledRelease: { id: "scheduled-shadow", mode: "shadow", nonSellable: false },
      releaseHistory: [shadowRelease],
    });
    assert.doesNotMatch(otherMode, /data-admin-plan-action="make-public"/u);
  }
});

test("publication status distinguishes internal scheduled and verified public releases", () => {
  const publicCatalog = currentAdminCatalog("Gói đang công khai");
  publicCatalog.releaseId = "public-current";
  publicCatalog.offers[0].salesState = "sellable";
  publicCatalog.offers[0].display.visibility = "public";
  const shadow = publicationStatusMessage({ id: "new-shadow", mode: "shadow", effectiveFrom: 1 });
  assert.match(shadow, /^Đã xuất bản bản nháp\./u);
  assert.match(shadow, /Thử nội bộ[\s\S]*chọn Công khai/u);
  assert.doesNotMatch(shadow, /Bảng giá đã hiển thị/u);
  for (const mode of ["pilot", "production"]) {
    const unconfirmed = publicationStatusMessage({ id: "new-release", mode, effectiveFrom: 1 }, {
      catalog: { ...publicCatalog, releaseId: "stale-public-release" },
    });
    assert.match(unconfirmed, /Chưa xác nhận bảng giá mới trên trang chủ/u);
    assert.doesNotMatch(unconfirmed, /Bảng giá đã hiển thị/u);
  }
  const visible = publicationStatusMessage({ id: "public-current", mode: "production", effectiveFrom: 1 }, {
    catalog: publicCatalog,
  });
  assert.match(visible, /Bảng giá đã hiển thị trên trang chủ/u);
  const visibleShadow = publicationStatusMessage({ id: "public-current", mode: "shadow", effectiveFrom: 1 }, {
    catalog: publicCatalog,
  });
  assert.match(visibleShadow, /Bảng giá đã hiển thị trên trang chủ/u);
  const emptyPublic = publicationStatusMessage({ id: "public-current", mode: "production", effectiveFrom: 1 }, {
    catalog: { ...publicCatalog, offers: [] },
  });
  assert.match(emptyPublic, /Chưa xác nhận bảng giá mới trên trang chủ/u);
  assert.doesNotMatch(emptyPublic, /Bảng giá đã hiển thị/u);
  const scheduled = publicationStatusMessage({ id: "public-future", mode: "production", effectiveFrom: Math.floor(Date.now() / 1000) + 3600 }, {
    catalog: { ...publicCatalog, releaseId: "public-future" },
  });
  assert.match(scheduled, /được lên lịch/u);
  assert.doesNotMatch(scheduled, /Bảng giá đã hiển thị/u);
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
  assert.match(markup, /Chưa dừng bán/u);
  assert.match(markup, /Không bán/u);
  assert.match(markup, /Lịch sử phát hành thương mại/u);
  assert.match(markup, /2026[.]08/u);
  assert.match(markup, /release-base/u);
  assert.match(markup, /bf-admin-workflow-guide/u);
  assert.match(markup, /Bản nháp & mở bán/u);
  assert.match(markup, /Khả năng cấu hình gói hiện hành/u);
  assert.match(markup, /Giá theo tháng<\/th><td><span[^>]*>Được hỗ trợ<\/span>/u);
  assert.match(markup, /Hạn mức lưu trữ[\s\S]*N\/A/u);
  assert.doesNotMatch(markup, /do-not-render|hidden-document|never-render/u);
});

test("plans view does not invent releases or plans when commercial data is absent", () => {
  const markup = plansMarkup({ currentRelease: null, scheduledRelease: null, drafts: [] });
  assert.match(markup, /data-admin-state="empty"/u);
  assert.match(markup, /Chưa có bảng giá đang mở bán/u);
  assert.doesNotMatch(markup, /99[.,]000|Gói vàng|Gold/u);
});

test("first startup opens the seeded samples directly without requesting another draft", () => {
  const markup = plansMarkup({ drafts: [{ id: "commercial-draft-initial-v1", status: "draft", revision: 1 }] });
  assert.match(markup, /Bộ gói mẫu đã được khởi tạo/u);
  assert.match(markup, /data-admin-draft-open="commercial-draft-initial-v1">Chỉnh sửa 8 gói mẫu/u);
});

test("complete sample action is available without an initial release and when a release has no public catalog", () => {
  for (const currentRelease of [null, { id: "release-existing", nonSellable: false }]) {
    const markup = plansMarkup({ currentRelease, scheduledRelease: null, drafts: [] });
    assert.match(markup, /data-admin-plan-action="create-template"/u);
    assert.match(markup, /bộ mẫu Cơ bản \/ Nâng cao có cấu hình/u);
    assert.match(markup, /chỉnh sửa, kiểm tra rồi phát hành/u);
  }
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

test("plans view exposes the three management tabs with associated panels", () => {
  const markup = plansMarkup({
    currentRelease: { id: "release-1", versionLabel: "v1", nonSellable: false },
    scheduledRelease: null,
    drafts: [],
    releaseHistory: [],
  });
  assert.match(markup, /bf-admin-plan-tabs/u);
  assert.match(markup, /Danh sách gói/u);
  assert.match(markup, /Bản nháp & mở bán/u);
  assert.match(markup, /Khả năng cấu hình gói hiện hành/u);
  assert.match(markup, /Lịch sử/u);
  for (const key of ["catalog", "releases", "history"]) {
    assert.ok(markup.includes(`aria-controls="admin-plans-panel-${key}"`));
    assert.ok(markup.includes(`aria-labelledby="admin-plans-tab-${key}"`));
  }
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
  assert.match(blocked, /bf-admin-editor-group[\s\S]*1[.] Thông tin gói[\s\S]*2[.] Giá &amp; kỳ hạn[\s\S]*3[.] Hạn mức &amp; tính năng[\s\S]*4[.] Trình bày/u);
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

test("draft publication mode is prominent and a public choice preserves the rest of rollout policy", () => {
  const document = {
    offers: [], rollout: { mode: "shadow", cohorts: ["existing-cohort"], unknownRolloutKey: "keep" },
  };
  const markup = draftEditorMarkup({ id: "draft-mode", revision: 3, document }, {
    errors: [], warnings: [{ code: "SHADOW_ONLY" }], validationDigest: "a".repeat(64), readinessExpiresAt: 9999999999,
  });
  assert.match(markup, /Chế độ phát hành/u);
  assert.match(markup, /Thử nội bộ/u);
  assert.match(markup, /Công khai · Mở bán chính thức/u);
  assert.match(markup, /data-admin-rollout-warning[\s\S]*Kiểm tra đạt cho Thử nội bộ/u);
  assert.match(markup, /data-admin-validation-target="rollout"/u);
  assert.equal((markup.match(/data-admin-commercial-config="rollout[.]mode"/gu) || []).length, 1);
  assert.ok(markup.indexOf('data-admin-commercial-config="rollout.mode"') < markup.indexOf('data-admin-package-list'));
  const mode = { ...field("production"), dataset: {
    adminCommercialConfig: "rollout.mode", adminConfigKind: "text", adminConfigOriginal: "shadow",
  } };
  const root = draftRoot(document, []);
  const baseQueryAll = root.querySelectorAll;
  root.querySelectorAll = selector => selector === "[data-admin-commercial-config]" ? [mode] : baseQueryAll(selector);
  const serialized = serializeDraftDocument(root, document);
  assert.equal(serialized.rollout.mode, "production");
  assert.deepEqual(serialized.rollout.cohorts, ["existing-cohort"]);
  assert.equal(serialized.rollout.unknownRolloutKey, "keep");
  assert.equal(document.rollout.mode, "shadow");
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

test("creator serialization retains existing offers and separately edited policy fields", () => {
  const original = { offers: [{ code: "gold.internal.yearly", unknown: { keep: true }, exportCapabilities: null }] };
  const root = draftRoot({ policies: { baseTerm: { kind: "fixed_days", days: 365 } }, extra: { keep: true } }, []);
  const baseQuery = root.querySelector;
  root.querySelector = selector => selector === "[data-admin-package-creator]" ? {} : baseQuery(selector);
  const result = serializeDraftDocument(root, original);
  assert.deepEqual(result.offers, original.offers);
  assert.notEqual(result.offers, original.offers);
  assert.deepEqual(result.extra, { keep: true });
  assert.equal(result.policies.baseTerm.days, 365);
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
