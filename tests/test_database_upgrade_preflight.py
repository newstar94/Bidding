from pathlib import Path
import os

import psycopg
import pytest

from backend.db.db_helper import PostgresCursor, compat_row_factory
from backend.db.postgres_schema import initialize_postgres_database
from backend.db.upgrade_preflight import inspect_database_upgrade
from backend.db.upgrades import DB_SCHEMA_VERSION, UPGRADES


class _CardinalityCursor:
    def __init__(self, *rows):
        self.rows = list(rows)
        self.statements = []

    def execute(self, statement, params=None):
        self.statements.append((" ".join(statement.split()), params))
        return self

    def fetchone(self):
        return self.rows[len(self.statements) - 1]


def test_v36_preflight_reports_exact_cardinality_and_relation_bytes():
    cursor = _CardinalityCursor(
        (120, 100, 340, 300, 32_768, 65_536),
        (0, 0),
        (0, 0, 0, 0, 0, 0),
        (True, True, True),
        (1_000, 50, 10_000),
        (2, 10),
        (0,),
    )

    report = inspect_database_upgrade(cursor, 35, target_version=DB_SCHEMA_VERSION)

    assert report == {
        "currentVersion": 35,
        "targetVersion": DB_SCHEMA_VERSION,
        "upgradeRequired": True,
        "v36CanonicalLotCodes": {
            "applies": True,
            "lotRows": 120,
            "activeLotRows": 100,
            "openingRows": 340,
            "activeOpeningRows": 300,
            "rowsLoadedIntoPython": 460,
            "relationBytes": 98_304,
            "requiresTransactionalDryRun": True,
        },
        "v44SyncMetadataBounds": {
            "applies": True,
            "currentVersionNegativeRows": 0,
            "minimumVersionAheadRows": 0,
            "requiresDataRepair": False,
        },
        "v45RetentionCleanupIndexes": {
            "applies": True,
            "deletedRecordsRows": 0,
            "syncMutationsRows": 0,
            "terminalPartnerJobRows": 0,
            "relationBytes": 0,
            "requiresTransactionalDryRun": True,
        },
        "v46HistoricalChain": {
            "applies": True,
            "requiresTransactionalDryRun": True,
            "requiresCatalogReconciliation": True,
        },
        "v47DuplicateAuditIndex": {
            "applies": True,
            "requiresTransactionalDryRun": True,
            "explicitIndexPresent": True,
            "constraintBackedIndexPresent": True,
            "exactDuplicate": True,
        },
        "v49ToV62Operational": {
            "applies": True,
            "versions": list(range(49, 63)),
            "requiresTransactionalDryRun": True,
            "requiresLockBudget": True,
        },
        "v50BindingSnapshotUniqueness": {
            "applies": True,
            "duplicateGroups": 0,
            "requiresDataRepair": False,
        },
        "v54ObservationUniqueness": {
            "applies": True,
            "duplicateObservationGroups": 0,
            "duplicateIdempotencyGroups": 0,
            "requiresDataRepair": False,
        },
        "v59WebsocketDispatchRewrite": {
            "applies": True,
            "requiresTransactionalDryRun": True,
            "eventRows": 1_000,
            "deliveredRowsToRewrite": 50,
            "relationBytes": 10_000,
        },
        "v60SyncedDeleteSnapshot": {
            "applies": True,
            "requiresFunctionRehearsal": True,
            "requiresRollbackRehearsal": True,
        },
        "v61DefaultWorkspaceRename": {
            "applies": True,
            "candidateOrganizations": 2,
            "organizationRows": 10,
            "requiresApprovedTenantMapping": True,
            "automaticRemediationAllowed": False,
        },
        "v62AiMessageIdempotency": {
            "applies": True,
            "requiresIndexBuildBudget": True,
            "newColumnStartsNull": True,
        },
        "v63ProcurementOperationIdempotency": {
            "applies": True,
            "duplicateFamilyScopedGroups": 0,
            "requiresDataRepair": False,
            "requiresLockBudget": True,
        },
    }
    assert len(cursor.statements) == 7
    assert "COUNT(*) FILTER (WHERE archived_at IS NULL)" in cursor.statements[0][0]
    assert "pg_total_relation_size" in cursor.statements[0][0]


