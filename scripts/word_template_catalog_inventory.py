"""Inventory legacy Word templates into the immutable catalog shadow."""

from __future__ import annotations

import argparse
import hashlib
import json
import sys
from pathlib import Path

from backend.db.db_helper import database
from backend.documents import custom_exporter
from backend.documents.template_catalog.compatibility import (
    LegacyTemplateInventory,
    catalog_enabled,
    catalog_mode,
)
from backend.documents.template_catalog.repository import (
    WordTemplateCatalogRepository,
)
from backend.documents.template_catalog.storage import ImmutableTemplateStorage


def _arguments():
    parser = argparse.ArgumentParser(
        description=(
            "Inspect a legacy Word-template scope or apply the exact inventory "
            "to the catalog while WORD_TEMPLATE_CATALOG_MODE=shadow."
        )
    )
    parser.add_argument("--organization-id", required=True)
    parser.add_argument("--owner-type", choices=("organization", "personal"), required=True)
    parser.add_argument("--owner-id", required=True)
    parser.add_argument("--actor-user-id", help="Required with --apply.")
    parser.add_argument("--apply", action="store_true")
    parser.add_argument("--output", type=Path)
    return parser.parse_args()


def _legacy_report(args):
    scope_dir = Path(custom_exporter.get_scope_template_dir(
        args.owner_type, args.owner_id, create=False,
    )).resolve()
    templates = []
    if scope_dir.exists():
        for path in sorted(scope_dir.iterdir(), key=lambda item: item.name.casefold()):
            if path.is_symlink() or not path.is_file() or path.suffix.casefold() != ".docx":
                continue
            content = path.read_bytes()
            templates.append({
                "legacyAlias": path.name,
                "sha256": hashlib.sha256(content).hexdigest(),
                "byteSize": len(content),
            })
    return {
        "schemaVersion": 1,
        "mode": "inspect",
        "organizationId": args.organization_id,
        "ownerType": args.owner_type,
        "ownerId": args.owner_id,
        "configRevision": custom_exporter.get_template_config_revision(
            args.owner_id, owner_type=args.owner_type,
        ),
        "templates": templates,
        "assignments": custom_exporter.get_template_assignments(
            args.owner_id, owner_type=args.owner_type,
        ),
    }


def _apply_inventory(args):
    if not args.actor_user_id:
        raise SystemExit("--actor-user-id is required with --apply")
    if not catalog_enabled() or catalog_mode() != "shadow":
        raise SystemExit(
            "Inventory apply requires WORD_TEMPLATE_CATALOG_ENABLED=true and mode=shadow."
        )
    connection = database.get_connection()
    try:
        connection.execute("BEGIN")
        repository = WordTemplateCatalogRepository(connection.cursor())
        report = LegacyTemplateInventory(
            repository, ImmutableTemplateStorage(),
        ).inventory_scope(
            organization_id=args.organization_id,
            owner_type=args.owner_type,
            owner_id=args.owner_id,
            actor_user_id=args.actor_user_id,
        )
        if not report["parity"]:
            connection.rollback()
            report["committed"] = False
            return report
        connection.commit()
        report["committed"] = True
        return report
    except Exception:
        connection.rollback()
        raise
    finally:
        connection.close()


def main():
    args = _arguments()
    report = _apply_inventory(args) if args.apply else _legacy_report(args)
    rendered = json.dumps(report, ensure_ascii=False, indent=2, sort_keys=True)
    if args.output:
        args.output.parent.mkdir(parents=True, exist_ok=True)
        args.output.write_text(rendered + "\n", encoding="utf-8")
    sys.stdout.write(rendered + "\n")
    return 0 if not args.apply or report.get("committed") else 2


if __name__ == "__main__":
    raise SystemExit(main())
