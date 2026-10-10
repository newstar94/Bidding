from copy import deepcopy

import pytest

from backend.commercial_policy.document import (
    SUPPORTED_EXPORT_CAPABILITIES,
    build_initial_draft_document,
    connected_savings,
    validate_document,
)


LEGACY_EXPORTS = {
    tier: {capability: True for capability in SUPPORTED_EXPORT_CAPABILITIES}
    for tier in ("silver", "gold", "diamond")
}


def legacy_annual_document(legacy_capabilities_by_tier=None):
    """Historical snapshots keep optional monthly terms and legacy prices valid."""
    document = build_initial_draft_document(legacy_capabilities_by_tier)
    document["offers"] = document["offers"][:8]
    document["policies"].pop("monthlyBaseTerm")
    for offer in document["offers"]:
        offer["price"].pop("monthlyBaseAmount")
        offer.pop("monthlyBaseProcurementQuota")
        if offer["variant"] == "connected":
            offer["includedProcurementQuota"] = {"personal": 1000, "silver": 3000, "gold": 7000, "diamond": 15000}[offer["tier"]]
    return document


def test_initial_draft_has_twenty_products_with_monthly_base_and_fixed_terms():
    document = build_initial_draft_document(LEGACY_EXPORTS)
    assert len(document["offers"]) + len(document["creditPacks"]) == 20
    assert len(document["offers"]) == 16
    assert len({offer["code"] for offer in document["offers"]}) == 16
    for variant in ("internal", "connected"):
        for period in ("monthly", "yearly"):
            assert sum(offer["variant"] == variant and offer["price"]["period"] == period for offer in document["offers"]) == 4
    annual_amounts = [2490000, 3990000, 12000000, 15000000, 28000000, 35000000, 60000000, 75000000]
    for year, month, amount in zip(document["offers"][:8], document["offers"][8:], annual_amounts):
        assert year["price"]["total"] == amount
        assert year["price"]["total"] == month["price"]["total"] * 10
        assert year["price"]["monthlyBaseAmount"] == month["price"]["monthlyBaseAmount"] == month["price"]["total"]
        assert year["exportCapabilities"] == month["exportCapabilities"]
        assert year["memberQuota"] == month["memberQuota"]
        assert year["violationCheckEnabled"] == month["violationCheckEnabled"]
        if month["variant"] == "internal":
            assert month["includedProcurementQuota"] == 0
        else:
            assert year["includedProcurementQuota"] == month["includedProcurementQuota"] * 15
            assert year["monthlyBaseProcurementQuota"] == month["monthlyBaseProcurementQuota"] == month["includedProcurementQuota"]
            assert month["salesState"] == "sellable"
    assert [(pack["quantity"], pack["price"]) for pack in document["creditPacks"]] == [(20, 99000), (100, 399000), (500, 1490000), (2000, 4490000)]
    assert document["policies"]["baseTerm"] == {"kind": "fixed_days", "days": 365}
    assert document["policies"]["monthlyBaseTerm"] == {"kind": "fixed_days", "days": 30}
    assert [(item["tier"], item["savingBasisPoints"]) for item in connected_savings(document) if item["period"] == "yearly"] == [("personal", 4267), ("silver", 2296), ("gold", 2848), ("diamond", 3236)]


def test_twenty_product_seed_has_complete_monthly_quotas_and_valid_shadow_configuration():
    document = build_initial_draft_document(LEGACY_EXPORTS)
    assert validate_document(document)["errors"] == []
    assert {offer["tier"]: offer["includedProcurementQuota"] for offer in document["offers"] if offer["variant"] == "connected" and offer["price"]["period"] == "monthly"} == {"personal": 100, "silver": 200, "gold": 600, "diamond": 1500}
    assert all(offer["salesState"] == "sellable" for offer in document["offers"])


