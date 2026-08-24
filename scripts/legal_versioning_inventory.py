"""Read-only inventory and reconciliation for immutable legal bindings."""

from __future__ import annotations

import argparse
import hashlib
import json
import sys
from pathlib import Path

from backend.db.db_helper import database


STATUSES = (
    "RESOLVED",
    "AMBIGUOUS",
    "UNRESOLVED",
    "MANUAL_REVIEW_REQUIRED",
)


def _hash(value):
    return hashlib.sha256(str(value).encode("utf-8")).hexdigest()


def summarize_target_bindings(total_targets, rows):
    status_counts = {status: 0 for status in STATUSES}
    stale_target_facts = 0
    bound_targets = 0
    unexpected_statuses = {}
    for status, target_row_version, binding_target_row_version in rows:
        bound_targets += 1
        status = str(status or "UNRESOLVED")
        if status in status_counts:
            status_counts[status] += 1
        else:
            unexpected_statuses[status] = unexpected_statuses.get(status, 0) + 1
        if int(target_row_version or 1) != int(binding_target_row_version or 0):
            stale_target_facts += 1
    return {
        "totalLiveTargets": int(total_targets),
        "boundTargets": bound_targets,
        "legacyUnboundTargets": max(0, int(total_targets) - bound_targets),
        "statusCounts": status_counts,
        "unexpectedStatusCounts": unexpected_statuses,
        "bindingsWithStaleTargetFacts": stale_target_facts,
    }


def verify_source_hash_rows(rows):
    mismatches = []
    for version_id, source_content, content_hash, relation_json, relation_hash in rows:
        failures = []
        if _hash(source_content or "") != str(content_hash or ""):
            failures.append("CONTENT_SHA256_MISMATCH")
        if _hash(relation_json or "") != str(relation_hash or ""):
            failures.append("RELATION_SHA256_MISMATCH")
        if failures:
            mismatches.append({"instrumentVersionId": version_id, "failures": failures})
    return mismatches


def _where(organization_id, *, alias="target"):
    if organization_id:
        return f" AND {alias}.organization_id = ?", (organization_id,)
    return "", ()


def _binding_report(cursor, target_type, organization_id):
    if target_type == "plan":
        target_table = "ke_hoach_lcnt"
        head_table = "plan_legal_binding_head"
        binding_table = "plan_legal_binding"
        target_column = "plan_id"
    else:
        target_table = "goi_thau"
        head_table = "package_legal_binding_head"
        binding_table = "package_legal_binding"
        target_column = "package_id"
    clause, parameters = _where(organization_id)
    total = cursor.execute(
        f"""SELECT COUNT(*) FROM {target_table} AS target
             WHERE target.archived_at IS NULL{clause}""",  # noqa: S608 - closed identifiers.
        parameters,
    ).fetchone()[0]
    rows = cursor.execute(
        f"""SELECT binding.status, target.row_version, binding.target_row_version
              FROM {target_table} AS target
              JOIN {head_table} AS head
                ON head.organization_id = target.organization_id
               AND head.{target_column} = target.id
              JOIN {binding_table} AS binding
                ON binding.organization_id = head.organization_id
               AND binding.id = head.current_binding_id
             WHERE target.archived_at IS NULL{clause}
             ORDER BY target.organization_id, target.id""",  # noqa: S608 - closed identifiers.
        parameters,
    ).fetchall()
    return summarize_target_bindings(total, rows)


def build_inventory_report(cursor, *, organization_id=None, verify_hashes=False):
    catalog = {
        "instrumentDrafts": int(cursor.execute(
            "SELECT COUNT(*) FROM legal_instrument_draft"
        ).fetchone()[0]),
        "instrumentVersions": int(cursor.execute(
            "SELECT COUNT(*) FROM legal_instrument_version"
        ).fetchone()[0]),
        "profileDrafts": int(cursor.execute(
            "SELECT COUNT(*) FROM legal_source_profile_draft"
        ).fetchone()[0]),
        "profileVersions": int(cursor.execute(
            "SELECT COUNT(*) FROM legal_source_profile_version"
        ).fetchone()[0]),
    }
    integrity = {"verified": bool(verify_hashes), "instrumentVersionMismatches": []}
    if verify_hashes:
        rows = cursor.execute(
            """SELECT id, source_content, content_sha256,
                      relation_manifest_json, relation_manifest_hash
                 FROM legal_instrument_version ORDER BY id"""
        ).fetchall()
        integrity["instrumentVersionMismatches"] = verify_source_hash_rows(rows)
    return {
        "schemaVersion": 1,
        "mode": "READ_ONLY_RECONCILIATION",
        "organizationId": organization_id,
        "legacyAutoBackfill": False,
        "catalog": catalog,
        "targets": {
            "plans": _binding_report(cursor, "plan", organization_id),
            "packages": _binding_report(cursor, "package", organization_id),
        },
        "integrity": integrity,
    }


def _arguments():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument(
        "--organization-id",
        help="Optional tenant filter. Omit only for an authorized SYSTEM-wide report.",
    )
    parser.add_argument(
        "--verify-hashes",
        action="store_true",
        help="Read and verify every immutable legal instrument body and relation hash.",
    )
    parser.add_argument("--output", type=Path)
    return parser.parse_args()


def main():
    args = _arguments()
    connection = database.get_connection()
    try:
        connection.execute("BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY")
        report = build_inventory_report(
            connection.cursor(),
            organization_id=str(args.organization_id or "").strip() or None,
            verify_hashes=args.verify_hashes,
        )
        connection.commit()
    except Exception:
        connection.rollback()
        raise
    finally:
        connection.close()
    rendered = json.dumps(report, ensure_ascii=False, indent=2, sort_keys=True)
    if args.output:
        args.output.parent.mkdir(parents=True, exist_ok=True)
        args.output.write_text(rendered + "\n", encoding="utf-8")
    sys.stdout.write(rendered + "\n")
    has_mismatch = bool(report["integrity"]["instrumentVersionMismatches"])
    return 2 if has_mismatch else 0


if __name__ == "__main__":
    raise SystemExit(main())
