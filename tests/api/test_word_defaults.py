import sqlite3

from backend.app import app  # noqa: F401 - initializes backend import paths
from backend.documents.word_defaults import (
    WORD_DEFAULT_MAPPINGS_VERSION,
    build_default_word_mappings,
    ensure_default_word_mappings,
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


def test_default_word_mappings_use_personal_owner_for_personal_workspace():
    connection = sqlite3.connect(":memory:")
    connection.execute("PRAGMA foreign_keys = ON")
    connection.executescript(
        """
        CREATE TABLE to_chuc (
            id TEXT PRIMARY KEY,
            scope_type TEXT NOT NULL,
            UNIQUE(id, scope_type)
        );
        CREATE TABLE cau_hinh_bien_word (
            id TEXT PRIMARY KEY,
            organization_id TEXT NOT NULL,
            owner_type TEXT NOT NULL,
            ten_bien TEXT NOT NULL,
            source_table TEXT NOT NULL,
            source_column TEXT NOT NULL,
            mo_ta TEXT,
            UNIQUE(organization_id, ten_bien),
            UNIQUE(organization_id, source_table, source_column),
            FOREIGN KEY (organization_id, owner_type)
                REFERENCES to_chuc(id, scope_type)
        );
        CREATE TABLE word_default_seeds (
            organization_id TEXT PRIMARY KEY,
            mappings_version INTEGER NOT NULL,
            updated_at TEXT DEFAULT (datetime('now')),
            FOREIGN KEY (organization_id) REFERENCES to_chuc(id)
        );
        INSERT INTO to_chuc (id, scope_type) VALUES ('personal-1', 'personal');
        """
    )

    inserted = ensure_default_word_mappings(connection.cursor(), "personal-1")
    connection.commit()

    assert inserted > 0
    owner_types = {
        row[0] for row in connection.execute(
            "SELECT DISTINCT owner_type FROM cau_hinh_bien_word WHERE organization_id = 'personal-1'"
        )
    }
    assert owner_types == {"personal"}
    assert connection.execute(
        "SELECT mappings_version FROM word_default_seeds WHERE organization_id = 'personal-1'"
    ).fetchone()[0] == WORD_DEFAULT_MAPPINGS_VERSION
    connection.close()
