"""Visibility-scoped metadata for version lineages."""

from __future__ import annotations


VERSIONED_TABLES = frozenset(
    {
        "chu_dau_tu",
        "ke_hoach_lcnt",
        "goi_thau",
        "nha_thau",
        "hop_dong",
        "chuyen_gia",
    }
)


def load_visible_version_metadata(
    cursor,
    visibility_scope,
    table_name,
    lineage_roots,
    *,
    plan_snapshot_id=None,
):
    """Return only versions individually readable through the canonical scope."""

    if table_name not in VERSIONED_TABLES:
        return {}
    roots = list(dict.fromkeys(
        str(value).strip() for value in lineage_roots if str(value).strip()
    ))
    if not roots:
        return {}
    placeholders = ", ".join("?" for _ in roots)
    predicate = visibility_scope.live_predicate(table_name, "version_row")
    clauses = [
        predicate.sql,
        "version_row.archived_at IS NULL",
        "COALESCE(NULLIF(version_row.id_goc, ''), version_row.id) "
        f"IN ({placeholders})",
    ]
    parameters = [*predicate.parameters, *roots]
    if table_name == "goi_thau" and plan_snapshot_id:
        clauses.append("version_row.ke_hoach_id = ?")
        parameters.append(str(plan_snapshot_id))

    rows = cursor.execute(
        f"""SELECT version_row.id,
                   COALESCE(NULLIF(version_row.id_goc, ''), version_row.id),
                   version_row.phien_ban
              FROM {table_name} AS version_row
             WHERE {" AND ".join(clauses)}
             ORDER BY CAST(COALESCE(version_row.phien_ban, 0) AS INTEGER) DESC,
                      version_row.id""",  # noqa: S608 - table allowlisted; predicate registry-built.
        tuple(parameters),
    ).fetchall()
    versions_by_root = {root: [] for root in roots}
    for row in rows:
        root = str(row[1])
        versions_by_root.setdefault(root, []).append(
            {"id": row[0], "phienBan": row[2]}
        )
    return versions_by_root
