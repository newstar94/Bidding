import os
import sys

sys.path.append(os.path.abspath(os.path.join(os.path.dirname(__file__), '..')))
sys.path.append(os.path.abspath(os.path.join(os.path.dirname(__file__), '../helpers_py')))

from helpers_py.sync_mapper import (
    canonicalize_payload_item,
    db_column_for_json_key,
    json_key_for_column,
    map_db_to_json,
)


def test_canonicalize_payload_item_prefers_api_keys_and_strips_db_keys():
    item = {
        "id": "gt-1",
        "id_goc": "root-from-db-key",
        "rootId": "root-from-api-key",
        "ten_goi_thau": "Ten tu snake_case",
        "tenGoiThau": "Ten tu camelCase",
        "updated_at": "2026-07-04 09:00:00",
        "clientOnly": "kept",
    }

    normalized = canonicalize_payload_item("goi_thau", item)

    assert normalized["id"] == "gt-1"
    assert normalized["rootId"] == "root-from-api-key"
    assert normalized["tenGoiThau"] == "Ten tu camelCase"
    assert normalized["updatedAt"] == "2026-07-04 09:00:00"
    assert normalized["clientOnly"] == "kept"
    assert "id_goc" not in normalized
    assert "ten_goi_thau" not in normalized
    assert "updated_at" not in normalized


def test_mapper_roundtrip_special_fields():
    assert json_key_for_column("chuyen_gia", "so_cccd") == "soCCCD"
    assert db_column_for_json_key("chuyen_gia", "soCCCD") == "so_cccd"
    assert db_column_for_json_key("goi_thau", "rootId") == "id_goc"


def test_map_db_to_json_uses_schema_field_map_and_json_columns():
    row = {
        "id": "gt-1",
        "id_goc": "root-1",
        "ten_goi_thau": "Goi thau 1",
        "gia_han_list": '[{"lyDo":"Gia han lan 1"}]',
        "sync_version": 7,
    }

    item = map_db_to_json("goi_thau", row)

    assert item["id"] == "gt-1"
    assert item["rootId"] == "root-1"
    assert item["tenGoiThau"] == "Goi thau 1"
    assert item["giaHanList"] == [{"lyDo": "Gia han lan 1"}]
    assert item["syncVersion"] == 7
