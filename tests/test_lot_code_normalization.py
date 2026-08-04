from __future__ import annotations

import sqlite3
from types import SimpleNamespace

import pytest

from backend.db.schema import MONEY_COLUMNS, SCHEMA_DINH_NGHIA
from backend.db.upgrades import DB_SCHEMA_VERSION, UPGRADES
from backend.shared.text_utils import normalize_lot_code
from backend.sync import mapper
from backend.sync.record_serializer import SyncRecordSerializer


class _UpgradeCursor:
    def __init__(self, lots=(), openings=()):
        self.lots = list(lots)
        self.openings = list(openings)
        self.statements = []
        self.current_rows = []

    def execute(self, statement, params=None):
        compact = " ".join(statement.split())
        self.statements.append((compact, params))
        if "FROM goi_thau_phan_lo" in compact and compact.startswith("SELECT"):
            self.current_rows = self.lots
        elif "FROM thong_tin_mo_thau" in compact and compact.startswith("SELECT"):
            self.current_rows = self.openings
        else:
            self.current_rows = []
        return self

    def executemany(self, statement, values):
        self.statements.append((" ".join(statement.split()), list(values)))
        return self

    def fetchall(self):
        return list(self.current_rows)


def _upgrade():
    return next(item for item in UPGRADES if item.version == 36)


def test_lot_code_contract_handles_nfkc_unicode_whitespace_case_and_excel_numbers():
    assert normalize_lot_code("  ＬÔ\u00a0 ０１  ") == "lô 01"
    assert normalize_lot_code("LÔ\t01") == "lô 01"
    assert normalize_lot_code(DecimalLike("1.0")) == "1"
    assert normalize_lot_code(True) == ""


class DecimalLike:
    def __init__(self, value):
        self.value = value

    def __str__(self):
        return self.value


def test_v36_backfills_both_tables_and_replaces_expression_indexes():
    cursor = _UpgradeCursor(
        lots=[("lot-1", "org", "pkg", " Ｌ０１ ", None)],
        openings=[("opening-1", "org", "pkg", "bidder", "L\u00a001", None)],
    )

    _upgrade().apply(cursor, None)

    assert DB_SCHEMA_VERSION >= 36
    assert _upgrade().name == "persist_canonical_lot_codes"
    executed = "\n".join(statement for statement, _ in cursor.statements)
    assert "lower(trim(ma_phan_lo))" not in executed
    assert "ma_phan_lo_normalized" in executed
    lot_update = next(
        values
        for statement, values in cursor.statements
        if statement.startswith("UPDATE goi_thau_phan_lo SET ma_phan_lo_normalized")
    )
    opening_update = next(
        values
        for statement, values in cursor.statements
        if statement.startswith("UPDATE thong_tin_mo_thau SET ma_phan_lo_normalized")
    )
    assert lot_update == [("l01", "lot-1")]
    assert opening_update == [("l 01", "opening-1")]


def test_v36_fails_before_schema_mutation_when_canonical_backfill_collides():
    cursor = _UpgradeCursor(
        lots=[
            ("lot-1", "org", "pkg", "LÔ 01", None),
            ("lot-2", "org", "pkg", "  lô\u00a001  ", None),
        ]
    )

    with pytest.raises(RuntimeError, match="active-key collisions"):
        _upgrade().apply(cursor, None)

    assert all(
        statement.startswith("SELECT") for statement, _ in cursor.statements
    )


def test_lot_child_write_persists_the_same_canonical_value():
    connection = sqlite3.connect(":memory:")
    try:
        connection.execute(
            """CREATE TABLE goi_thau_phan_lo (
                   id TEXT,
                   organization_id TEXT,
                   owner_type TEXT,
                   goi_thau_id TEXT,
                   ma_phan_lo TEXT,
                   ma_phan_lo_normalized TEXT,
                   ten_phan_lo TEXT,
                   gia_tri_phan_lo INTEGER,
                   bao_dam_du_thau INTEGER,
                   thoi_gian_thuc_hien TEXT,
                   nha_thau_trung_thau_id TEXT,
                   gia_trung_thau INTEGER,
                   thoi_gian_goi_thau TEXT,
                   thoi_gian_hop_dong TEXT,
                   sort_order INTEGER,
                   archived_at TEXT,
                   sync_version INTEGER,
                   row_version INTEGER DEFAULT 1,
                   updated_at TEXT,
                   UNIQUE(organization_id, id)
               )"""
        )

        mapper._save_lots(
            connection.cursor(),
            "pkg",
            [{"id": "lot-1", "maPhanLo": "  Ｌô\u00a0０１ "}],
            [],
            "org",
            "organization",
            2,
            "2026-08-04T00:00:00Z",
        )

        row = connection.execute(
            "SELECT ma_phan_lo, ma_phan_lo_normalized FROM goi_thau_phan_lo"
        ).fetchone()
        assert row == ("  Ｌô\u00a0０１ ", "lô 01")
        assert "ma_phan_lo_normalized" in SCHEMA_DINH_NGHIA["goi_thau_phan_lo"]["columns"]
        assert "ma_phan_lo_normalized" in SCHEMA_DINH_NGHIA["thong_tin_mo_thau"]["columns"]
    finally:
        connection.close()


def test_opening_serializer_derives_canonical_value_instead_of_trusting_payload():
    transaction = SimpleNamespace(
        actor=SimpleNamespace(organization_id="org"),
        owner_type="organization",
        current_time="2026-08-04T00:00:00Z",
        cursor=None,
    )
    serializer = SyncRecordSerializer(
        transaction,
        sync_version=3,
        newly_written_images=set(),
        mutation_tracker=SimpleNamespace(),
        clean_record_id=lambda _table, value: str(value).strip() if value else None,
        schema_definition=SCHEMA_DINH_NGHIA,
        money_columns=MONEY_COLUMNS,
        field_name_for_column=mapper.json_key_for_column,
        payload_value_for_column=mapper.get_payload_value,
    )

    row = serializer.serialize(
        "thong_tin_mo_thau",
        {
            "id": "opening-1",
            "maPhanLo": "  Ｌô\u00a0０１ ",
            "maPhanLoNormalized": "attacker-controlled",
        },
    )

    assert row["ma_phan_lo"] == "Ｌô\u00a0０１"
    assert row["ma_phan_lo_normalized"] == "lô 01"
