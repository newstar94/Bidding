from types import SimpleNamespace

import pytest

from backend.db.schema import SCHEMA_DINH_NGHIA
from backend.db.upgrades import (
    DB_SCHEMA_VERSION,
    UPGRADES,
    _upgrade_to_v28_drop_retired_evaluation_actor_columns,
)


RETIRED_TABLES = (
    "vong_danh_gia",
    "bao_cao_danh_gia_nha_thau",
    "ket_qua_danh_gia_nha_thau",
)


class RecordingCursor:
    def __init__(self, populated=0):
        self.populated = populated
        self.statements = []

    def execute(self, statement, params=None):
        self.statements.append((" ".join(statement.split()), params))
        return self

    def fetchone(self):
        return (self.populated,)


def _context(events):
    return SimpleNamespace(
        assert_foreign_key_integrity=lambda cursor: events.append(("fk", cursor)),
    )


def test_fresh_schema_excludes_only_the_unused_evaluation_actor_columns():
    for table_name in RETIRED_TABLES:
        assert "nguoi_cham_id" not in SCHEMA_DINH_NGHIA[table_name]["columns"]

    assert "hoan_thanh_luc" in SCHEMA_DINH_NGHIA["vong_danh_gia"]["columns"]
    assert "hoan_thanh_luc" in SCHEMA_DINH_NGHIA["bao_cao_danh_gia_nha_thau"]["columns"]
    assert "danh_gia_luc" in SCHEMA_DINH_NGHIA["ket_qua_danh_gia_nha_thau"]["columns"]


def test_v28_preflight_stops_before_dropping_populated_legacy_columns():
    cursor = RecordingCursor(populated=2)

    with pytest.raises(RuntimeError, match="verified backup"):
        _upgrade_to_v28_drop_retired_evaluation_actor_columns(cursor, _context([]))

    assert all("DROP COLUMN" not in statement for statement, _ in cursor.statements)


def test_v28_drops_retired_columns_without_cascade_and_adds_fk_index():
    cursor = RecordingCursor()
    events = []

    _upgrade_to_v28_drop_retired_evaluation_actor_columns(cursor, _context(events))

    statements = [statement for statement, _ in cursor.statements]
    for table_name in RETIRED_TABLES:
        assert f"ALTER TABLE {table_name} DROP COLUMN IF EXISTS nguoi_cham_id" in statements
    assert not any("CASCADE" in statement for statement in statements if "DROP COLUMN" in statement)
    assert any("idx_goi_thau_hang_hoa_lot_fk" in statement for statement in statements)
    assert events and events[0][0] == "fk"
    assert DB_SCHEMA_VERSION >= 28
    assert next(item for item in UPGRADES if item.version == 28).name == "drop_retired_evaluation_actor_columns"
