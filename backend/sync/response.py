"""Commit and serialize a successful synchronization transaction."""

import json

from backend.sync.queries import build_dashboard_summary
from backend.sync.repository import get_current_sync_version
from backend.sync.websocket import enqueue_websocket_event


def commit_sync_response(
    conn,
    cursor,
    *,
    organization_id,
    actor_user_id,
    actor_role,
    current_time,
    client_mutation_id,
    request_hash,
    include_dashboard_summary,
    updated_row_versions,
    delete_impacts,
    orphaned_ids,
    procurement_import=None,
):
    response = {
        "status": "success",
        "timestamp": current_time,
        "syncVersion": get_current_sync_version(cursor, organization_id),
    }
    if updated_row_versions:
        response["rowVersions"] = updated_row_versions
    if delete_impacts:
        response["deleteImpacts"] = delete_impacts
    if include_dashboard_summary:
        response["dashboardSummary"] = build_dashboard_summary(
            cursor, organization_id, actor_role, actor_user_id
        )
    if orphaned_ids:
        response["orphanedIds"] = orphaned_ids
    if procurement_import:
        response["procurementImport"] = procurement_import
    if client_mutation_id:
        cursor.execute(
            "INSERT INTO sync_mutations "
            "(organization_id, actor_user_id, client_mutation_id, request_hash, response_json) "
            "VALUES (?, ?, ?, ?, ?) "
            "ON CONFLICT (organization_id, actor_user_id, client_mutation_id) "
            "DO NOTHING",
            (
                organization_id,
                actor_user_id,
                client_mutation_id,
                request_hash,
                json.dumps(response),
            ),
        )
    enqueue_websocket_event(
        cursor,
        "broadcast",
        organization_id=organization_id,
        payload={"event": "db_changed"},
    )
    conn.commit()
    return response
