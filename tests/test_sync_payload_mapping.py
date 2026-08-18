from backend.sync import mapper
from backend.sync.child_projection import (
    format_lot_child,
    format_member_child,
    format_timeline_child,
)
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


def test_child_projection_seam_preserves_mapper_compatibility_and_values():
    assert mapper._format_lot_child is format_lot_child
    assert mapper._format_member_child is format_member_child
    assert mapper._format_timeline_child is format_timeline_child

    assert format_lot_child({
        "id": "lot-1",
        "ma_phan_lo": "L01",
        "gia_tri_phan_lo": 0,
        "bao_dam_du_thau": 0,
    }, "camel") == {
        "id": "lot-1",
        "maPhanLo": "L01",
        "tenPhanLo": "",
        "giaTriPhanLo": "0",
        "baoDamDuThau": "0",
        "thoiGianThucHien": "",
        "nhaThauTrungThauId": "",
        "giaTrungThau": "0",
        "thoiGianGoiThau": "",
        "thoiGianHopDong": "",
    }
    assert format_timeline_child({
        "id": "timeline-1", "is_optional": False, "sort_order": 0,
        "template_version": 0,
    }, "camel")["isOptional"] is False
    assert format_timeline_child({
        "id": "timeline-1", "is_optional": False, "sort_order": 0,
        "template_version": 0,
    }, "camel")["sortOrder"] == 0
    assert format_member_child({
        "id": "member-1", "nguoi_dai_dien": "Nguyễn  Văn A",
    }, "camel")["nguoiDaiDien"] == "Nguyễn Văn A"
