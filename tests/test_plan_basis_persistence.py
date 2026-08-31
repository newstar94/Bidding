from types import SimpleNamespace

import pytest

from backend.db.schema import SCHEMA_DINH_NGHIA
from backend.db.upgrades import (
    DB_SCHEMA_VERSION,
    UPGRADES,
    _upgrade_to_v83_add_plan_bases,
)
from backend.sync.child_projection import format_plan_basis_child
from backend.sync.mapper import _save_plan_basis_children
from backend.sync.payload_validation import validate_sync_payload_shape
from backend.versioning.command import _clone_plan_bases


class _Cursor:
    def __init__(self, existing=()):
        self.existing = [dict(row) for row in existing]
        self.statements = []
        self.inserted = []

    def execute(self, statement, params=()):
        self.statements.append((" ".join(statement.split()), params))
        return self

    def fetchall(self):
        return list(self.existing)

    def executemany(self, statement, rows):
        self.statements.append((" ".join(statement.split()), None))
        self.inserted.extend(list(rows))
        return self


def _payload(rows):
    return {
        "clientMutationId": "basis-test",
        "kehoach": [{"id": "kh-1", "canCuLapKeHoachList": rows}],
    }


def test_schema_and_upgrade_register_version_owned_plan_basis_table():
    columns = SCHEMA_DINH_NGHIA["ke_hoach_can_cu"]["columns"]

    assert DB_SCHEMA_VERSION == 90
    assert UPGRADES[-1].version == 90
    assert columns["id_goc"].startswith("TEXT NOT NULL")
    assert "PARSED" in columns["parse_status"]
    assert "ke_hoach_lcnt" in SCHEMA_DINH_NGHIA["ke_hoach_can_cu"]["foreign_keys"][0]


def test_v83_upgrade_creates_table_indexes_owner_trigger_and_rechecks_fks():
    cursor = _Cursor()
    events = []
    context = SimpleNamespace(
        build_create_table_sql=lambda name, _spec: f"CREATE TABLE {name} (id TEXT)",
        create_foreign_keys=lambda _cursor, tables, **kwargs: events.append((tables, kwargs)),
        create_trigger_functions=lambda _cursor: events.append("trigger-functions"),
        assert_foreign_key_integrity=lambda _cursor: events.append("fk-check"),
    )

    _upgrade_to_v83_add_plan_bases(cursor, context)

    sql = "\n".join(statement for statement, _params in cursor.statements)
    assert "CREATE TABLE IF NOT EXISTS ke_hoach_can_cu" in sql
    assert "idx_ke_hoach_can_cu_parent" in sql
    assert "trg_ke_hoach_can_cu_workspace_owner" in sql
    assert events[-1] == "fk-check"


def test_payload_accepts_only_id_and_original_text_for_each_basis():
    assert validate_sync_payload_shape(_payload([{
        "id": "khcc-1",
        "noiDungGoc": "Quyết định số 1/QĐ ngày 1/1/2025 của UBND xã A",
    }])) == []

    errors = validate_sync_payload_shape(_payload([{
        "noiDungGoc": "Quyết định số 1/QĐ ngày 1/1/2025 của UBND xã A",
        "tenVanBan": "Client không được ghi",
    }]))
    assert any(error["code"] == "SERVER_MANAGED_FIELD" for error in errors)


def test_payload_rejects_blank_text_and_duplicate_ids():
    errors = validate_sync_payload_shape(_payload([
        {"id": "khcc-1", "noiDungGoc": " "},
        {"id": "khcc-1", "noiDungGoc": "Nội dung khác"},
    ]))

    assert {error["code"] for error in errors} >= {"VALUE_REQUIRED", "DUPLICATE_ID"}


def test_new_basis_is_parsed_and_server_owns_identity_and_order():
    cursor = _Cursor()
    raw = (
        "Căn cứ Quyết định số 123/QĐ ngày 11/11/2025 của UBND xã ABC "
        "về việc phê duyệt dự toán"
    )

    _save_plan_basis_children(
        cursor, "kh-1", [{"noiDungGoc": raw}], "org-1", "organization", 7,
        "2026-08-30 12:00:00",
    )

    assert len(cursor.inserted) == 1
    row = cursor.inserted[0]
    assert row[0].startswith("khcc-")
    assert row[1] == row[0]
    assert row[4] == "kh-1"
    assert row[5] == raw
    assert row[6:13] == (
        "Quyết định", "123/QĐ", "2025-11-11", "UBND xã ABC",
        "phê duyệt dự toán", "PARSED", "can-cu-citation-v1",
    )
    assert row[14] == 0


