"""Reviewed Mua Sắm Công source-operation contracts.

The browser collector records an upstream operation for every raw response.
This registry makes the expected shape, semantic authority, normalizer, and
fixture for those operations explicit.  It deliberately does not turn field
names into broad aliases: a new upstream shape remains a schema diagnostic
until the corresponding normalizer is reviewed.
"""

from __future__ import annotations

from collections.abc import Callable, Mapping

from backend.integrations.muasamcong_browser.canonical import (
    opening_source_payload_info,
)


SourcePayloadValidator = Callable[[object], dict[str, int | bool]]


def _object_payload_info(payload: object) -> dict[str, int | bool]:
    valid = isinstance(payload, dict)
    return {"schemaValid": valid, "recordCount": 1 if valid else 0}


def _collection_payload_info(payload: object) -> dict[str, int | bool]:
    valid = isinstance(payload, list)
    return {"schemaValid": valid, "recordCount": len(payload) if valid else 0}


def _opening_payload_info(operation: str) -> SourcePayloadValidator:
    return lambda payload: opening_source_payload_info(operation, payload)


def _contract(
    *,
    endpoint: str,
    pack_types: tuple[int, ...] = (),
    expected_root_shape: str,
    required_containers: tuple[str, ...] = (),
    known_aliases: tuple[str, ...] = (),
    semantic_authority: str,
    normalizer: str,
    validator: SourcePayloadValidator,
    fixture: str,
    optional_evidence: bool = False,
) -> dict[str, object]:
    return {
        "endpoint": endpoint,
        "packTypes": pack_types,
        "expectedRootShape": expected_root_shape,
        "requiredContainers": required_containers,
        "knownAliases": known_aliases,
        "semanticAuthority": semantic_authority,
        "normalizer": normalizer,
        "validator": validator,
        "fixture": fixture,
        "optionalEvidence": optional_evidence,
    }


