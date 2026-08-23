"""Read-only cardinality checks for historically expensive database upgrades."""

from __future__ import annotations

from backend.db.upgrades import (
    DB_SCHEMA_VERSION,
    read_audit_successor_index_state,
    read_sync_metadata_version_bound_violations,
)


CANONICAL_LOT_CODE_MIGRATION_VERSION = 36
SYNC_METADATA_BOUNDS_MIGRATION_VERSION = 44
RETENTION_CLEANUP_INDEX_MIGRATION_VERSION = 45
HISTORICAL_CHAIN_RECONCILIATION_VERSION = 46
DUPLICATE_AUDIT_INDEX_MIGRATION_VERSION = 47
PROCUREMENT_PROVENANCE_MIGRATION_VERSION = 49
PROCUREMENT_BINDING_UNIQUENESS_MIGRATION_VERSION = 50
PROCUREMENT_OBSERVATION_UNIQUENESS_MIGRATION_VERSION = 54
WEBSOCKET_DISPATCH_MIGRATION_VERSION = 59
SYNCED_DELETE_SNAPSHOT_MIGRATION_VERSION = 60
DEFAULT_WORKSPACE_RENAME_MIGRATION_VERSION = 61
AI_MESSAGE_IDEMPOTENCY_MIGRATION_VERSION = 62
PROCUREMENT_OPERATION_IDEMPOTENCY_MIGRATION_VERSION = 63


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

    crosses_v47 = (
        current is not None
        and current < DUPLICATE_AUDIT_INDEX_MIGRATION_VERSION <= target
    )
    duplicate_audit_index_report: dict[str, object] = {
        "applies": crosses_v47,
        "requiresTransactionalDryRun": crosses_v47,
    }
    if crosses_v47:
        explicit_present, constraint_present, exact_duplicate = (
            read_audit_successor_index_state(cursor)
        )
        duplicate_audit_index_report.update({
            "explicitIndexPresent": explicit_present,
            "constraintBackedIndexPresent": constraint_present,
            "exactDuplicate": exact_duplicate,
        })

    crosses_v49_to_v62 = (
        current is not None
        and current < AI_MESSAGE_IDEMPOTENCY_MIGRATION_VERSION
        and target >= PROCUREMENT_PROVENANCE_MIGRATION_VERSION
    )
    later_upgrade_report = {
        "applies": crosses_v49_to_v62,
        "versions": [
            version
            for version in range(
                max((current or 0) + 1, PROCUREMENT_PROVENANCE_MIGRATION_VERSION),
                min(target, AI_MESSAGE_IDEMPOTENCY_MIGRATION_VERSION) + 1,
            )
        ] if crosses_v49_to_v62 else [],
        "requiresTransactionalDryRun": crosses_v49_to_v62,
        "requiresLockBudget": crosses_v49_to_v62,
    }

    crosses_v50 = (
        current is not None
        and current < PROCUREMENT_BINDING_UNIQUENESS_MIGRATION_VERSION <= target
    )
    binding_uniqueness_report = {
        "applies": crosses_v50,
        "duplicateGroups": 0,
        "requiresDataRepair": False,
    }
    if crosses_v50 and current >= PROCUREMENT_PROVENANCE_MIGRATION_VERSION:
        row = cursor.execute(
            """SELECT COUNT(*)
                 FROM (
                   SELECT 1
                     FROM procurement_source_binding
                    GROUP BY organization_id, provider, plan_revision_uuid,
                             id_detail, local_snapshot_id
                   HAVING COUNT(*) > 1
                 ) duplicate_groups"""
        ).fetchone()
        duplicate_groups = int(row[0]) if row else 0
        binding_uniqueness_report.update({
            "duplicateGroups": duplicate_groups,
            "requiresDataRepair": duplicate_groups > 0,
        })

    crosses_v54 = (
        current is not None
        and current < PROCUREMENT_OBSERVATION_UNIQUENESS_MIGRATION_VERSION <= target
    )
    observation_uniqueness_report = {
        "applies": crosses_v54,
        "duplicateObservationGroups": 0,
        "duplicateIdempotencyGroups": 0,
        "requiresDataRepair": False,
    }
    if crosses_v54 and current >= PROCUREMENT_PROVENANCE_MIGRATION_VERSION:
        row = cursor.execute(
            """SELECT
                 (SELECT COUNT(*) FROM (
                    SELECT 1 FROM procurement_source_revision
                     GROUP BY organization_id, provider, entity_kind,
                              revision_uuid, digest
                    HAVING COUNT(*) > 1
                  ) observation_duplicates),
                 (SELECT COUNT(*) FROM (
                    SELECT 1 FROM procurement_source_revision
                     GROUP BY organization_id, provider, idempotency_key,
                              revision_uuid, digest
                    HAVING COUNT(*) > 1
                  ) idempotency_duplicates)"""
        ).fetchone()
        observation_duplicates = int(row[0]) if row else 0
        idempotency_duplicates = int(row[1]) if row else 0
        observation_uniqueness_report.update({
            "duplicateObservationGroups": observation_duplicates,
            "duplicateIdempotencyGroups": idempotency_duplicates,
            "requiresDataRepair": bool(
                observation_duplicates or idempotency_duplicates
            ),
        })

    crosses_v59 = (
        current is not None
        and current < WEBSOCKET_DISPATCH_MIGRATION_VERSION <= target
    )
    websocket_dispatch_report = {
        "applies": crosses_v59,
        "requiresTransactionalDryRun": crosses_v59,
    }
    if crosses_v59:
        row = cursor.execute(
            """SELECT
                 COUNT(*),
                 COUNT(*) FILTER (WHERE status = 'delivered'),
                 COALESCE(
                   pg_total_relation_size(to_regclass('websocket_events')), 0
                 )
                 FROM websocket_events"""
        ).fetchone()
        websocket_dispatch_report.update({
            "eventRows": int(row[0]),
            "deliveredRowsToRewrite": int(row[1]),
            "relationBytes": int(row[2]),
        })

    crosses_v60 = (
        current is not None
        and current < SYNCED_DELETE_SNAPSHOT_MIGRATION_VERSION <= target
    )
    synced_delete_report = {
        "applies": crosses_v60,
        "requiresFunctionRehearsal": crosses_v60,
        "requiresRollbackRehearsal": crosses_v60,
    }

    crosses_v61 = (
        current is not None
        and current < DEFAULT_WORKSPACE_RENAME_MIGRATION_VERSION <= target
    )
    workspace_rename_report = {
        "applies": crosses_v61,
        "candidateOrganizations": 0,
        "organizationRows": 0,
        "requiresApprovedTenantMapping": False,
        "automaticRemediationAllowed": False,
    }
    if crosses_v61:
        row = cursor.execute(
            """SELECT
                 COUNT(*) FILTER (WHERE ten_to_chuc = 'HTD'),
                 COUNT(*)
                 FROM to_chuc"""
        ).fetchone()
        candidates = int(row[0])
        workspace_rename_report.update({
            "candidateOrganizations": candidates,
            "organizationRows": int(row[1]),
            "requiresApprovedTenantMapping": candidates > 0,
        })

    crosses_v62 = (
        current is not None
        and current < AI_MESSAGE_IDEMPOTENCY_MIGRATION_VERSION <= target
    )
    ai_idempotency_report = {
        "applies": crosses_v62,
        "requiresIndexBuildBudget": crosses_v62,
        "newColumnStartsNull": crosses_v62,
    }

    crosses_v63 = (
        current is not None
        and current < PROCUREMENT_OPERATION_IDEMPOTENCY_MIGRATION_VERSION <= target
    )
    procurement_operation_idempotency_report = {
        "applies": crosses_v63,
        "duplicateFamilyScopedGroups": 0,
        "requiresDataRepair": False,
        "requiresLockBudget": crosses_v63,
    }
    if crosses_v63:
        row = cursor.execute(
            """SELECT COUNT(*)
                 FROM (
                   SELECT 1
                     FROM procurement_import_operation
                    GROUP BY organization_id, provider, family_key,
                             idempotency_key
                   HAVING COUNT(*) > 1
                 ) duplicate_groups"""
        ).fetchone()
        duplicate_groups = int(row[0]) if row else 0
        procurement_operation_idempotency_report.update({
            "duplicateFamilyScopedGroups": duplicate_groups,
            "requiresDataRepair": duplicate_groups > 0,
        })

    return {
        "currentVersion": current,
        "targetVersion": target,
        "upgradeRequired": upgrade_required,
        "v36CanonicalLotCodes": lot_code_report,
        "v44SyncMetadataBounds": sync_metadata_report,
        "v45RetentionCleanupIndexes": retention_index_report,
        "v46HistoricalChain": historical_chain_report,
        "v47DuplicateAuditIndex": duplicate_audit_index_report,
        "v49ToV62Operational": later_upgrade_report,
        "v50BindingSnapshotUniqueness": binding_uniqueness_report,
        "v54ObservationUniqueness": observation_uniqueness_report,
        "v59WebsocketDispatchRewrite": websocket_dispatch_report,
        "v60SyncedDeleteSnapshot": synced_delete_report,
        "v61DefaultWorkspaceRename": workspace_rename_report,
        "v62AiMessageIdempotency": ai_idempotency_report,
        "v63ProcurementOperationIdempotency": (
            procurement_operation_idempotency_report
        ),
    }
