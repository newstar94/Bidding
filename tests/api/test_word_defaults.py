from backend.app import app  # noqa: F401 - initializes backend import paths
from backend.documents.word_defaults import (
    WORD_DEFAULT_MAPPINGS_VERSION,
    build_default_word_mappings,
)


def test_contractor_representative_position_has_default_word_mapping():
    mappings = build_default_word_mappings()

    assert WORD_DEFAULT_MAPPINGS_VERSION >= 6
    assert any(
        mapping["ten_bien"] == "chuc_vu_dai_dien_nt"
        and mapping["source_table"] == "nha_thau"
        and mapping["source_column"] == "chuc_vu_dai_dien"
        for mapping in mappings
    )


def test_contractor_stamp_has_default_word_mappings():
    mappings = build_default_word_mappings()
    stamp_mappings = {
        (mapping["ten_bien"], mapping["source_column"])
        for mapping in mappings
        if mapping["source_table"] == "nha_thau"
    }

    assert ("anh_dau_nt", "anh_dau") in stamp_mappings
    assert ("ten_anh_dau_nt", "ten_anh_dau") in stamp_mappings


def test_partner_effective_dates_and_contract_liquidation_have_word_mappings():
    mappings = build_default_word_mappings()
    keys = {(item["source_table"], item["source_column"]) for item in mappings}

    assert WORD_DEFAULT_MAPPINGS_VERSION >= 7
    assert ("chu_dau_tu", "ngay_ap_dung") in keys
    assert ("nha_thau", "ngay_ap_dung") in keys
    assert ("hop_dong", "ngay_thanh_ly") in keys


def test_default_word_mappings_inherit_shared_field_formats():
    mappings = build_default_word_mappings()
    formats = {
        (item["source_table"], item["source_column"]): item.get("format")
        for item in mappings
    }

    assert formats[("goi_thau", "gia_goi_thau")] == "currency"
    assert formats[("goi_thau", "ngay_quyet_dinh_ket_qua")] == "date"
    assert formats[("goi_thau", "thoi_gian_mo_thau")] == "datetime"
