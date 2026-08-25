"""Closed-schema commercial document, validation and deterministic simulation."""

from __future__ import annotations

from copy import deepcopy
from hashlib import sha256
import json


POLICY_SCHEMA_VERSION = 1
MAX_DOCUMENT_BYTES = 262_144
MAX_DEPTH = 12
MAX_OFFERS = 16
MAX_CREDIT_PACKS = 32
SUPPORTED_TIERS = ("personal", "silver", "gold", "diamond")
SUPPORTED_VARIANTS = ("internal", "connected")
SUPPORTED_EXPORT_CAPABILITIES = (
    "document.export.word",
    "document.export.excel",
    "document.export.award_result_excel",
)
SUPPORTED_POLICY_KINDS = frozenset({
    "blocked_decision",
    "calendar_anniversary",
    "fixed_days",
    "start_new_term",
    "end_of_term",
    "manual_review",
    "reject_all",
    "process_affordable_in_stable_order",
    "fefo",
    "no_carry_over",
    "manual_off_platform",
})


def canonical_json(value) -> str:
    return json.dumps(
        value,
        ensure_ascii=False,
        sort_keys=True,
        separators=(",", ":"),
        allow_nan=False,
    )


def checksum_document(value) -> str:
    return sha256(canonical_json(value).encode("utf-8")).hexdigest()


def _depth(value, current=0):
    if isinstance(value, dict):
        return max([current] + [_depth(item, current + 1) for item in value.values()])
    if isinstance(value, list):
        return max([current] + [_depth(item, current + 1) for item in value])
    return current


def _export_capabilities(mapping):
    if mapping is None:
        return None
    return {
        capability: bool(mapping.get(capability, False))
        for capability in SUPPORTED_EXPORT_CAPABILITIES
    }


def build_initial_draft_document(legacy_capabilities_by_tier=None):
    """Return the approved initial values as a non-effective draft.

    Personal export entitlements remain an explicit decision when no legacy
    one-to-one mapping exists.  This prevents a seed/test from inventing new
    export behaviour while still allowing the whole document to be previewed.
    """

    legacy_capabilities_by_tier = legacy_capabilities_by_tier or {}
    prices = {
        "personal": {"internal": 2_490_000, "connected": 3_990_000},
        "silver": {"internal": 12_000_000, "connected": 15_000_000},
        "gold": {"internal": 28_000_000, "connected": 35_000_000},
        "diamond": {"internal": 60_000_000, "connected": 75_000_000},
    }
    members = {"personal": 1, "silver": 5, "gold": 15, "diamond": 50}
    connected_quota = {
        "personal": 1_000,
        "silver": 3_000,
        "gold": 7_000,
        "diamond": 15_000,
    }
    offers = []
    for tier in SUPPORTED_TIERS:
        mapped_exports = _export_capabilities(
            legacy_capabilities_by_tier.get(tier)
        )
        for variant in SUPPORTED_VARIANTS:
            offers.append({
                "code": f"{tier}.{variant}.yearly",
                "tier": tier,
                "variant": variant,
                "ownerKind": "account" if tier == "personal" else "organization",
                "memberQuota": members[tier],
                "includedProcurementQuota": (
                    connected_quota[tier] if variant == "connected" else 0
                ),
                "price": {
                    "period": "yearly",
                    "currency": "VND",
                    "subtotal": prices[tier][variant],
                    "tax": 0,
                    "total": prices[tier][variant],
                },
                "exportCapabilities": deepcopy(mapped_exports),
                "violationCheckEnabled": variant == "connected",
                "salesState": "sellable",
                "display": {
                    "name": {
                        "personal": "Cá nhân",
                        "silver": "Bạc",
                        "gold": "Vàng",
                        "diamond": "Kim Cương",
                    }[tier],
                    "recommended": variant == "connected",
                },
            })
    return {
        "schemaVersion": POLICY_SCHEMA_VERSION,
        "currency": "VND",
        "timezone": "Asia/Ho_Chi_Minh",
        "rollout": {"mode": "shadow", "cohorts": []},
        "offers": offers,
        "creditPacks": [
            {"code": "procurement.20", "quantity": 20, "price": 99_000},
            {"code": "procurement.100", "quantity": 100, "price": 399_000},
            {"code": "procurement.500", "quantity": 500, "price": 1_490_000},
            {"code": "procurement.2000", "quantity": 2_000, "price": 4_490_000},
        ],
        "policies": {
            "baseTerm": {
                "kind": "blocked_decision",
                "reason": "Chưa chốt kỳ năm theo 365 ngày hay mốc kỷ niệm lịch.",
            },
            "renewalAnchor": {
                "kind": "blocked_decision",
                "reason": "Chưa chốt renewal anchor và thời điểm cấp quota kỳ mới.",
            },
            "upgrade": {"kind": "start_new_term", "activeTerm": "manual_review"},
            "downgrade": {"kind": "manual_review", "selfService": False},
            "graceDays": 0,
            "latePayment": {"kind": "manual_review"},
            "refund": {"kind": "manual_off_platform", "partial": True},
            "organizationPurchaseAuthority": ["super_admin"],
            "quotaConsumption": {"kind": "fefo"},
            "quotaCarryOver": {"kind": "no_carry_over"},
            "creditPackExpiry": {"kind": "fixed_days", "days": 365},
            "partialBatch": {
                "kind": "blocked_decision",
                "reason": "Chưa chốt hành vi khi quota chỉ đủ một phần batch.",
            },
            "connectedAdvantageBasisPoints": 2_000,
            "quotaWarningPercentages": [70, 90, 100],
        },
        "providerProfiles": [
            {
                "alias": "Fake local deterministic",
                "provider": "fake",
                "environment": "test",
                "mode": "shadow",
                "readiness": "ready",
                "credentialReference": None,
                "minAmount": 1,
                "maxAmount": 100_000_000,
                "checkoutTtlSeconds": 900,
            },
            {
                "alias": "payOS",
                "provider": "payos",
                "environment": "production",
                "mode": "shadow",
                "readiness": "blocked_external",
                "credentialReference": None,
                "minAmount": 1,
                "maxAmount": 100_000_000,
                "checkoutTtlSeconds": 900,
            },
        ],
        "taxInvoice": {
            "approvalReference": None,
            "taxInclusive": None,
            "taxBasisPoints": None,
            "rounding": None,
            "invoiceTrigger": None,
        },
        "externalReadiness": {
            "vatInvoice": None,
            "payosMerchant": None,
            "credentialWebhook": None,
            "ecommercePrivacy": None,
            "termsRefund": None,
        },
    }


