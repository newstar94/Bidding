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


def test_initial_draft_has_exact_approved_offers_packs_and_dynamic_savings():
    document = build_initial_draft_document(LEGACY_EXPORTS)

    assert len(document["offers"]) == 8
    assert [(pack["quantity"], pack["price"]) for pack in document["creditPacks"]] == [
        (20, 99_000),
        (100, 399_000),
        (500, 1_490_000),
        (2_000, 4_490_000),
    ]
    savings = connected_savings(document)
    assert [(item["tier"], item["savingBasisPoints"]) for item in savings] == [
        ("personal", 2_706),
        ("silver", 2_296),
        ("gold", 2_126),
        ("diamond", 2_056),
    ]


def test_initial_draft_uses_approved_defaults_and_passes_shadow_validation():
    document = build_initial_draft_document(LEGACY_EXPORTS)
    assert validate_document(document)["errors"] == []
    assert document["policies"]["baseTerm"] == {"kind": "fixed_days", "days": 365}
    assert document["policies"]["renewalAnchor"] == {"kind": "end_of_term"}
    assert document["policies"]["partialBatch"] == {"kind": "process_affordable_in_stable_order"}
    for offer in document["offers"][:2]:
        assert offer["exportCapabilities"] == {
            capability: True for capability in SUPPORTED_EXPORT_CAPABILITIES
        }
    assert all(offer["price"]["period"] == "yearly" for offer in document["offers"])
    assert document["taxInvoice"]["taxInclusive"] is True
    assert document["taxInvoice"]["invoiceEnabled"] is False
    assert document["taxInvoice"]["taxBasisPoints"] is None


def test_initial_draft_does_not_guess_missing_organization_exports():
    result = validate_document(build_initial_draft_document())
    assert {
        error["path"] for error in result["errors"]
        if error["code"] == "BLOCKED_DECISION"
    } == {f"offers[{index}].exportCapabilities" for index in range(2, 8)}


def test_commercial_document_cannot_define_record_read_or_masking_capabilities():
    document = build_initial_draft_document(LEGACY_EXPORTS)
    document["offers"][2]["exportCapabilities"] = {
        **document["offers"][2]["exportCapabilities"],
        "record.read.sensitive": True,
    }

    result = validate_document(document)

    assert any(error["code"] == "CAPABILITY_INVALID" for error in result["errors"])


def test_validation_bounds_credit_savings_computation_before_dynamic_programming():
    document = build_initial_draft_document(LEGACY_EXPORTS)
    document["creditPacks"][0]["quantity"] = 10**12
    document["offers"][1]["includedProcurementQuota"] = 10**12

    result = validate_document(document)

    assert sum(error["code"] == "VALUE_TOO_LARGE" for error in result["errors"]) == 2


def test_production_release_requires_external_tax_and_live_provider_readiness():
    document = build_initial_draft_document(LEGACY_EXPORTS)
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
    document = build_initial_draft_document(LEGACY_EXPORTS)
    document["rollout"]["mode"] = "production"
    document["externalReadiness"] = {}
    assert any(error["path"] == "externalReadiness" for error in validate_document(document)["errors"])


def test_open_sales_errors_identify_missing_settings_when_invoices_are_disabled():
    document = build_initial_draft_document(LEGACY_EXPORTS)
    document["rollout"]["mode"] = "production"
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
    document = build_initial_draft_document(LEGACY_EXPORTS)
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
    document = build_initial_draft_document(LEGACY_EXPORTS)
    document["rollout"]["mode"] = "production"
    payos = next(profile for profile in document["providerProfiles"] if profile["provider"] == "payos")
    payos.update(mode="live", readiness="ready", credentialReference="   ")
    assert any(error["code"] == "NO_HEALTHY_PROVIDER" for error in validate_document(document)["errors"])


def test_configured_tax_requires_valid_types_and_matching_offer_amounts():
    document = build_initial_draft_document(LEGACY_EXPORTS)
    document["taxInvoice"] = {"taxInclusive": False, "taxBasisPoints": 800, "rounding": "half_up", "invoiceTrigger": "manual"}
    assert any(error["code"] == "TAX_PRICE_MISMATCH" for error in validate_document(document)["errors"])
    document["taxInvoice"]["taxBasisPoints"] = True
    assert any(error["code"] == "TAX_POLICY_INVALID" for error in validate_document(document)["errors"])


@pytest.mark.parametrize("profiles", [[None], {}, "wrong-shape", [{"provider": "bogus", "mode": "live", "readiness": "ready", "credentialReference": "configured"}]])
def test_live_provider_validation_rejects_malformed_or_unsupported_profiles(profiles):
    document = build_initial_draft_document(LEGACY_EXPORTS)
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
    document = build_initial_draft_document(LEGACY_EXPORTS)
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
    document = build_initial_draft_document(LEGACY_EXPORTS)
    document["offers"][0]["price"][field] = value

    result = validate_document(document)

    assert any(
        error["code"] == expected_code and error["path"] == f"offers[0].price.{field}"
        for error in result["errors"]
    )


def test_monthly_offers_are_optional_distinct_and_require_their_own_term_policy():
    document = build_initial_draft_document(LEGACY_EXPORTS)
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
    document = build_initial_draft_document(LEGACY_EXPORTS)
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
    document = build_initial_draft_document(LEGACY_EXPORTS)
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
    document = build_initial_draft_document(LEGACY_EXPORTS)
    document["offers"][0]["display"][field] = value

    result = validate_document(document)

    assert any(
        error["code"] == expected_code
        and error["path"] == f"offers[0].display.{field}"
        for error in result["errors"]
    )


def test_malformed_offer_item_returns_typed_validation_error_instead_of_raising():
    document = build_initial_draft_document(LEGACY_EXPORTS)
    document["offers"][0] = "not-an-object"

    result = validate_document(document)

    assert any(
        error["code"] == "OFFER_OBJECT_REQUIRED" and error["path"] == "offers[0]"
        for error in result["errors"]
    )