# These entries intentionally name concrete collector operations.  The
# top-level PLAN/NOTICE/OPENING concepts may be composed from several of them,
# but their facts must not be conflated merely because they share an entity.
PROCUREMENT_SOURCE_OPERATION_CONTRACTS: dict[str, dict[str, object]] = {
    "PLAN_DETAIL": _contract(
        endpoint="/expose/lcnt/bid-po-bidp-plan-project-view/get-by-id",
        expected_root_shape="object",
        semantic_authority="plan-level selection data",
        normalizer="normalize_plan_revision",
        validator=_object_payload_info,
        fixture="tests/fixtures/muasamcong/plan",
    ),
    "PLAN_PACKAGE_DETAIL": _contract(
        endpoint="/lcnt/bid-po-bidp-plan-project-view/get-bidp-plan-detail-by-id",
        expected_root_shape="object",
        semantic_authority="plan-package relation and package source fields",
        normalizer="normalize_plan_revision",
        validator=_object_payload_info,
        fixture="tests/fixtures/muasamcong/plan",
    ),
    "NOTICE_LDT_DETAIL": _contract(
        endpoint="/expose/lcnt/bid-po-bido-notify-contractor-view/get-by-id",
        expected_root_shape="object",
        semantic_authority="online tender notice",
        normalizer="normalize_notice_revision",
        validator=_object_payload_info,
        fixture="tests/fixtures/muasamcong/notice",
    ),
    "NOTICE_OTHER_DETAIL": _contract(
        endpoint="/expose/lcnt/bid-notify-contractor-out/get-by-id",
        expected_root_shape="object",
        semantic_authority="other procurement notice",
        normalizer="normalize_notice_revision",
        validator=_object_payload_info,
        fixture="tests/fixtures/muasamcong/notice",
    ),
    "NOTICE_ADB_DETAIL": _contract(
        endpoint="/expose/lcnt/bid-notify-contractor-out-adb-wb/get-by-id",
        expected_root_shape="object",
        semantic_authority="ADB/WB procurement notice",
        normalizer="normalize_notice_revision",
        validator=_object_payload_info,
        fixture="tests/fixtures/muasamcong/notice",
    ),
    "OPENING_NOTIFY": _contract(
        endpoint="/exposeldtkqmt/bid-notification-p/notify",
        expected_root_shape="object",
        semantic_authority="opening notice metadata",
        normalizer="normalize_opening_bundle",
        validator=_object_payload_info,
        fixture="tests/fixtures/muasamcong/opening",
        optional_evidence=True,
    ),
    "OPENING_ROUND": _contract(
        endpoint="/expose/ldtkqmt/bid-notification-p/roundmng",
        pack_types=(0, 1, 2),
        expected_root_shape="object",
        semantic_authority="opening-round schedule and status",
        normalizer="normalize_opening_bundle",
        validator=_opening_payload_info("OPENING_ROUND"),
        fixture="tests/fixtures/muasamcong/opening",
    ),
    "OPENING_SUBMISSION": _contract(
        endpoint="/expose/ldtkqmt/bid-notification-p/submission",
        pack_types=(0, 1, 2),
        expected_root_shape="array-or-object",
        semantic_authority="optional submission evidence",
        normalizer="normalize_opening_bundle",
        validator=lambda payload: {
            "schemaValid": isinstance(payload, (dict, list)),
            "recordCount": len(payload) if isinstance(payload, list) else 0,
        },
        fixture="tests/fixtures/muasamcong/opening",
        optional_evidence=True,
    ),
    "OPENING_BID": _contract(
        endpoint="/expose/ldtkqmt/bid-notification-p/bid-open",
        pack_types=(0, 1, 2),
        expected_root_shape="object",
        required_containers=("bidSubmissionByContractorViewResponse.bidSubmissionDTOList",),
        semantic_authority="bidder-level summary",
        normalizer="normalize_opening_bundle",
        validator=_opening_payload_info("OPENING_BID"),
        fixture="tests/fixtures/muasamcong/opening",
    ),
    "OPENING_LOT": _contract(
        endpoint="/expose/ldtkqmt/bid-notification-p/lot-open",
        pack_types=(0, 1, 2),
        expected_root_shape="array-or-object",
        required_containers=("lotNoValueDTOList",),
        semantic_authority="bidder-lot relation",
        normalizer="normalize_opening_bundle",
        validator=_opening_payload_info("OPENING_LOT"),
        fixture="tests/fixtures/muasamcong/opening",
    ),
    "OPENING_LOT_DETAIL": _contract(
        endpoint="/expose/ldtkqmt/bid-notification-p/lotOpenDetail",
        pack_types=(0, 1, 2),
        expected_root_shape="array-or-object",
        required_containers=("lotOpenDetailDTOList", "bidOpenDetailDTOList", "items"),
        semantic_authority="lot detail",
        normalizer="normalize_opening_bundle",
        validator=_opening_payload_info("OPENING_LOT_DETAIL"),
        fixture="tests/fixtures/muasamcong/opening",
    ),
    "OPENING_FINANCIAL_DETAIL": _contract(
        endpoint="/expose/ldtkqmt/bid-notification-p/get-by-id-v2",
        pack_types=(2,),
        expected_root_shape="object",
        semantic_authority="financial-opening detail",
        normalizer="normalize_opening_bundle",
        validator=_object_payload_info,
        fixture="tests/fixtures/muasamcong/opening/1g2t",
        optional_evidence=True,
    ),
    "SELECTION_RESULT": _contract(
        endpoint="/expose/contractor-input-result/get",
        expected_root_shape="array-or-object",
        semantic_authority="award result and ranking",
        normalizer="normalize_result_bundle",
        validator=lambda payload: {
            "schemaValid": isinstance(payload, (dict, list)),
            "recordCount": len(payload) if isinstance(payload, list) else 0,
        },
        fixture="tests/fixtures/muasamcong/result",
    ),
    "NOTICE_CONTRACT_LIST": _contract(
        endpoint="/econsign/contract-info/list-contract-for-po",
        expected_root_shape="array",
        semantic_authority="published contract list",
        normalizer="normalize_contract_list",
        validator=_collection_payload_info,
        fixture="tests/fixtures/muasamcong/notice",
        optional_evidence=True,
    ),
}


# Retain the focused opening name for existing import callers and tests.
OPENING_OPERATION_CONTRACTS = {
    operation: contract
    for operation, contract in PROCUREMENT_SOURCE_OPERATION_CONTRACTS.items()
    if operation in {
        "OPENING_ROUND",
        "OPENING_BID",
        "OPENING_LOT",
        "OPENING_LOT_DETAIL",
    }
}


def source_operation_contract(operation: object) -> Mapping[str, object] | None:
    """Return reviewed metadata for one concrete collector operation."""

    return PROCUREMENT_SOURCE_OPERATION_CONTRACTS.get(
        str(operation or "").strip().upper()
    )


def opening_operation_contract(operation: object) -> Mapping[str, object] | None:
    """Return reviewed metadata for a required opening source."""

    return OPENING_OPERATION_CONTRACTS.get(str(operation or "").strip().upper())


def source_payload_info(operation: object, payload: object) -> dict[str, int | bool]:
    """Validate only the reviewed shape for an observed source response."""

    contract = source_operation_contract(operation)
    if contract is None:
        return {"schemaValid": isinstance(payload, (dict, list)), "recordCount": 0}
    validator = contract["validator"]
    assert callable(validator)
    return validator(payload)


def source_operation_endpoint(operation: object) -> str | None:
    contract = source_operation_contract(operation)
    endpoint = contract.get("endpoint") if contract else None
    return endpoint if isinstance(endpoint, str) else None
