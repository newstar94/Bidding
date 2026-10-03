from __future__ import annotations

import os
import sqlite3
from types import SimpleNamespace

import psycopg
import pytest

from backend.db.db_helper import CompatRow, PostgresCursor, compat_row_factory
from backend.sync import mapper
from backend.sync.record_writer import SyncRecordWriter
from backend.sync.serializer import rollback_sync_response
from backend.versioning.aggregate_snapshot import snapshot_package_aggregate


NOW = "2026-10-03T00:00:00Z"


class _PostgresTestConnection:
    def __init__(self, connection):
        self.connection = connection

    def cursor(self):
        return PostgresCursor(self.connection.cursor())

    def execute(self, statement, params=()):
        return self.cursor().execute(statement, params)

    def commit(self):
        self.connection.commit()

    def rollback(self):
        self.connection.rollback()

    def close(self):
        self.connection.close()


@pytest.fixture(params=["sqlite", "postgres"])
def database(request):
    if request.param == "postgres":
        # Explicit opt-in only: never load application or developer .env URLs.
        url = os.environ.get("LOT_SCOPE_TEST_DATABASE_URL")
        if not url:
            pytest.skip("LOT_SCOPE_TEST_DATABASE_URL is not configured")
        connection = _PostgresTestConnection(
            psycopg.connect(url, row_factory=compat_row_factory, connect_timeout=5)
        )
    else:
        connection = sqlite3.connect(":memory:")
        connection.row_factory = lambda cursor, values: CompatRow(
            [column[0] for column in cursor.description], values
        )
        connection.execute("PRAGMA foreign_keys = ON")
    try:
        connection.execute(
            """CREATE TEMP TABLE goi_thau (
                   id TEXT,
                   organization_id TEXT,
                   ten_goi_thau TEXT,
                   row_version INTEGER DEFAULT 1,
                   updated_at TEXT,
                   UNIQUE(organization_id, id)
               )"""
        )
        connection.execute(
            """CREATE TEMP TABLE goi_thau_phan_lo (
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
                   UNIQUE(organization_id, id),
                   FOREIGN KEY(organization_id, goi_thau_id)
                       REFERENCES goi_thau(organization_id, id)
               )"""
        )
        connection.execute(
            """CREATE UNIQUE INDEX lot_active_code
               ON goi_thau_phan_lo (
                   organization_id, goi_thau_id, ma_phan_lo_normalized
               ) WHERE archived_at IS NULL AND ma_phan_lo_normalized <> ''"""
        )
        for parent_id, organization_id in (
            ("package-a", "org"),
            ("package-b", "org"),
            ("package-c", "org"),
            ("package-snapshot", "org"),
            ("package-other", "other-org"),
        ):
            connection.execute(
                """INSERT INTO goi_thau
                   (id, organization_id, ten_goi_thau, updated_at)
                   VALUES (?, ?, ?, ?)""",
                (parent_id, organization_id, parent_id, NOW),
            )
        _save(connection, "package-a", [
            {"id": "lot-a-stable", "maPhanLo": "LÔ 01", "tenPhanLo": "A original"},
            {"id": "lot-a-omitted", "maPhanLo": "A-02", "tenPhanLo": "A omitted"},
        ])
        _save(connection, "package-b", [
            {"id": "lot-b-original", "maPhanLo": "B-01", "tenPhanLo": "B original"},
            {"id": "lot-b-alternate", "maPhanLo": "B-02", "tenPhanLo": "B archived"},
        ])
        connection.execute(
            "UPDATE goi_thau_phan_lo SET archived_at = ? WHERE id = ?",
            (NOW, "lot-b-alternate"),
        )
        _save(connection, "package-other", [
            {"id": "lot-other-only", "maPhanLo": "OTHER-01", "tenPhanLo": "Other org"},
        ], organization_id="other-org")
        connection.commit()
        yield connection
    finally:
        connection.close()


def _save(connection, parent_id, lots, awards=(), *, organization_id="org"):
    mapper._save_lots(
        connection.cursor(), parent_id, lots, awards, organization_id,
        "organization", 2, NOW,
    )