def _minimum_pack_cost(target, packs):
    maximum = max(pack["quantity"] for pack in packs)
    unreachable = 10**30
    costs = [unreachable] * (target + maximum + 1)
    costs[0] = 0
    for quantity in range(len(costs)):
        if costs[quantity] == unreachable:
            continue
        for pack in packs:
            following = min(len(costs) - 1, quantity + pack["quantity"])
            costs[following] = min(costs[following], costs[quantity] + pack["price"])
    return min(costs[target:])


def connected_savings(document):
    packs = list(document.get("creditPacks") or [])
    by_tier_variant = {
        (offer.get("tier"), offer.get("variant")): offer
        for offer in document.get("offers") or []
    }
    result = []
    if not packs:
        return result
    for tier in SUPPORTED_TIERS:
        internal = by_tier_variant.get((tier, "internal"))
        connected = by_tier_variant.get((tier, "connected"))
        if not internal or not connected:
            continue
        quota = int(connected.get("includedProcurementQuota") or 0)
        equivalent = int(internal["price"]["total"]) + _minimum_pack_cost(quota, packs)
        connected_total = int(connected["price"]["total"])
        saving = equivalent - connected_total
        basis_points = (
            (saving * 10_000 + equivalent // 2) // equivalent
            if equivalent
            else 0
        )
        result.append({
            "tier": tier,
            "internalPlusCredits": equivalent,
            "connected": connected_total,
            "saving": saving,
            "savingBasisPoints": basis_points,
        })
    return result


def _error(code, path, message):
    return {"code": code, "path": path, "message": message}


def validate_document(document, *, require_production_ready=False):
    """Validate a draft and return deterministic errors, warnings and impact."""

    errors = []
    warnings = []
    try:
        encoded = canonical_json(document).encode("utf-8")
    except (TypeError, ValueError) as exc:
        return {"errors": [_error("INVALID_JSON", "$", str(exc))], "warnings": [], "impact": {}}
    if len(encoded) > MAX_DOCUMENT_BYTES:
        errors.append(_error("DOCUMENT_TOO_LARGE", "$", "Cấu hình vượt giới hạn 256 KiB."))
    if _depth(document) > MAX_DEPTH:
        errors.append(_error("DOCUMENT_TOO_DEEP", "$", "Cấu hình vượt độ sâu cho phép."))
    if document.get("schemaVersion") != POLICY_SCHEMA_VERSION:
        errors.append(_error("UNSUPPORTED_SCHEMA", "schemaVersion", "Phiên bản schema không được hỗ trợ."))
    if document.get("currency") != "VND":
        errors.append(_error("CURRENCY_INVALID", "currency", "MVP chỉ hỗ trợ VND."))
    if document.get("timezone") != "Asia/Ho_Chi_Minh":
        errors.append(_error("TIMEZONE_INVALID", "timezone", "Múi giờ phải là Asia/Ho_Chi_Minh."))

    offers = document.get("offers")
    if not isinstance(offers, list) or len(offers) > MAX_OFFERS:
        errors.append(_error("OFFERS_INVALID", "offers", "Danh sách offer không hợp lệ."))
        offers = []
    codes = set()
    pairs = set()
    for index, offer in enumerate(offers):
        path = f"offers[{index}]"
        code = str(offer.get("code") or "").strip()
        pair = (offer.get("tier"), offer.get("variant"))
        if not code or code in codes:
            errors.append(_error("DUPLICATE_OFFER", f"{path}.code", "Mã offer trống hoặc bị trùng."))
        codes.add(code)
        if pair in pairs or pair[0] not in SUPPORTED_TIERS or pair[1] not in SUPPORTED_VARIANTS:
            errors.append(_error("OFFER_PAIR_INVALID", path, "Cặp quy mô/biến thể không hợp lệ hoặc bị trùng."))
        pairs.add(pair)
        for field in ("memberQuota", "includedProcurementQuota"):
            value = offer.get(field)
            if not isinstance(value, int) or isinstance(value, bool) or value < (1 if field == "memberQuota" else 0):
                errors.append(_error("INTEGER_REQUIRED", f"{path}.{field}", "Giá trị phải là số nguyên hợp lệ."))
        price = offer.get("price") or {}
        amounts = [price.get("subtotal"), price.get("tax"), price.get("total")]
        if any(not isinstance(value, int) or isinstance(value, bool) or value < 0 for value in amounts):
            errors.append(_error("MONEY_INTEGER_REQUIRED", f"{path}.price", "Tiền VND phải là số nguyên không âm."))
        elif price.get("total") != price.get("subtotal") + price.get("tax"):
            errors.append(_error("PRICE_TOTAL_MISMATCH", f"{path}.price", "Tổng tiền không khớp thành tiền và thuế."))
        capabilities = offer.get("exportCapabilities")
        if capabilities is None:
            errors.append(_error("BLOCKED_DECISION", f"{path}.exportCapabilities", "Chưa có mapping entitlement xuất đã được phê duyệt."))
        elif set(capabilities) != set(SUPPORTED_EXPORT_CAPABILITIES) or any(type(value) is not bool for value in capabilities.values()):
            errors.append(_error("CAPABILITY_INVALID", f"{path}.exportCapabilities", "Chỉ capability xuất hiện hữu trong allowlist được phép."))
    expected_pairs = {(tier, variant) for tier in SUPPORTED_TIERS for variant in SUPPORTED_VARIANTS}
    if pairs != expected_pairs:
        errors.append(_error("OFFER_MATRIX_INCOMPLETE", "offers", "Cấu hình bán năm phải có đủ 4 quy mô x 2 biến thể."))

    packs = document.get("creditPacks")
    if not isinstance(packs, list) or not packs or len(packs) > MAX_CREDIT_PACKS:
        errors.append(_error("CREDIT_PACKS_INVALID", "creditPacks", "Danh sách gói lượt không hợp lệ."))
        packs = []
    pack_codes = set()
    for index, pack in enumerate(packs):
        code = str(pack.get("code") or "").strip()
        if not code or code in pack_codes:
            errors.append(_error("DUPLICATE_SKU", f"creditPacks[{index}].code", "SKU lượt bị trùng."))
        pack_codes.add(code)
        for field in ("quantity", "price"):
            value = pack.get(field)
            if not isinstance(value, int) or isinstance(value, bool) or value <= 0:
                errors.append(_error("INTEGER_REQUIRED", f"creditPacks[{index}].{field}", "Giá trị phải là số nguyên dương."))

    policies = document.get("policies") or {}
    for name, policy in policies.items():
        if isinstance(policy, dict) and "kind" in policy:
            if policy.get("kind") not in SUPPORTED_POLICY_KINDS:
                errors.append(_error("UNKNOWN_POLICY_KIND", f"policies.{name}.kind", "Policy kind không nằm trong allowlist."))
            if policy.get("kind") == "blocked_decision":
                errors.append(_error("BLOCKED_DECISION", f"policies.{name}", str(policy.get("reason") or "Cần quyết định nghiệp vụ.")))
    base_term = policies.get("baseTerm") or {}
    if base_term.get("kind") == "fixed_days" and (
        not isinstance(base_term.get("days"), int)
        or isinstance(base_term.get("days"), bool)
        or not 1 <= base_term["days"] <= 3660
    ):
        errors.append(_error("BASE_TERM_INVALID", "policies.baseTerm.days", "Kỳ fixed-days cần số ngày nguyên dương."))
    if base_term.get("kind") == "calendar_anniversary":
        errors.append(_error("BLOCKED_DECISION", "policies.baseTerm", "Calendar anniversary cần chốt 29/02 và boundary trước khi publish."))
    credit_expiry = policies.get("creditPackExpiry") or {}
    if credit_expiry.get("kind") != "fixed_days" or (
        not isinstance(credit_expiry.get("days"), int)
        or isinstance(credit_expiry.get("days"), bool)
        or not 1 <= credit_expiry["days"] <= 3660
    ):
        errors.append(_error("CREDIT_EXPIRY_INVALID", "policies.creditPackExpiry", "Hạn credit pack cần fixed-days hợp lệ."))
    authorities = policies.get("organizationPurchaseAuthority")
    if (
        not isinstance(authorities, list)
        or not authorities
        or "super_admin" not in authorities
        or set(authorities) - {"super_admin", "manager"}
    ):
        errors.append(_error("PURCHASE_AUTHORITY_INVALID", "policies.organizationPurchaseAuthority", "Thẩm quyền mua chỉ hỗ trợ Super Admin và manager hiện hành."))
    grace_days = policies.get("graceDays")
    if not isinstance(grace_days, int) or isinstance(grace_days, bool) or not 0 <= grace_days <= 365:
        errors.append(_error("GRACE_INVALID", "policies.graceDays", "Grace period phải là số ngày nguyên không âm."))
    threshold = policies.get("connectedAdvantageBasisPoints")
    if not isinstance(threshold, int) or isinstance(threshold, bool) or not 0 <= threshold <= 10_000:
        errors.append(_error("THRESHOLD_INVALID", "policies.connectedAdvantageBasisPoints", "Ngưỡng lợi ích phải dùng integer basis points."))
        threshold = 0
    savings = []
    if packs and offers and not any(error["code"] == "MONEY_INTEGER_REQUIRED" for error in errors):
        savings = connected_savings(document)
        for item in savings:
            if item["savingBasisPoints"] < threshold:
                errors.append(_error("CONNECTED_ADVANTAGE_TOO_LOW", f"offers.{item['tier']}", "Lợi ích Kết nối thấp hơn ngưỡng đã cấu hình."))

    rollout_mode = (document.get("rollout") or {}).get("mode")
    if rollout_mode not in {"shadow", "pilot", "production"}:
        errors.append(_error("ROLLOUT_MODE_INVALID", "rollout.mode", "Chế độ rollout không hợp lệ."))
    if rollout_mode in {"pilot", "production"} or require_production_ready:
        readiness = document.get("externalReadiness") or {}
        missing = [key for key, value in readiness.items() if not value]
        if missing:
            errors.append(_error("BLOCKED_EXTERNAL", "externalReadiness", "Thiếu phê duyệt/reference: " + ", ".join(sorted(missing))))
        tax = document.get("taxInvoice") or {}
        if any(tax.get(key) is None for key in ("approvalReference", "taxInclusive", "taxBasisPoints", "rounding", "invoiceTrigger")):
            errors.append(_error("BLOCKED_EXTERNAL", "taxInvoice", "Chưa đủ quyết định thuế và hóa đơn."))
        healthy = [
            profile for profile in document.get("providerProfiles") or []
            if profile.get("provider") != "fake"
            and profile.get("mode") == "live"
            and profile.get("readiness") == "ready"
            and profile.get("credentialReference")
        ]
        if not healthy:
            errors.append(_error("NO_HEALTHY_PROVIDER", "providerProfiles", "Chưa có provider live sẵn sàng."))
    else:
        warnings.append(_error("SHADOW_ONLY", "rollout.mode", "Cấu hình chỉ sẵn sàng cho fake/local/shadow."))

    return {
        "errors": errors,
        "warnings": warnings,
        "impact": {
            "offerCount": len(offers),
            "creditPackCount": len(packs),
            "connectedSavings": savings,
            "rolloutMode": rollout_mode,
        },
    }