@pytest.mark.parametrize("base", [None, True, -1, "100", 1.5, 6667])
def test_monthly_quota_base_rejects_invalid_types_and_overflow(base):
    document = build_initial_draft_document(LEGACY_EXPORTS)
    document["offers"][1]["monthlyBaseProcurementQuota"] = base
    assert any(error["code"] == "MONTHLY_BASE_QUOTA_INVALID" for error in validate_document(document)["errors"])


@pytest.mark.parametrize("index", [1, 9])
def test_monthly_quota_rule_detects_tampered_year_and_month(index):
    document = build_initial_draft_document(LEGACY_EXPORTS)
    document["offers"][index]["includedProcurementQuota"] += 1
    assert any(error["code"] == "MONTHLY_ANNUAL_QUOTA_MISMATCH" for error in validate_document(document)["errors"])


def test_legacy_annual_snapshot_preserves_approved_defaults_and_shadow_validation():
    document = legacy_annual_document(LEGACY_EXPORTS)
    assert validate_document(document)["errors"] == []
    assert document["policies"]["renewalAnchor"] == {"kind": "end_of_term"}
    assert document["policies"]["partialBatch"] == {"kind": "process_affordable_in_stable_order"}
    assert document["policies"]["refund"] == {"kind": "no_refunds", "partial": False}
    assert all(all(offer["exportCapabilities"].values()) for offer in document["offers"][:2])
    assert document["taxInvoice"]["taxInclusive"] is True
    assert document["taxInvoice"]["invoiceEnabled"] is False
    assert document["taxInvoice"]["taxBasisPoints"] == 0
    assert document["taxInvoice"]["rounding"] == "ceil"

def test_approved_sample_tax_defaults_do_not_mark_other_production_settings_ready():
    document = legacy_annual_document(LEGACY_EXPORTS)
    assert document["rollout"] == {"mode": "shadow", "cohorts": []}
    payos = next(profile for profile in document["providerProfiles"] if profile["provider"] == "payos")
    assert payos["mode"] == "live"
    assert payos["readiness"] == "blocked_external"
    assert payos["credentialReference"] == "env://payos/default"
    assert document["externalReadiness"]["payosMerchant"] is None
    assert document["externalReadiness"]["credentialWebhook"] is None
    terms_reference = "docs/adr/0073-production-commercial-tax-and-readiness-configuration.md#commercial-terms"
    assert document["externalReadiness"]["ecommercePrivacy"] == f"{terms_reference}; views/legal/privacy.html"
    assert document["externalReadiness"]["termsRefund"] == f"{terms_reference}; views/legal/terms.html"

    document["rollout"]["mode"] = "production"
    errors = {error["path"]: error for error in validate_document(document)["errors"]}
    assert set(errors) == {"externalReadiness", "providerProfiles"}
    assert "taxInvoice" not in errors
    assert errors["externalReadiness"]["code"] == "BLOCKED_EXTERNAL"
    assert "Chính sách thuế" not in errors["externalReadiness"]["message"]
    assert "Thương mại điện tử và quyền riêng tư" not in errors["externalReadiness"]["message"]
    assert "Điều khoản và hoàn tiền" not in errors["externalReadiness"]["message"]
    assert "Tài khoản payOS" in errors["externalReadiness"]["message"]
    assert "Bộ khóa và webhook" in errors["externalReadiness"]["message"]
    assert errors["providerProfiles"]["code"] == "NO_HEALTHY_PROVIDER"


def test_initial_draft_does_not_guess_missing_organization_exports():
    result = validate_document(legacy_annual_document())
    assert {
        error["path"] for error in result["errors"]
        if error["code"] == "BLOCKED_DECISION"
    } == {f"offers[{index}].exportCapabilities" for index in range(2, 8)}


def test_commercial_document_cannot_define_record_read_or_masking_capabilities():
    document = legacy_annual_document(LEGACY_EXPORTS)
    document["offers"][2]["exportCapabilities"] = {
        **document["offers"][2]["exportCapabilities"],
        "record.read.sensitive": True,
    }

    result = validate_document(document)

    assert any(error["code"] == "CAPABILITY_INVALID" for error in result["errors"])