def test_reorder_with_unchanged_text_preserves_parser_projection_and_lineage():
    existing = {
        "id": "khcc-existing",
        "id_goc": "khcc-root",
        "noi_dung_goc": "Nguyên văn cũ",
        "ten_van_ban": "Projection cũ",
        "so_van_ban": None,
        "ngay_ban_hanh": None,
        "don_vi_ban_hanh": None,
        "trich_yeu": None,
        "parse_status": "PARTIAL",
        "parse_version": "old-parser",
        "parse_reasons": '["MISSING_DATE"]',
        "created_at": "2025-01-01 00:00:00",
    }
    cursor = _Cursor([existing])

    _save_plan_basis_children(
        cursor,
        "kh-1",
        [{"id": "khcc-existing", "noiDungGoc": "Nguyên văn cũ"}],
        "org-1",
        "organization",
        8,
        "2026-08-30 12:00:00",
    )

    row = cursor.inserted[0]
    assert row[1] == "khcc-root"
    assert row[6] == "Projection cũ"
    assert row[12] == "old-parser"
    assert row[16] == "2025-01-01 00:00:00"


def test_foreign_or_unknown_retained_id_is_rejected_before_delete():
    cursor = _Cursor()

    with pytest.raises(ValueError, match="PLAN_BASIS_ID_OUT_OF_SCOPE"):
        _save_plan_basis_children(
            cursor,
            "kh-1",
            [{"id": "khcc-other", "noiDungGoc": "Căn cứ khác"}],
            "org-1",
            "organization",
            8,
            "2026-08-30 12:00:00",
        )

    assert not any(statement.startswith("DELETE") for statement, _ in cursor.statements)


def test_server_generated_version_basis_can_use_a_new_physical_id():
    cursor = _Cursor()

    _save_plan_basis_children(
        cursor,
        "kh-new-version",
        [{
            "id": "khcc-new",
            "rootId": "khcc-root",
            "noiDungGoc": "Câu gốc",
            "_serverProjection": {
                "tenVanBan": "Quyết định",
                "soVanBan": "123/QĐ",
                "ngayBanHanh": "2025-11-11",
                "donViBanHanh": "UBND xã ABC",
                "trichYeu": "phê duyệt dự toán",
                "parseStatus": "PARSED",
                "parseVersion": "can-cu-citation-v1",
                "parseReasons": [],
            },
        }],
        "org-1",
        "organization",
        9,
        "2026-08-30 12:00:00",
    )

    assert cursor.inserted[0][0] == "khcc-new"
    assert cursor.inserted[0][1] == "khcc-root"
    assert cursor.inserted[0][6:13] == (
        "Quyết định", "123/QĐ", "2025-11-11", "UBND xã ABC",
        "phê duyệt dự toán", "PARSED", "can-cu-citation-v1",
    )


def test_projection_keeps_parser_nulls_and_derives_ten_can_cu():
    projected = format_plan_basis_child({
        "id": "khcc-1",
        "id_goc": "khcc-root",
        "noi_dung_goc": "Câu gốc",
        "ten_van_ban": None,
        "trich_yeu": "phê duyệt dự toán",
        "parse_status": "PARTIAL",
        "parse_version": "can-cu-citation-v1",
        "parse_reasons": '["MISSING_DOCUMENT_NAME"]',
        "sort_order": 2,
    }, "camel")

    assert projected["tenVanBan"] is None
    assert projected["soVanBan"] is None
    assert projected["tenCanCu"] == "phê duyệt dự toán"
    assert projected["parseReasons"] == ["MISSING_DOCUMENT_NAME"]
    assert projected["sortOrder"] == 2


def test_version_clone_gets_new_physical_id_and_keeps_lineage_projection():
    cloned = _clone_plan_bases([{
        "id": "khcc-old",
        "rootId": "khcc-root",
        "noiDungGoc": "Câu gốc",
        "tenVanBan": "Projection cũ",
        "soVanBan": None,
        "ngayBanHanh": None,
        "donViBanHanh": None,
        "trichYeu": "trích yếu",
        "parseStatus": "PARTIAL",
        "parseVersion": "old-parser",
        "parseReasons": ["MISSING_DATE"],
    }], lambda kind: f"new-{kind}")

    assert cloned == [{
        "id": "new-can_cu_lap_ke_hoach",
        "rootId": "khcc-root",
        "noiDungGoc": "Câu gốc",
        "_serverProjection": {
            "tenVanBan": "Projection cũ",
            "soVanBan": None,
            "ngayBanHanh": None,
            "donViBanHanh": None,
            "trichYeu": "trích yếu",
            "parseStatus": "PARTIAL",
            "parseVersion": "old-parser",
            "parseReasons": ["MISSING_DATE"],
        },
    }]
    assert validate_sync_payload_shape(
        _payload(cloned), trusted_server_projection=True
    ) == []
    assert any(
        error["code"] == "SERVER_MANAGED_FIELD"
        for error in validate_sync_payload_shape(_payload(cloned))
    )