@pytest.mark.parametrize("current_version", (None, 36, DB_SCHEMA_VERSION))
def test_v36_preflight_skips_cardinality_when_historical_upgrade_does_not_apply(
    current_version,
):
    cursor = _CardinalityCursor(
        *((
            (
                (0, 0),
                (0, 0, 0, 0, 0, 0),
                    (True, True, True),
                    (0, 0, 0),
                    (0, 0),
                    (0,),
                )
            if current_version == 36
            else ()
        ))
    )

    report = inspect_database_upgrade(
        cursor,
        current_version,
        target_version=DB_SCHEMA_VERSION,
    )

    assert report["v36CanonicalLotCodes"] == {
        "applies": False,
        "requiresTransactionalDryRun": False,
    }
    assert all("goi_thau_phan_lo" not in row[0] for row in cursor.statements)


def test_v44_preflight_reports_invalid_sync_metadata_rows_before_migration():
    cursor = _CardinalityCursor((2, 3))

    report = inspect_database_upgrade(cursor, 43, target_version=44)

    assert report["v44SyncMetadataBounds"] == {
        "applies": True,
        "currentVersionNegativeRows": 2,
        "minimumVersionAheadRows": 3,
        "requiresDataRepair": True,
    }
    assert "current_version < 0" in cursor.statements[0][0]
    assert "min_available_version > current_version" in cursor.statements[0][0]


def test_v45_preflight_reports_retention_cardinality_and_relation_bytes():
    cursor = _CardinalityCursor((120_000, 240_000, 8_000, 32_768, 65_536, 16_384))

    report = inspect_database_upgrade(cursor, 44, target_version=45)

    assert report["v45RetentionCleanupIndexes"] == {
        "applies": True,
        "deletedRecordsRows": 120_000,
        "syncMutationsRows": 240_000,
        "terminalPartnerJobRows": 8_000,
        "relationBytes": 114_688,
        "requiresTransactionalDryRun": True,
    }
    assert len(cursor.statements) == 1
    assert "partner_enrichment_jobs" in cursor.statements[0][0]
    assert "pg_total_relation_size" in cursor.statements[0][0]


def test_v46_preflight_requires_historical_catalog_reconciliation():
    cursor = _CardinalityCursor()

    report = inspect_database_upgrade(cursor, 45, target_version=46)

    assert report["v46HistoricalChain"] == {
        "applies": True,
        "requiresTransactionalDryRun": True,
        "requiresCatalogReconciliation": True,
    }
    assert cursor.statements == []


def test_v47_preflight_verifies_exact_duplicate_audit_index_before_drop():
    cursor = _CardinalityCursor((True, True, True))

    report = inspect_database_upgrade(cursor, 46, target_version=47)

    assert report["v47DuplicateAuditIndex"] == {
        "applies": True,
        "requiresTransactionalDryRun": True,
        "explicitIndexPresent": True,
        "constraintBackedIndexPresent": True,
        "exactDuplicate": True,
    }
    assert len(cursor.statements) == 1
    assert "idx_audit_log_single_successor" in cursor.statements[0][0]
    assert "audit_log_chain_id_previous_hash_key" in cursor.statements[0][0]


def test_v50_preflight_reports_duplicate_binding_snapshot_groups():
    cursor = _CardinalityCursor((3,))

    report = inspect_database_upgrade(cursor, 49, target_version=50)

    assert report["v50BindingSnapshotUniqueness"] == {
        "applies": True,
        "duplicateGroups": 3,
        "requiresDataRepair": True,
    }
    assert "local_snapshot_id" in cursor.statements[0][0]


def test_v54_preflight_reports_both_target_uniqueness_collisions():
    cursor = _CardinalityCursor((2, 4))

    report = inspect_database_upgrade(cursor, 53, target_version=54)

    assert report["v54ObservationUniqueness"] == {
        "applies": True,
        "duplicateObservationGroups": 2,
        "duplicateIdempotencyGroups": 4,
        "requiresDataRepair": True,
    }


def test_v59_preflight_reports_websocket_rows_rewritten_in_transaction():
    cursor = _CardinalityCursor((25_000, 4_000, 8_388_608))

    report = inspect_database_upgrade(cursor, 58, target_version=59)

    assert report["v59WebsocketDispatchRewrite"] == {
        "applies": True,
        "requiresTransactionalDryRun": True,
        "eventRows": 25_000,
        "deliveredRowsToRewrite": 4_000,
        "relationBytes": 8_388_608,
    }


def test_v61_preflight_counts_candidates_without_exposing_or_rewriting_tenants():
    cursor = _CardinalityCursor((2, 17))

    report = inspect_database_upgrade(cursor, 60, target_version=61)

    assert report["v61DefaultWorkspaceRename"] == {
        "applies": True,
        "candidateOrganizations": 2,
        "organizationRows": 17,
        "requiresApprovedTenantMapping": True,
        "automaticRemediationAllowed": False,
    }
    assert len(cursor.statements) == 1
    assert cursor.statements[0][0].startswith("SELECT")
    assert "UPDATE" not in cursor.statements[0][0]