def test_validation_bounds_credit_savings_computation_before_dynamic_programming():
    document = legacy_annual_document(LEGACY_EXPORTS)
    document["creditPacks"][0]["quantity"] = 10**12
    document["offers"][1]["includedProcurementQuota"] = 10**12

    result = validate_document(document)

    assert sum(error["code"] == "VALUE_TOO_LARGE" for error in result["errors"]) == 2


def test_production_release_requires_external_tax_and_live_provider_readiness():
    document = legacy_annual_document(LEGACY_EXPORTS)
    personal_mapping = {capability: True for capability in SUPPORTED_EXPORT_CAPABILITIES}
    for offer in document["offers"]:
        if offer["tier"] == "personal":
            offer["exportCapabilities"] = deepcopy(personal_mapping)
    document["policies"]["baseTerm"] = {"kind": "fixed_days", "days": 365}
    document["policies"]["renewalAnchor"] = {"kind": "start_new_term"}
    document["policies"]["partialBatch"] = {"kind": "reject_all"}
    document["rollout"]["mode"] = "production"

    result = validate_document(document)

    codes = {error["code"] for error in result["errors"]}
    assert "BLOCKED_EXTERNAL" in codes
    assert "NO_HEALTHY_PROVIDER" in codes


def test_live_readiness_cannot_be_bypassed_by_omitting_all_references():
    document = legacy_annual_document(LEGACY_EXPORTS)
    document["rollout"]["mode"] = "production"
    document["externalReadiness"] = {}
    assert any(error["path"] == "externalReadiness" for error in validate_document(document)["errors"])


def test_open_sales_errors_identify_missing_settings_when_invoices_are_disabled():
    document = legacy_annual_document(LEGACY_EXPORTS)
    document["rollout"]["mode"] = "production"
    document["taxInvoice"].update(approvalReference=None, taxBasisPoints=None, rounding=None)
    document["externalReadiness"] = {key: None for key in document["externalReadiness"]}
    errors = {error["path"]: error for error in validate_document(document)["errors"]}

    assert errors["taxInvoice"]["code"] == "BLOCKED_EXTERNAL"
    for label in ("Tham chiếu quyết định thuế", "Thuế suất (%)", "Quy tắc làm tròn"):
        assert label in errors["taxInvoice"]["message"]
    assert "Thời điểm yêu cầu khi bật xuất hóa đơn" not in errors["taxInvoice"]["message"]
    for label in (
        "Chính sách thuế (đang chọn Không xuất hóa đơn)", "Tài khoản payOS",
        "Bộ khóa và webhook", "Thương mại điện tử và quyền riêng tư", "Điều khoản và hoàn tiền",
    ):
        assert label in errors["externalReadiness"]["message"]
    for raw_key in document["externalReadiness"]:
        assert raw_key not in errors["externalReadiness"]["message"]
    assert errors["providerProfiles"]["code"] == "NO_HEALTHY_PROVIDER"
    assert "Thanh toán thực tế" in errors["providerProfiles"]["message"]
    assert "Tham chiếu bộ khóa" in errors["providerProfiles"]["message"]


@pytest.mark.parametrize("invoice_enabled", [False, True])
def test_live_tax_gate_only_requires_invoice_timing_when_invoicing_is_enabled(invoice_enabled):
    document = legacy_annual_document(LEGACY_EXPORTS)
    document["rollout"]["mode"] = "production"
    document["taxInvoice"] = {
        "approvalReference": "test-tax-policy", "taxInclusive": True,
        "taxBasisPoints": 0, "rounding": "half_up", "invoiceEnabled": invoice_enabled,
    }
    errors = validate_document(document)["errors"]
    tax_errors = [error for error in errors if error["path"] == "taxInvoice"]
    if invoice_enabled:
        assert len(tax_errors) == 1
        assert "Thời điểm yêu cầu khi bật xuất hóa đơn" in tax_errors[0]["message"]
        assert "Thuế suất (%)" not in tax_errors[0]["message"]
    else:
        assert tax_errors == []
    assert {"externalReadiness", "providerProfiles"} <= {error["path"] for error in errors}


