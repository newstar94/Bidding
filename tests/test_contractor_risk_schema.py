from types import SimpleNamespace

from backend.db.postgres_schema import build_create_table_sql
from backend.db.schema import SCHEMA_DINH_NGHIA
from backend.db.upgrades import (
    DB_SCHEMA_VERSION,
    _upgrade_to_v42_recheck_failed_violation_snapshots,
)
from backend.sync.mapper import map_db_to_json
from backend.sync.record_serializer import SyncRecordSerializer


def test_contractor_risk_schema_is_current_and_timezone_aware():
    assert DB_SCHEMA_VERSION == 42
    assert "contractor_violation_cache" in SCHEMA_DINH_NGHIA
    assert "contractor_violation_checks" in SCHEMA_DINH_NGHIA
    sql = build_create_table_sql(
        "contractor_violation_checks",
        SCHEMA_DINH_NGHIA["contractor_violation_checks"],
    )
    assert "bid_closing_at TIMESTAMPTZ" in sql
    assert "checked_at TIMESTAMPTZ NOT NULL" in sql
    assert "source_records_json TEXT NOT NULL" in sql
    assert "PRIMARY KEY (organization_id, id)" in sql


def test_v42_rechecks_snapshots_without_authoritative_payload():
    statements = []

    class Cursor:
        def execute(self, statement):
            statements.append(" ".join(statement.split()))
            return self

    _upgrade_to_v42_recheck_failed_violation_snapshots(Cursor(), None)

    sql = "\n".join(statements)
    assert "source_payload_hash = ''" in sql
    assert "status IN ('LOOKUP_FAILED', 'NO_ACTIVE_VIOLATION')" in sql
    assert "SET violation_status = 'NOT_CHECKED'" in sql
    assert "thong_tin_mo_thau_lien_danh_thanh_vien" in sql


def test_opening_sync_hydrates_authoritative_status():
    row = {
        column: None
        for column in SCHEMA_DINH_NGHIA["thong_tin_mo_thau"]["columns"]
    }
    row.update({
        "id": "opening-1",
        "violation_status": "VIOLATION_CONFIRMED",
        "violation_bid_closing_at": "2026-06-01 09:00:00",
    })
    value = map_db_to_json("thong_tin_mo_thau", row)
    assert value["violationStatus"] == "VIOLATION_CONFIRMED"
    assert value["violationBidClosingAt"] == "2026-06-01 09:00:00"


def test_opening_sync_ignores_frontend_violation_status_write():
    transaction = SimpleNamespace(
        actor=SimpleNamespace(organization_id="org-1"),
        owner_type="organization",
        current_time="2026-01-01 00:00:00",
    )
    serializer = SyncRecordSerializer(
        transaction,
        sync_version=1,
        newly_written_images=set(),
        mutation_tracker=SimpleNamespace(),
        clean_record_id=lambda _table, value: value,
        schema_definition=SCHEMA_DINH_NGHIA,
        money_columns=set(),
        field_name_for_column=lambda table, column: SCHEMA_DINH_NGHIA[table]
        .get("field_map", {})
        .get(column, column),
        payload_value_for_column=lambda table, item, column: item.get(
            SCHEMA_DINH_NGHIA[table].get("field_map", {}).get(column, column)
        ),
    )
    db_row = serializer.serialize(
        "thong_tin_mo_thau",
        {
            "id": "opening-1",
            "violationStatus": "VIOLATION_CONFIRMED",
            "violationBidClosingAt": "2099-01-01",
            "violationCheckedAt": "2099-01-01",
        },
    )
    assert "violation_status" not in db_row
    assert "violation_bid_closing_at" not in db_row
    assert "violation_checked_at" not in db_row