def test_v63_preflight_reports_family_scoped_idempotency_duplicates():
    cursor = _CardinalityCursor((3,))

    report = inspect_database_upgrade(cursor, 62, target_version=63)

    assert report["v63ProcurementOperationIdempotency"] == {
        "applies": True,
        "duplicateFamilyScopedGroups": 3,
        "requiresDataRepair": True,
        "requiresLockBudget": True,
    }
    assert "family_key" in cursor.statements[0][0]


def test_database_dry_run_rolls_back_successful_upgrade(monkeypatch):
    events = []

    class FakeCursor:
        def execute(self, statement, params=None):
            events.append(("execute", " ".join(statement.split()), params))
            return self

    class FakeConnection:
        def cursor(self):
            return FakeCursor()

        def commit(self):
            events.append(("commit",))

        def rollback(self):
            events.append(("rollback",))

        def close(self):
            events.append(("close",))

    class FakeDatabase:
        def get_connection(self):
            return FakeConnection()

    monkeypatch.setattr("backend.db.postgres_schema.read_database_version", lambda _: 35)
    monkeypatch.setattr(
        "backend.db.postgres_schema.apply_database_upgrades",
        lambda _cursor, _version, _context: DB_SCHEMA_VERSION,
    )
    monkeypatch.setattr("backend.db.postgres_schema.assert_schema_contract", lambda _: None)
    monkeypatch.setattr(
        "backend.db.postgres_schema.assert_foreign_key_integrity",
        lambda _: None,
    )

    assert initialize_postgres_database(FakeDatabase(), dry_run=True) == DB_SCHEMA_VERSION
    assert ("commit",) not in events
    assert events[-2:] == [("rollback",), ("close",)]


def _test_database_url():
    if value := os.environ.get("TEST_DATABASE_URL"):
        return value
    env_path = Path(__file__).resolve().parents[1] / ".env"
    if not env_path.is_file():
        return None
    for line in env_path.read_text(encoding="utf-8-sig").splitlines():
        if not line or line.lstrip().startswith("#") or "=" not in line:
            continue
        key, value = line.split("=", 1)
        if key.strip() == "TEST_DATABASE_URL":
            return value.strip().strip('"').strip("'") or None
    return None


@pytest.fixture
def realistic_upgrade_cursor():
    database_url = _test_database_url()
    if not database_url:
        pytest.skip("TEST_DATABASE_URL is not configured")
    try:
        connection = psycopg.connect(
            database_url,
            connect_timeout=5,
            row_factory=compat_row_factory,
        )
    except psycopg.Error as error:
        pytest.skip(f"PostgreSQL test database is unavailable: {type(error).__name__}")
    try:
        cursor = PostgresCursor(connection.cursor())
        cursor.execute(
            """CREATE TEMP TABLE goi_thau_phan_lo (
                   id TEXT PRIMARY KEY,
                   organization_id TEXT NOT NULL,
                   goi_thau_id TEXT NOT NULL,
                   ma_phan_lo TEXT,
                   archived_at TEXT
               )"""
        )
        cursor.execute(
            """CREATE TEMP TABLE thong_tin_mo_thau (
                   id TEXT PRIMARY KEY,
                   organization_id TEXT NOT NULL,
                   goi_thau_id TEXT NOT NULL,
                   nha_thau_id TEXT NOT NULL,
                   ma_phan_lo TEXT,
                   archived_at TEXT
               )"""
        )
        cursor.execute(
            """CREATE UNIQUE INDEX idx_goi_thau_phan_lo_active_code
                 ON goi_thau_phan_lo (
                    organization_id, goi_thau_id, lower(trim(ma_phan_lo))
                 ) WHERE archived_at IS NULL AND trim(ma_phan_lo) <> ''"""
        )
        cursor.execute(
            """CREATE UNIQUE INDEX idx_thong_tin_mo_thau_active_business_key
                 ON thong_tin_mo_thau (
                    organization_id, goi_thau_id, nha_thau_id,
                    lower(trim(ma_phan_lo))
                 ) WHERE archived_at IS NULL"""
        )
        cursor.execute(
            """INSERT INTO goi_thau_phan_lo
                   (id, organization_id, goi_thau_id, ma_phan_lo, archived_at)
               SELECT 'lot-' || value,
                      'org-' || (value % 10),
                      'package-' || (value % 100),
                      '  LOT ' || value || '  ',
                      CASE WHEN value % 11 = 0 THEN '2026-01-01' ELSE NULL END
                 FROM generate_series(1, 3000) AS value"""
        )
        cursor.execute(
            """INSERT INTO thong_tin_mo_thau
                   (id, organization_id, goi_thau_id, nha_thau_id,
                    ma_phan_lo, archived_at)
               SELECT 'opening-' || value,
                      'org-' || (value % 10),
                      'package-' || (value % 100),
                      'bidder-' || value,
                      CASE WHEN value % 3 = 0 THEN NULL ELSE '  LOT ' || value || '  ' END,
                      CASE WHEN value % 13 = 0 THEN '2026-01-01' ELSE NULL END
                 FROM generate_series(1, 6000) AS value"""
        )
        yield cursor
    finally:
        connection.rollback()
        connection.close()