def test_live_payos_profile_requires_a_nonblank_credential_reference():
    document = legacy_annual_document(LEGACY_EXPORTS)
    document["rollout"]["mode"] = "production"
    payos = next(profile for profile in document["providerProfiles"] if profile["provider"] == "payos")
    payos.update(mode="live", readiness="ready", credentialReference="   ")
    assert any(error["code"] == "NO_HEALTHY_PROVIDER" for error in validate_document(document)["errors"])


@pytest.mark.parametrize("partial", [None, True, 0, "false"])
def test_no_refunds_policy_requires_an_explicit_false_partial_flag(partial):
    document = legacy_annual_document(LEGACY_EXPORTS)
    document["policies"]["refund"] = {"kind": "no_refunds", "partial": partial}
    assert any(
        error["code"] == "REFUND_POLICY_INVALID" and error["path"] == "policies.refund.partial"
        for error in validate_document(document)["errors"]
    )


def test_configured_tax_requires_valid_types_and_matching_offer_amounts():
    document = legacy_annual_document(LEGACY_EXPORTS)
    document["taxInvoice"] = {"taxInclusive": False, "taxBasisPoints": 800, "rounding": "half_up", "invoiceTrigger": "manual"}
    assert any(error["code"] == "TAX_PRICE_MISMATCH" for error in validate_document(document)["errors"])
    document["taxInvoice"]["taxBasisPoints"] = True
    assert any(error["code"] == "TAX_POLICY_INVALID" for error in validate_document(document)["errors"])


@pytest.mark.parametrize("profiles", [[None], {}, "wrong-shape", [{"provider": "bogus", "mode": "live", "readiness": "ready", "credentialReference": "configured"}]])
def test_live_provider_validation_rejects_malformed_or_unsupported_profiles(profiles):
    document = legacy_annual_document(LEGACY_EXPORTS)
    document["rollout"]["mode"] = "production"
    document["providerProfiles"] = profiles
    result = validate_document(document)
    assert any(error["code"] == "NO_HEALTHY_PROVIDER" for error in result["errors"])


@pytest.mark.parametrize(
    ("field", "value", "expected_code"),
    [
        ("ownerKind", "workspace", "OWNER_KIND_INVALID"),
        ("salesState", "paused", "SALES_STATE_INVALID"),
        ("violationCheckEnabled", 1, "VIOLATION_CHECK_INVALID"),
    ],
)
def test_offer_contract_rejects_invalid_closed_fields(field, value, expected_code):
    document = legacy_annual_document(LEGACY_EXPORTS)
    document["offers"][0][field] = value

    result = validate_document(document)

    assert any(
        error["code"] == expected_code and error["path"] == f"offers[0].{field}"
        for error in result["errors"]
    )


@pytest.mark.parametrize(
    ("field", "value", "expected_code"),
    [
        ("period", "weekly", "PRICE_PERIOD_INVALID"),
        ("currency", "USD", "PRICE_CURRENCY_INVALID"),
    ],
)
def test_offer_price_rejects_noncanonical_period_and_currency(field, value, expected_code):
    document = legacy_annual_document(LEGACY_EXPORTS)
    document["offers"][0]["price"][field] = value

    result = validate_document(document)

    assert any(
        error["code"] == expected_code and error["path"] == f"offers[0].price.{field}"
        for error in result["errors"]
    )


