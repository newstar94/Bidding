import backend.procurement_import.routes as routes
from backend.procurement_import.opening_snapshot import (
    OPENING_OPERATION_CONTRACTS,
    load_complete_opening_snapshot,
    opening_operation_contract,
    raw_snapshot_has_complete_opening_sources,
)


def test_opening_contract_registry_keeps_distinct_semantic_authorities():
    assert set(OPENING_OPERATION_CONTRACTS) == {
        "OPENING_ROUND",
        "OPENING_BID",
        "OPENING_LOT",
        "OPENING_LOT_DETAIL",
    }
    assert opening_operation_contract("opening_bid")["semanticAuthority"] == "bidder-level summary"
    assert opening_operation_contract("OPENING_LOT")["semanticAuthority"] == "bidder-lot relation"
    assert opening_operation_contract("OPENING_LOT_DETAIL")["semanticAuthority"] == "lot detail"
    assert opening_operation_contract("unknown") is None


def test_opening_snapshot_seam_preserves_route_compatibility_aliases():
    assert routes._load_opening_from_raw_snapshot is load_complete_opening_snapshot
    assert routes._raw_snapshot_has_complete_opening_sources is raw_snapshot_has_complete_opening_sources