def test_v36_real_postgres_preflight_and_upgrade_at_realistic_cardinality(
    realistic_upgrade_cursor,
):
    report = inspect_database_upgrade(
        realistic_upgrade_cursor,
        35,
        target_version=36,
    )

    assert report["v36CanonicalLotCodes"]["lotRows"] == 3000
    assert report["v36CanonicalLotCodes"]["openingRows"] == 6000
    assert report["v36CanonicalLotCodes"]["rowsLoadedIntoPython"] == 9000

    upgrade = next(item for item in UPGRADES if item.version == 36)
    upgrade.apply(realistic_upgrade_cursor, None)

    assert realistic_upgrade_cursor.execute(
        "SELECT ma_phan_lo_normalized FROM goi_thau_phan_lo WHERE id = 'lot-42'"
    ).fetchone()[0] == "lot 42"
    assert realistic_upgrade_cursor.execute(
        """SELECT ma_phan_lo_normalized
             FROM thong_tin_mo_thau WHERE id = 'opening-42'"""
    ).fetchone()[0] == ""
    null_counts = realistic_upgrade_cursor.execute(
        """SELECT
             (SELECT COUNT(*) FROM goi_thau_phan_lo
               WHERE ma_phan_lo_normalized IS NULL),
             (SELECT COUNT(*) FROM thong_tin_mo_thau
               WHERE ma_phan_lo_normalized IS NULL)"""
    ).fetchone()
    assert tuple(null_counts) == (0, 0)
    index_definitions = [
        str(row[0])
        for row in realistic_upgrade_cursor.execute(
            """SELECT pg_get_indexdef(indexrelid)
                 FROM pg_index
                WHERE indexrelid IN (
                    'idx_goi_thau_phan_lo_active_code'::regclass,
                    'idx_thong_tin_mo_thau_active_business_key'::regclass
                )
                ORDER BY indexrelid::regclass::text"""
        ).fetchall()
    ]
    assert len(index_definitions) == 2
    assert all("lower(TRIM" not in definition for definition in index_definitions)
    assert all(
        "ma_phan_lo_normalized" in definition
        for definition in index_definitions
    )


def test_v36_operator_runbook_requires_preflight_dry_run_backup_and_quiescence():
    runbook = (
        Path(__file__).resolve().parents[1]
        / "deploy"
        / "runbooks"
        / "database-upgrade-v36.md"
    ).read_text(encoding="utf-8")

    for required in (
        "--preflight",
        "--dry-run",
        "rowsLoadedIntoPython",
        "relationBytes",
        "backup",
        "maintenance",
        "active-key collisions",
        "DATABASE_STATEMENT_TIMEOUT_MS",
        "DATABASE_LOCK_TIMEOUT_MS",
        "không sửa migration v36",
    ):
        assert required.casefold() in runbook.casefold()


def test_v49_v62_runbook_blocks_unapproved_v61_mapping_and_requires_rehearsal():
    runbook = (
        Path(__file__).resolve().parents[1]
        / "deploy"
        / "runbooks"
        / "database-upgrade-v49-v62.md"
    ).read_text(encoding="utf-8")

    for required in (
        "--preflight",
        "--dry-run",
        "backup",
        "restore",
        "maintenance",
        "v50BindingSnapshotUniqueness",
        "v54ObservationUniqueness",
        "v59WebsocketDispatchRewrite",
        "v61DefaultWorkspaceRename",
        "requiresApprovedTenantMapping",
        "automaticRemediationAllowed",
        "DATABASE_STATEMENT_TIMEOUT_MS",
        "DATABASE_LOCK_TIMEOUT_MS",
        "không sửa migration v61",
        "không tự động đổi",
    ):
        assert required.casefold() in runbook.casefold()
