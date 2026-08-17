from backend.sync import mapper
from backend.sync.payload_mapping import (
    canonicalize_payload_item,
    db_column_for_json_key,
    get_payload_value,
    json_key_for_column,
    map_db_to_json,
)


def test_payload_mapping_seam_preserves_legacy_mapper_interface():
    assert mapper.json_key_for_column is json_key_for_column
    assert mapper.db_column_for_json_key is db_column_for_json_key
    assert mapper.get_payload_value is get_payload_value
    assert mapper.canonicalize_payload_item is canonicalize_payload_item
    assert mapper.map_db_to_json is map_db_to_json


def test_payload_mapping_keeps_canonical_keys_and_business_identifier_behavior():
    assert json_key_for_column("goi_thau", "id_goc") == "rootId"
    assert db_column_for_json_key("goi_thau", "maGoiThau") == "ma_goi_thau"
    assert get_payload_value("goi_thau", {"maGoiThau": "IB2601"}, "ma_goi_thau") == "IB2601"
    assert canonicalize_payload_item("nha_thau", {
        "maNhaThau": "VnAb-01",
        "tenNhaThau": "Nhà thầu thử nghiệm",
    })["maNhaThau"] == "VnAb-01"
