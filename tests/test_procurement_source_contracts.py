from backend.procurement_import.source_contracts import (
    OPENING_OPERATION_CONTRACTS,
    PROCUREMENT_SOURCE_OPERATION_CONTRACTS,
    opening_operation_contract,
    source_operation_contract,
    source_operation_endpoint,
    source_payload_info,
)


def test_source_operation_registry_covers_reviewed_import_authorities():
    required_operations = {
        "PLAN_DETAIL",
        "PLAN_PACKAGE_DETAIL",
        "NOTICE_LDT_DETAIL",
        "NOTICE_OTHER_DETAIL",
        "NOTICE_ADB_DETAIL",
        "OPENING_ROUND",
        "OPENING_BID",
        "OPENING_LOT",
        "OPENING_LOT_DETAIL",
        "SELECTION_RESULT",
        "NOTICE_CONTRACT_LIST",
    }
    assert required_operations.issubset(PROCUREMENT_SOURCE_OPERATION_CONTRACTS)

    for operation in required_operations:
        contract = source_operation_contract(operation)
        assert contract is not None
        assert contract["endpoint"].startswith("/")
        assert contract["expectedRootShape"]
        assert contract["semanticAuthority"]
        assert contract["normalizer"]
        assert callable(contract["validator"])
        assert contract["fixture"].startswith("tests/fixtures/muasamcong/")
        assert isinstance(contract["knownAliases"], tuple)


def test_opening_contracts_keep_bidder_lot_and_detail_authorities_separate():
    assert set(OPENING_OPERATION_CONTRACTS) == {
        "OPENING_ROUND",
        "OPENING_BID",
        "OPENING_LOT",
        "OPENING_LOT_DETAIL",
    }
    assert "bidder-level" in opening_operation_contract("opening_bid")["semanticAuthority"]
    assert opening_operation_contract("OPENING_LOT")["semanticAuthority"] == "bidder-lot relation"
    assert opening_operation_contract("OPENING_LOT_DETAIL")["semanticAuthority"] == "lot detail"
    assert source_operation_contract("OPENING_SUBMISSION")["optionalEvidence"] is True


def test_source_payload_validation_uses_the_reviewed_operation_contract():
    assert source_operation_endpoint("OPENING_BID").endswith("/bid-open")
    assert source_payload_info("OPENING_BID", {
        "bidSubmissionByContractorViewResponse": {"bidSubmissionDTOList": []},
    }) == {"schemaValid": True, "recordCount": 0}
    assert source_payload_info("OPENING_BID", {"bidSubmissionDTOList": []}) == {
        "schemaValid": True,
        "recordCount": 0,
    }
    assert source_payload_info("OPENING_BID", {"unexpected": []}) == {
        "schemaValid": False,
        "recordCount": 0,
    }
    assert source_payload_info("NOTICE_CONTRACT_LIST", []) == {
        "schemaValid": True,
        "recordCount": 0,
    }