def _rows(connection, table, where="", params=()):
    statements = {
        ("goi_thau", ""):
            "SELECT * FROM goi_thau ORDER BY organization_id, id",
        ("goi_thau_phan_lo", ""):
            "SELECT * FROM goi_thau_phan_lo ORDER BY organization_id, id",
        ("goi_thau_phan_lo", "WHERE goi_thau_id = ?"):
            "SELECT * FROM goi_thau_phan_lo WHERE goi_thau_id = ? ORDER BY organization_id, id",
        ("goi_thau_phan_lo", "WHERE goi_thau_id = ? AND archived_at IS NULL"):
            "SELECT * FROM goi_thau_phan_lo WHERE goi_thau_id = ? AND archived_at IS NULL ORDER BY organization_id, id",
        ("goi_thau_phan_lo", "WHERE id = ?"):
            "SELECT * FROM goi_thau_phan_lo WHERE id = ? ORDER BY organization_id, id",
        ("goi_thau_phan_lo", "WHERE organization_id = ?"):
            "SELECT * FROM goi_thau_phan_lo WHERE organization_id = ? ORDER BY organization_id, id",
        ("goi_thau_phan_lo", "WHERE organization_id = ? AND id = ?"):
            "SELECT * FROM goi_thau_phan_lo WHERE organization_id = ? AND id = ? ORDER BY organization_id, id",
    }
    return [dict(row) for row in connection.execute(
        statements[(table, where)], params
    ).fetchall()]


def _writer(connection):
    noop = lambda *args: None
    return SyncRecordWriter(
        SimpleNamespace(
            cursor=connection.cursor(),
            actor=SimpleNamespace(organization_id="org", user_id="actor"),
            owner_type="organization",
            current_time=NOW,
        ),
        sync_version=2,
        mutation_tracker=SimpleNamespace(
            record_row_version=noop, track_record=noop,
            track_activity=noop, track_audit=noop,
        ),
        clean_record_id=lambda _table, value: mapper.clean_id(value),
        ownership_scoped_tables=set(),
        defer_latest_flag=noop,
        map_database_record=lambda _table, row: row,
        save_children=mapper.save_child_payloads,
    )


def _write_package(writer, package_id, **children):
    return writer.write(
        payload_key="goithau",
        table_name="goi_thau",
        item={"id": package_id, "expectedVersion": 1, **children},
        db_row_data={
            "id": package_id, "organization_id": "org",
            "ten_goi_thau": "changed by batch", "updated_at": NOW,
        },
        previous_record=None,
    )


@pytest.mark.parametrize("foreign_id", ["lot-b-original", "lot-b-alternate"])
@pytest.mark.parametrize("entrypoint", ["phanLoList", "awardedPhanLoList"])
def test_foreign_parent_lot_id_rejects_and_rolls_back_entire_batch(
    database, foreign_id, entrypoint,
):
    before_packages = _rows(database, "goi_thau")
    before_lots = _rows(database, "goi_thau_phan_lo")
    before_b = _rows(database, "goi_thau_phan_lo", "WHERE goi_thau_id = ?", ("package-b",))
    writer = _writer(database)
    _write_package(writer, "package-c")
    legitimate_lots = [
        {"id": "lot-a-stable", "maPhanLo": "LÔ 01", "tenPhanLo": "A changed"},
        {"id": "lot-a-new", "maPhanLo": "A-NEW", "tenPhanLo": "A inserted"},
    ]
    malicious = {
        "id": foreign_id, "maPhanLo": "FOREIGN-CODE-CHANGED",
        "tenPhanLo": "B overwritten", "giaTrungThau": 999,
    }
    payload = {"phanLoList": legitimate_lots}
    if entrypoint == "phanLoList":
        payload[entrypoint] = [*legitimate_lots, malicious]
    else:
        payload[entrypoint] = [malicious]

    with pytest.raises(ValueError, match="Phan lo khong thuoc goi thau hien tai") as error:
        _write_package(writer, "package-a", **payload)

    # The SQL guard itself leaves the foreign row unchanged before rollback.
    assert _rows(database, "goi_thau_phan_lo", "WHERE goi_thau_id = ?", ("package-b",)) == before_b
    response = rollback_sync_response(
        database, [{"table": "goi_thau", "id": "package-a", "message": str(error.value)}],
        "Không thể đồng bộ vì có bản ghi không hợp lệ.",
    )
    assert response.status_code == 400
    assert _rows(database, "goi_thau") == before_packages
    assert _rows(database, "goi_thau_phan_lo") == before_lots


def test_same_parent_lot_update_keeps_identity_and_archives_omitted_lot(database):
    before_b = _rows(database, "goi_thau_phan_lo", "WHERE goi_thau_id = ?", ("package-b",))
    _save(database, "package-a", [
        {"id": "lot-a-stable", "maPhanLo": "A-RENAMED", "tenPhanLo": "A updated"},
    ])
    rows = {row["id"]: row for row in _rows(database, "goi_thau_phan_lo")}
    assert rows["lot-a-stable"]["goi_thau_id"] == "package-a"
    assert rows["lot-a-stable"]["ten_phan_lo"] == "A updated"
    assert rows["lot-a-stable"]["row_version"] == 2
    assert rows["lot-a-omitted"]["archived_at"] == NOW
    assert _rows(database, "goi_thau_phan_lo", "WHERE goi_thau_id = ?", ("package-b",)) == before_b


