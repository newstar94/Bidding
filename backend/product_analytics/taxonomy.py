"""Code-owned low-cardinality analytics registries."""

MEANINGFUL_FEATURE_KEYS = frozenset({
    "planning.create", "planning.import_excel", "planning.update",
    "package.create", "package.update", "package.issue", "package.open",
    "package.evaluate", "package.award", "contract.create", "contract.update",
    "procurement.lookup", "procurement.fetch", "procurement.import",
    "contractor.lookup", "contractor.violation_check",
    "document.word_export", "document.excel_export", "document.award_export",
    "collaboration.member_assign", "collaboration.expert_assign",
    "ai.request", "ai.tool_call",
})

COMMERCIAL_EVENT_KEYS = frozenset({
    "pricing.viewed", "pricing.size_selected", "pricing.variant_compared",
    "pricing.offer_selected", "upgrade.prompt_shown", "upgrade.prompt_clicked",
    "quota.warning_shown", "quota.topup_clicked", "checkout.started",
    "checkout.cancelled", "subscription.cancel_intent", "downgrade.started",
})

# These stages are derived only from server/DB facts and are never accepted by
# the browser event collector.
SERVER_FUNNEL_KEYS = frozenset({
    "quote.created", "checkout.created", "payment.verified",
    "subscription.activated",
})

OWNER_KINDS = frozenset({"account", "organization"})
SIZE_BUCKETS = frozenset({"1", "2_5", "6_15", "16_50", "over_50", "unknown"})
EVENT_SOURCES = frozenset({
    "pricing_page", "commercial_storefront", "upgrade_prompt", "quota_warning",
    "checkout", "subscription_settings",
})
COST_TYPES = frozenset({
    "procurement_fetch", "ai", "document_worker", "storage", "bandwidth",
    "payment_fee", "email", "other_external_provider",
})

COMMERCIAL_FEEDBACK_MOMENTS = frozenset({
    "checkout_abandoned", "second_topup", "upgrade_completed",
    "cancel_or_downgrade_intent", "paid_day_45_60",
})
COMMERCIAL_FEEDBACK_REASONS = frozenset({
    "too_expensive", "not_needed_yet", "benefits_unclear", "payment_method",
    "need_internal_approval", "technical_issue", "missing_feature",
    "usage_too_low", "other",
})
