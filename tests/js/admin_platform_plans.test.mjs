import assert from "node:assert/strict";
import test from "node:test";

import { catalogMarkup, draftEditorMarkup, plansMarkup } from "../../frontend/admin-platform/AdminPlans.js";

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
  });
  assert.match(markup, /2026[.]09/u);
  assert.match(markup, /2026[.]10/u);
  assert.match(markup, /validated/u);
  assert.match(markup, />7</u);
  assert.match(markup, /Có thể bán/u);
  assert.match(markup, /Không bán/u);
  assert.doesNotMatch(markup, /do-not-render|hidden-document/u);
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
    document: { offers: [{ code: "<script>alert(1)</script>" }] },
  };
  const blocked = draftEditorMarkup(draft, { errors: [{ path: "offers[0]", message: "Sai dữ liệu" }] });
  assert.match(blocked, /&lt;script&gt;alert\(1\)&lt;\/script&gt;/u);
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
