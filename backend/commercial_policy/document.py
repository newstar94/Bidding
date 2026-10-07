"""Closed-schema commercial document, validation and deterministic simulation."""

from __future__ import annotations

from copy import deepcopy
from hashlib import sha256
import json

from .tax import (
    SUPPORTED_INVOICE_TRIGGERS,
    SUPPORTED_TAX_ROUNDING,
    calculate_tax_price,
    tax_arithmetic_configured,
)


POLICY_SCHEMA_VERSION = 1
MAX_DOCUMENT_BYTES = 262_144
MAX_DEPTH = 12
MAX_OFFERS = 16
MAX_CREDIT_PACKS = 32
MAX_CREDIT_UNITS = 100_000
SUPPORTED_TIERS = ("personal", "silver", "gold", "diamond")
SUPPORTED_VARIANTS = ("internal", "connected")
SUPPORTED_OWNER_KINDS = ("account", "organization")
SUPPORTED_SALES_STATES = ("sellable", "stopped", "non_sellable")
SUPPORTED_PRICE_PERIODS = ("yearly", "monthly")
SUPPORTED_PUBLIC_VISIBILITY = ("public", "hidden")
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

    Personal exports and term/batch defaults were approved in ADR 0071.
    Organization exports still come from the actual legacy package mapping;
    a missing mapping remains a validation blocker, never an inferred right.
    """

    legacy_capabilities_by_tier = {
        "personal": {capability: True for capability in SUPPORTED_EXPORT_CAPABILITIES},
        **(legacy_capabilities_by_tier or {}),
    }
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
                    "description": (
                        "Quản lý công việc và dữ liệu nội bộ."
                        if variant == "internal"
                        else "Quản lý công việc và kết nối dữ liệu Mua Sắm Công."
                    ),
                    "badge": "Đề xuất" if variant == "connected" else "",
                    "variantLabel": "Cơ bản" if variant == "internal" else "Nâng cao",
                    "periodLabel": "Hàng năm",
                    "order": SUPPORTED_TIERS.index(tier),
                    "visibility": "public",
                    "benefits": [],
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
            "baseTerm": {"kind": "fixed_days", "days": 365},
            "renewalAnchor": {"kind": "end_of_term"},
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
                "kind": "process_affordable_in_stable_order",
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
            "taxInclusive": True,
            "invoiceEnabled": False,
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
    packs = [
        {**pack, "price": calculate_tax_price(pack["price"], document.get("taxInvoice") or {})["total"]}
        for pack in document.get("creditPacks") or []
    ]
    by_tier_variant = {
        (offer.get("tier"), offer.get("variant"), offer.get("price", {}).get("period")): offer
        for offer in document.get("offers") or []
    }
    result = []
    if not packs:
        return result
    for tier, period in (
        (tier, period) for period in SUPPORTED_PRICE_PERIODS for tier in SUPPORTED_TIERS
    ):
        internal = by_tier_variant.get((tier, "internal", period))
        connected = by_tier_variant.get((tier, "connected", period))
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
            "period": period,
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
    if not isinstance(document, dict):
        return {
            "errors": [_error("DOCUMENT_OBJECT_REQUIRED", "$", "Cấu hình thương mại phải là một object.")],
            "warnings": [],
            "impact": {},
        }
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
        if not isinstance(offer, dict):
            errors.append(_error("OFFER_OBJECT_REQUIRED", path, "Mỗi offer phải là một object."))
            continue
        code = str(offer.get("code") or "").strip()
        pair = (offer.get("tier"), offer.get("variant"), (offer.get("price") or {}).get("period") if isinstance(offer.get("price"), dict) else None)
        if not code or code in codes:
            errors.append(_error("DUPLICATE_OFFER", f"{path}.code", "Mã offer trống hoặc bị trùng."))
        codes.add(code)
        if pair in pairs or pair[0] not in SUPPORTED_TIERS or pair[1] not in SUPPORTED_VARIANTS:
            errors.append(_error("OFFER_PAIR_INVALID", path, "Bộ quy mô/biến thể/chu kỳ không hợp lệ hoặc bị trùng."))
        pairs.add(pair)
        if offer.get("ownerKind") not in SUPPORTED_OWNER_KINDS:
            errors.append(_error("OWNER_KIND_INVALID", f"{path}.ownerKind", "Đối tượng sở hữu offer không hợp lệ."))
        if offer.get("salesState") not in SUPPORTED_SALES_STATES:
            errors.append(_error("SALES_STATE_INVALID", f"{path}.salesState", "Trạng thái bán offer không hợp lệ."))
        if type(offer.get("violationCheckEnabled")) is not bool:
            errors.append(_error("VIOLATION_CHECK_INVALID", f"{path}.violationCheckEnabled", "Cờ kiểm tra vi phạm phải là boolean."))
        for field in ("memberQuota", "includedProcurementQuota"):
            value = offer.get(field)
            if not isinstance(value, int) or isinstance(value, bool) or value < (1 if field == "memberQuota" else 0):
                errors.append(_error("INTEGER_REQUIRED", f"{path}.{field}", "Giá trị phải là số nguyên hợp lệ."))
            elif value > MAX_CREDIT_UNITS:
                errors.append(_error("VALUE_TOO_LARGE", f"{path}.{field}", "Giá trị vượt giới hạn xử lý an toàn."))
        price = offer.get("price")
        if not isinstance(price, dict):
            errors.append(_error("PRICE_OBJECT_REQUIRED", f"{path}.price", "Giá offer phải là một object."))
            price = {}
        if price.get("period") not in SUPPORTED_PRICE_PERIODS:
            errors.append(_error("PRICE_PERIOD_INVALID", f"{path}.price.period", "Chu kỳ giá offer không hợp lệ."))
        if price.get("currency") != "VND":
            errors.append(_error("PRICE_CURRENCY_INVALID", f"{path}.price.currency", "Đơn vị tiền offer phải là VND."))
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
        display = offer.get("display")
        if not isinstance(display, dict):
            errors.append(_error("DISPLAY_OBJECT_REQUIRED", f"{path}.display", "Metadata hiển thị phải là một object."))
            display = {}
        for field in ("name", "description", "badge", "variantLabel", "periodLabel"):
            value = display.get(field)
            required = field == "name"
            if required and (not isinstance(value, str) or not value.strip()):
                errors.append(_error("DISPLAY_TEXT_INVALID", f"{path}.display.{field}", "Tên hiển thị phải là chuỗi không rỗng."))
            elif value is not None and not isinstance(value, str):
                errors.append(_error("DISPLAY_TEXT_INVALID", f"{path}.display.{field}", "Metadata hiển thị phải là chuỗi."))
        order = display.get("order")
        if order is not None and (
            not isinstance(order, int) or isinstance(order, bool) or order < 0
        ):
            errors.append(_error("DISPLAY_ORDER_INVALID", f"{path}.display.order", "Thứ tự hiển thị phải là số nguyên không âm."))
        recommended = display.get("recommended")
        if recommended is not None and type(recommended) is not bool:
            errors.append(_error("DISPLAY_BOOLEAN_INVALID", f"{path}.display.recommended", "Cờ đề xuất phải là boolean."))
        visibility = display.get("visibility")
        if visibility is not None and visibility not in SUPPORTED_PUBLIC_VISIBILITY:
            errors.append(_error("DISPLAY_VISIBILITY_INVALID", f"{path}.display.visibility", "Mức hiển thị public không hợp lệ."))
        benefits = display.get("benefits")
        if benefits is not None and (
            not isinstance(benefits, list)
            or any(not isinstance(value, str) or not value.strip() for value in benefits)
        ):
            errors.append(_error("DISPLAY_BENEFITS_INVALID", f"{path}.display.benefits", "Danh sách lợi ích phải gồm các chuỗi không rỗng."))
    expected_pairs = {(tier, variant, "yearly") for tier in SUPPORTED_TIERS for variant in SUPPORTED_VARIANTS}
    yearly_pairs = {pair for pair in pairs if pair[2] == "yearly"}
    if yearly_pairs != expected_pairs:
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
            elif field == "quantity" and value > MAX_CREDIT_UNITS:
                errors.append(_error("VALUE_TOO_LARGE", f"creditPacks[{index}].quantity", "Số lượt vượt giới hạn xử lý an toàn."))

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
    if any(isinstance(offer, dict) and isinstance(offer.get("price"), dict)
           and offer["price"].get("period") == "monthly" for offer in offers):
        monthly_term = policies.get("monthlyBaseTerm")
        if not isinstance(monthly_term, dict) or monthly_term.get("kind") != "fixed_days":
            errors.append(_error("BLOCKED_DECISION", "policies.monthlyBaseTerm", "Cần cấu hình riêng số ngày hiệu lực cho gói tháng trước khi xuất bản."))
        elif (not isinstance(monthly_term.get("days"), int)
              or isinstance(monthly_term.get("days"), bool)
              or not 1 <= monthly_term["days"] <= 3660):
            errors.append(_error("BASE_TERM_INVALID", "policies.monthlyBaseTerm.days", "Kỳ tháng cần số ngày nguyên dương đã cấu hình."))
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
    savings_blockers = {
        "INTEGER_REQUIRED", "MONEY_INTEGER_REQUIRED", "VALUE_TOO_LARGE",
        "CREDIT_PACKS_INVALID", "OFFERS_INVALID", "OFFER_OBJECT_REQUIRED",
        "PRICE_OBJECT_REQUIRED",
    }
    if packs and offers and not any(error["code"] in savings_blockers for error in errors):
        savings = connected_savings(document)
        for item in savings:
            if item["savingBasisPoints"] < threshold:
                errors.append(_error("CONNECTED_ADVANTAGE_TOO_LOW", f"offers.{item['tier']}.{item['period']}", "Lợi ích Kết nối thấp hơn ngưỡng đã cấu hình."))

    rollout_mode = (document.get("rollout") or {}).get("mode")
    if rollout_mode not in {"shadow", "pilot", "production"}:
        errors.append(_error("ROLLOUT_MODE_INVALID", "rollout.mode", "Chế độ rollout không hợp lệ."))
    profiles = document.get("providerProfiles")
    if not isinstance(profiles, list) or not profiles or len(profiles) > 32:
        errors.append(_error("PROVIDER_PROFILE_INVALID", "providerProfiles", "Danh sách nhà cung cấp thanh toán không hợp lệ."))
        profiles = []
    valid_profiles = []
    for index, profile in enumerate(profiles):
        path = f"providerProfiles[{index}]"
        if not isinstance(profile, dict):
            errors.append(_error("PROVIDER_PROFILE_INVALID", path, "Cấu hình nhà cung cấp phải là một object."))
            continue
        supported = (
            profile.get("provider") in ("fake", "payos")
            and profile.get("environment") in ("test", "staging", "production")
            and profile.get("mode") in ("off", "shadow", "live")
            and profile.get("readiness") in ("ready", "blocked_external", "disabled")
            and isinstance(profile.get("alias"), str) and bool(profile["alias"].strip())
            and (profile.get("credentialReference") is None or isinstance(profile["credentialReference"], str))
            and type(profile.get("minAmount")) is int
            and type(profile.get("maxAmount")) is int
            and 0 <= profile["minAmount"] <= profile["maxAmount"] <= 2_147_483_647
            and type(profile.get("checkoutTtlSeconds")) is int
            and 60 <= profile["checkoutTtlSeconds"] <= 86_400
        )
        if not supported:
            errors.append(_error("PROVIDER_PROFILE_INVALID", path, "Provider, tham chiếu, hạn mức hoặc thời hạn thanh toán chưa hợp lệ."))
        else:
            valid_profiles.append(profile)
    tax = document.get("taxInvoice") or {}
    if not isinstance(tax, dict):
        errors.append(_error("TAX_POLICY_INVALID", "taxInvoice", "Chính sách thuế phải là một object."))
        tax = {}
    for key in ("approvalReference", "taxInclusive", "invoiceEnabled", "taxBasisPoints", "rounding", "invoiceTrigger"):
        value = tax.get(key)
        if value is None:
            continue
        valid = (
            isinstance(value, str) and bool(value.strip()) if key == "approvalReference"
            else type(value) is bool if key in {"taxInclusive", "invoiceEnabled"}
            else type(value) is int and 0 <= value <= 10_000 if key == "taxBasisPoints"
            else value in SUPPORTED_TAX_ROUNDING if key == "rounding" and isinstance(value, str)
            else value in SUPPORTED_INVOICE_TRIGGERS if key == "invoiceTrigger" and isinstance(value, str)
            else False
        )
        if not valid:
            errors.append(_error("TAX_POLICY_INVALID", f"taxInvoice.{key}", "Giá trị chính sách thuế/hóa đơn không được hỗ trợ."))
    seller = tax.get("sellerProfile")
    if seller is not None and (
        not isinstance(seller, dict)
        or any(value is not None and (not isinstance(value, str) or len(value) > 1000) for value in seller.values())
    ):
        errors.append(_error("TAX_POLICY_INVALID", "taxInvoice.sellerProfile", "Thông tin bên bán phải là các trường văn bản."))
    if tax_arithmetic_configured(tax):
        for index, offer in enumerate(offers):
            if not isinstance(offer, dict) or not isinstance(offer.get("price"), dict):
                continue
            price = offer.get("price") or {}
            if all(type(price.get(key)) is int and price[key] >= 0 for key in ("subtotal", "tax", "total")):
                basis = price["total"] if tax["taxInclusive"] else price["subtotal"]
                computed = calculate_tax_price(basis, tax, period=price.get("period"))
                if any(price[key] != computed[key] for key in ("subtotal", "tax", "total")):
                    errors.append(_error("TAX_PRICE_MISMATCH", f"offers[{index}].price", "Thuế của gói không khớp thuế suất và cách làm tròn đã cấu hình."))
    if rollout_mode in {"pilot", "production"} or require_production_ready:
        readiness = document.get("externalReadiness") or {}
        if not isinstance(readiness, dict):
            readiness = {}
        missing = [key for key in ("vatInvoice", "payosMerchant", "credentialWebhook", "ecommercePrivacy", "termsRefund") if not isinstance(readiness.get(key), str) or not readiness[key].strip()]
        if missing:
            readiness_labels = {
                "vatInvoice": "Chính sách thuế (đang chọn Không xuất hóa đơn)" if tax.get("invoiceEnabled") is False else "Chính sách thuế và hóa đơn",
                "payosMerchant": "Tài khoản payOS",
                "credentialWebhook": "Bộ khóa và webhook",
                "ecommercePrivacy": "Thương mại điện tử và quyền riêng tư",
                "termsRefund": "Điều khoản và hoàn tiền",
            }
            message = "Thiếu tham chiếu xác nhận: " + "; ".join(readiness_labels[key] for key in missing) + "."
            if "vatInvoice" in missing:
                message += " Điền xác nhận chính sách thuế trong phần Thuế & hóa đơn."
            if any(key != "vatInvoice" for key in missing):
                message += " Điền các xác nhận còn lại trong phần payOS & điều kiện mở bán."
            errors.append(_error("BLOCKED_EXTERNAL", "externalReadiness", message))
        tax_required = ["approvalReference", "taxInclusive", "taxBasisPoints", "rounding"]
        if tax.get("invoiceEnabled") is not False:
            tax_required.append("invoiceTrigger")
        tax_missing = [key for key in tax_required if tax.get(key) is None]
        if tax_missing:
            tax_labels = {
                "approvalReference": "Tham chiếu quyết định thuế",
                "taxInclusive": "Giá niêm yết đã/chưa gồm VAT",
                "taxBasisPoints": "Thuế suất (%)",
                "rounding": "Quy tắc làm tròn",
                "invoiceTrigger": "Thời điểm yêu cầu khi bật xuất hóa đơn",
            }
            message = "Thiếu cấu hình: " + "; ".join(tax_labels[key] for key in tax_missing) + ". Mở phần cấu hình thuế để bổ sung."
            if tax.get("invoiceEnabled") is False:
                message += " Đang chọn Không xuất hóa đơn; không cần thời điểm yêu cầu hoặc thông tin bên bán."
            errors.append(_error("BLOCKED_EXTERNAL", "taxInvoice", message))
        if tax.get("invoiceEnabled") is True and tax.get("invoiceTrigger") == "disabled":
            errors.append(_error("TAX_POLICY_INVALID", "taxInvoice.invoiceTrigger", "Đã bật hóa đơn nhưng thời điểm yêu cầu đang tắt."))
        healthy = [
            profile for profile in valid_profiles
            if profile.get("provider") == "payos"
            and profile.get("environment") == "production"
            and profile.get("mode") == "live"
            and profile.get("readiness") == "ready"
            and isinstance(profile.get("credentialReference"), str)
            and bool(profile["credentialReference"].strip())
        ]
        if not healthy:
            errors.append(_error("NO_HEALTHY_PROVIDER", "providerProfiles", "Chưa có cấu hình payOS sẵn sàng cho mở bán. Trong phần payOS & điều kiện mở bán, dùng cấu hình production, chọn Chế độ = Thanh toán thực tế, Trạng thái trong bản nháp = Đã chuẩn bị cấu hình và điền Tham chiếu bộ khóa. Chỉ xác nhận sẵn sàng sau khi kiểm tra tài khoản, bộ khóa và webhook thực tế."))
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
