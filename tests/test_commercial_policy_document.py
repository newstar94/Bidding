from copy import deepcopy

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


def test_initial_draft_preserves_unknown_personal_export_mapping_as_blocker():
    result = validate_document(build_initial_draft_document(LEGACY_EXPORTS))

    blocked_paths = {
        error["path"] for error in result["errors"]
        if error["code"] == "BLOCKED_DECISION"
    }
    assert "offers[0].exportCapabilities" in blocked_paths
    assert "offers[1].exportCapabilities" in blocked_paths
    assert "policies.baseTerm" in blocked_paths
    assert "policies.renewalAnchor" in blocked_paths
    assert "policies.partialBatch" in blocked_paths


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
