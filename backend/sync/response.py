"""Commit and serialize a successful synchronization transaction."""

import json

from backend.sync.queries import build_dashboard_summary
from backend.sync.repository import get_current_sync_version


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
    conn.commit()
    return response