def test_same_parent_canonical_code_reuses_stable_id_without_payload_id(database):
    _save(database, "package-a", [
        {"maPhanLo": "  Ｌô\u00a0０１ ", "tenPhanLo": "A canonical update"},
    ])
    active = _rows(database, "goi_thau_phan_lo", "WHERE goi_thau_id = ? AND archived_at IS NULL", ("package-a",))
    assert len(active) == 1
    assert active[0]["id"] == "lot-a-stable"
    assert active[0]["ma_phan_lo_normalized"] == "lô 01"
    assert active[0]["ten_phan_lo"] == "A canonical update"
    assert active[0]["row_version"] == 2


@pytest.mark.parametrize("explicit_id", [True, False])
def test_active_same_code_lot_is_preferred_over_archived_duplicate(database, explicit_id):
    database.execute(
        """INSERT INTO goi_thau_phan_lo (
               id, organization_id, owner_type, goi_thau_id, ma_phan_lo,
               ma_phan_lo_normalized, ten_phan_lo, archived_at, row_version
           ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)""",
        ("lot-z-archived", "org", "organization", "package-a", "LÔ 01",
         "lô 01", "Archived duplicate", NOW, 3),
    )
    before_archived = _rows(database, "goi_thau_phan_lo", "WHERE id = ?", ("lot-z-archived",))
    payload = {"maPhanLo": "  Ｌô\u00a0０１ ", "tenPhanLo": "A active update"}
    if explicit_id:
        payload["id"] = "lot-a-stable"

    _save(database, "package-a", [payload])

    active = _rows(database, "goi_thau_phan_lo", "WHERE goi_thau_id = ? AND archived_at IS NULL", ("package-a",))
    assert len(active) == 1
    assert active[0]["id"] == "lot-a-stable"
    assert active[0]["ten_phan_lo"] == "A active update"
    assert active[0]["row_version"] == 2
    assert _rows(database, "goi_thau_phan_lo", "WHERE id = ?", ("lot-z-archived",)) == before_archived


def test_same_parent_archived_lot_can_be_revived(database):
    database.execute(
        "UPDATE goi_thau_phan_lo SET archived_at = ? WHERE id = ?",
        (NOW, "lot-a-stable"),
    )
    _save(database, "package-a", [
        {"id": "lot-a-stable", "maPhanLo": "LÔ 01", "tenPhanLo": "A revived"},
    ])
    revived = _rows(database, "goi_thau_phan_lo", "WHERE id = ?", ("lot-a-stable",))[0]
    assert revived["archived_at"] is None
    assert revived["ten_phan_lo"] == "A revived"
    assert revived["row_version"] == 2


def test_same_lot_id_in_other_organization_does_not_conflict_or_change_foreign_row(database):
    before_other = _rows(database, "goi_thau_phan_lo", "WHERE organization_id = ?", ("other-org",))
    _save(database, "package-a", [
        {"id": "lot-other-only", "maPhanLo": "A-NEW", "tenPhanLo": "A independent"},
    ])
    assert _rows(database, "goi_thau_phan_lo", "WHERE organization_id = ?", ("other-org",)) == before_other
    created = _rows(database, "goi_thau_phan_lo", "WHERE organization_id = ? AND id = ?", ("org", "lot-other-only"))[0]
    assert created["goi_thau_id"] == "package-a"
    assert created["ten_phan_lo"] == "A independent"


def test_server_snapshot_cloned_lot_and_award_save_without_changing_source(database):
    before_source = _rows(database, "goi_thau_phan_lo", "WHERE goi_thau_id = ?", ("package-a",))
    source = {
        "id": "package-a",
        "phanLoList": [{"id": "lot-a-stable", "maPhanLo": "LÔ 01", "tenPhanLo": "A original"}],
        "awardedPhanLoList": [{"id": "lot-a-stable", "maPhanLo": "LÔ 01", "giaTrungThau": 500}],
    }
    snapshot = snapshot_package_aggregate(
        {}, source, target_package_id="package-snapshot", target_plan_id="plan-snapshot",
        package_version=2, timestamp=NOW, create_id=lambda kind: f"{kind}-snapshot",
    )["packageRecord"]
    cloned_id = snapshot["phanLoList"][0]["id"]
    assert cloned_id != "lot-a-stable"
    assert snapshot["awardedPhanLoList"][0]["id"] == cloned_id
    _save(database, "package-snapshot", snapshot["phanLoList"], snapshot["awardedPhanLoList"])
    assert _rows(database, "goi_thau_phan_lo", "WHERE goi_thau_id = ?", ("package-a",)) == before_source
    target = _rows(database, "goi_thau_phan_lo", "WHERE goi_thau_id = ?", ("package-snapshot",))
    assert len(target) == 1
    assert target[0]["id"] == cloned_id
    assert target[0]["gia_trung_thau"] == 500