def test_monthly_offers_are_optional_distinct_and_require_their_own_term_policy():
    document = legacy_annual_document(LEGACY_EXPORTS)
    annual = deepcopy(document["offers"])
    monthly = deepcopy(annual[2])
    monthly["code"] = "silver.internal.monthly"
    monthly["price"] = {"period": "monthly", "currency": "VND", "subtotal": 123456, "tax": 0, "total": 123456}
    document["offers"].append(monthly)
    result = validate_document(document)
    assert not any(error["code"] in {"OFFER_PAIR_INVALID", "OFFER_MATRIX_INCOMPLETE", "PRICE_PERIOD_INVALID"} for error in result["errors"])
    assert any(error["path"] == "policies.monthlyBaseTerm" for error in result["errors"])
    document["policies"]["monthlyBaseTerm"] = {"kind": "fixed_days", "days": 31}
    result = validate_document(document)
    assert not any(error["path"].startswith("policies.monthlyBaseTerm") for error in result["errors"])
    assert document["offers"][:8] == annual
    document["offers"].append(deepcopy(monthly))
    assert any(error["code"] == "OFFER_PAIR_INVALID" for error in validate_document(document)["errors"])


def test_monthly_prices_do_not_overwrite_annual_savings():
    document = legacy_annual_document(LEGACY_EXPORTS)
    annual_savings = connected_savings(document)
    for original in document["offers"][2:4]:
        monthly = deepcopy(original)
        monthly["code"] = monthly["code"].replace("yearly", "monthly")
        monthly["price"]["period"] = "monthly"
        monthly["price"]["total"] = 100000 if monthly["variant"] == "internal" else 110000
        monthly["price"]["subtotal"] = monthly["price"]["total"]
        monthly["includedProcurementQuota"] = 0 if monthly["variant"] == "internal" else 20
        document["offers"].append(monthly)
    savings = connected_savings(document)
    assert [item for item in savings if item["period"] == "yearly"] == annual_savings
    month = next(item for item in savings if item["period"] == "monthly")
    assert month["internalPlusCredits"] == 199000
    assert month["connected"] == 110000


@pytest.mark.parametrize("days", [0, -1, True, 30.5, 3661, None])
def test_monthly_term_rejects_invalid_explicit_duration(days):
    document = legacy_annual_document(LEGACY_EXPORTS)
    monthly = deepcopy(document["offers"][2])
    monthly["code"] = "silver.internal.monthly"
    monthly["price"]["period"] = "monthly"
    document["offers"].append(monthly)
    document["policies"]["monthlyBaseTerm"] = {"kind": "fixed_days", "days": days}
    assert any(error["path"] == "policies.monthlyBaseTerm.days" for error in validate_document(document)["errors"])


@pytest.mark.parametrize(
    ("field", "value", "expected_code"),
    [
        ("name", 10, "DISPLAY_TEXT_INVALID"),
        ("description", [], "DISPLAY_TEXT_INVALID"),
        ("order", -1, "DISPLAY_ORDER_INVALID"),
        ("badge", {}, "DISPLAY_TEXT_INVALID"),
        ("recommended", "yes", "DISPLAY_BOOLEAN_INVALID"),
        ("visibility", "members_only", "DISPLAY_VISIBILITY_INVALID"),
        ("variantLabel", 7, "DISPLAY_TEXT_INVALID"),
        ("periodLabel", False, "DISPLAY_TEXT_INVALID"),
        ("benefits", ["Hợp lệ", 2], "DISPLAY_BENEFITS_INVALID"),
    ],
)
def test_offer_display_metadata_is_typed(field, value, expected_code):
    document = legacy_annual_document(LEGACY_EXPORTS)
    document["offers"][0]["display"][field] = value

    result = validate_document(document)

    assert any(
        error["code"] == expected_code
        and error["path"] == f"offers[0].display.{field}"
        for error in result["errors"]
    )


def test_malformed_offer_item_returns_typed_validation_error_instead_of_raising():
    document = legacy_annual_document(LEGACY_EXPORTS)
    document["offers"][0] = "not-an-object"

    result = validate_document(document)

    assert any(
        error["code"] == "OFFER_OBJECT_REQUIRED" and error["path"] == "offers[0]"
        for error in result["errors"]
    )
