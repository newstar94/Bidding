"""Read-only cardinality checks for historically expensive database upgrades."""

from __future__ import annotations

from backend.db.upgrades import (
    DB_SCHEMA_VERSION,
    read_sync_metadata_version_bound_violations,
)


CANONICAL_LOT_CODE_MIGRATION_VERSION = 36
SYNC_METADATA_BOUNDS_MIGRATION_VERSION = 44
RETENTION_CLEANUP_INDEX_MIGRATION_VERSION = 45
HISTORICAL_CHAIN_RECONCILIATION_VERSION = 46


def inspect_database_upgrade(
    cursor,
    current_version: int | None,
    *,
    target_version: int = DB_SCHEMA_VERSION,
) -> dict[str, object]:
    """Describe upgrade work without acquiring DDL locks or mutating schema."""

    current = None if current_version is None else int(current_version)
    target = int(target_version)
    upgrade_required = current is not None and current < target
    crosses_v36 = (
        current is not None
        and current < CANONICAL_LOT_CODE_MIGRATION_VERSION <= target
    )
    lot_code_report: dict[str, object] = {
        "applies": crosses_v36,
        "requiresTransactionalDryRun": crosses_v36,
    }
    if crosses_v36:
        row = cursor.execute(
            """SELECT
                 (SELECT COUNT(*) FROM goi_thau_phan_lo),
                 (SELECT COUNT(*) FILTER (WHERE archived_at IS NULL)
                    FROM goi_thau_phan_lo),
                 (SELECT COUNT(*) FROM thong_tin_mo_thau),
                 (SELECT COUNT(*) FILTER (WHERE archived_at IS NULL)
                    FROM thong_tin_mo_thau),
                 COALESCE(
                    pg_total_relation_size(
                        to_regclass('goi_thau_phan_lo')
                    ), 0
                 ),
                 COALESCE(
                    pg_total_relation_size(
                        to_regclass('thong_tin_mo_thau')
                    ), 0
                 )"""
        ).fetchone()
        if row is None:
            raise RuntimeError("Database upgrade preflight returned no cardinality row.")
        lot_rows = int(row[0])
        active_lot_rows = int(row[1])
        opening_rows = int(row[2])
        active_opening_rows = int(row[3])
        lot_code_report.update({
            "lotRows": lot_rows,
            "activeLotRows": active_lot_rows,
            "openingRows": opening_rows,
            "activeOpeningRows": active_opening_rows,
            "rowsLoadedIntoPython": lot_rows + opening_rows,
            "relationBytes": int(row[4]) + int(row[5]),
        })

    crosses_v44 = (
        current is not None
        and current < SYNC_METADATA_BOUNDS_MIGRATION_VERSION <= target
    )
    sync_metadata_report: dict[str, object] = {
        "applies": crosses_v44,
        "requiresDataRepair": False,
    }
    if crosses_v44:
        negative_current, minimum_ahead = (
            read_sync_metadata_version_bound_violations(cursor)
        )
        sync_metadata_report.update({
            "currentVersionNegativeRows": negative_current,
            "minimumVersionAheadRows": minimum_ahead,
            "requiresDataRepair": bool(negative_current or minimum_ahead),
        })

    crosses_v45 = (
        current is not None
        and current < RETENTION_CLEANUP_INDEX_MIGRATION_VERSION <= target
    )
    retention_index_report: dict[str, object] = {
        "applies": crosses_v45,
        "requiresTransactionalDryRun": crosses_v45,
    }
    if crosses_v45:
        row = cursor.execute(
            """SELECT
                 (SELECT COUNT(*) FROM deleted_records),
                 (SELECT COUNT(*) FROM sync_mutations),
                 (SELECT COUNT(*) FROM partner_enrichment_jobs
                   WHERE status IN ('completed', 'failed')),
                 COALESCE(
                    pg_total_relation_size(to_regclass('deleted_records')), 0
                 ),
                 COALESCE(
                    pg_total_relation_size(to_regclass('sync_mutations')), 0
                 ),
                 COALESCE(
                    pg_total_relation_size(
                        to_regclass('partner_enrichment_jobs')
                    ), 0
                 )"""
        ).fetchone()
        if row is None:
            raise RuntimeError(
                "Database upgrade preflight returned no retention cardinality row."
            )
        retention_index_report.update({
            "deletedRecordsRows": int(row[0]),
            "syncMutationsRows": int(row[1]),
            "terminalPartnerJobRows": int(row[2]),
            "relationBytes": int(row[3]) + int(row[4]) + int(row[5]),
        })

    crosses_v46 = (
        current is not None
        and current < HISTORICAL_CHAIN_RECONCILIATION_VERSION <= target
    )
    historical_chain_report = {
        "applies": crosses_v46,
        "requiresTransactionalDryRun": crosses_v46,
        "requiresCatalogReconciliation": crosses_v46,
    }

    return {
        "currentVersion": current,
        "targetVersion": target,
        "upgradeRequired": upgrade_required,
        "v36CanonicalLotCodes": lot_code_report,
        "v44SyncMetadataBounds": sync_metadata_report,
        "v45RetentionCleanupIndexes": retention_index_report,
        "v46HistoricalChain": historical_chain_report,
    }
