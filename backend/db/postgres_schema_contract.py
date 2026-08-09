"""Normalized PostgreSQL catalog contract reader and comparator.

The contract deliberately rejects unexpected application tables, columns,
constraints, indexes, and non-internal triggers.  Extension-owned functions,
types, sequences, and internal PostgreSQL triggers remain outside the policy:
they are either implementation details of PostgreSQL or independently managed
operational objects.
"""

from __future__ import annotations

from collections.abc import Mapping
from importlib.resources import files
import json
from typing import Any


CATALOG_CONTRACT_VERSION = 1
DEFAULT_DIAGNOSTIC_LIMIT = 12


def _display(value: object, *, limit: int = 240) -> str:
    rendered = repr(value)
    if len(rendered) <= limit:
        return rendered
    return rendered[: limit - 3] + "..."


def _collect_catalog_drift(
    expected: object,
    actual: object,
    path: str,
    drift: list[str],
) -> None:
    if isinstance(expected, Mapping) and isinstance(actual, Mapping):
        expected_keys = set(expected)
        actual_keys = set(actual)
        for key in sorted(expected_keys - actual_keys, key=str):
            child_path = f"{path}.{key}" if path else str(key)
            drift.append(
                f"{child_path}: missing; expected={_display(expected[key])}"
            )
        for key in sorted(actual_keys - expected_keys, key=str):
            child_path = f"{path}.{key}" if path else str(key)
            drift.append(
                f"{child_path}: unexpected; actual={_display(actual[key])}"
            )
        for key in sorted(expected_keys & actual_keys, key=str):
            child_path = f"{path}.{key}" if path else str(key)
            _collect_catalog_drift(
                expected[key],
                actual[key],
                child_path,
                drift,
            )
        return

    if expected != actual or type(expected) is not type(actual):
        drift.append(
            f"{path}: expected={_display(expected)}, actual={_display(actual)}"
        )


def schema_catalog_drift(
    expected: Mapping[str, Any],
    actual: Mapping[str, Any],
) -> tuple[str, ...]:
    """Return deterministic leaf-level differences between two catalogs."""

    drift: list[str] = []
    _collect_catalog_drift(expected, actual, "", drift)
    return tuple(drift)


def assert_catalog_contract(
    expected: Mapping[str, Any],
    actual: Mapping[str, Any],
    *,
    diagnostic_limit: int = DEFAULT_DIAGNOSTIC_LIMIT,
) -> None:
    """Raise one bounded startup error when the normalized catalog drifts."""

    drift = schema_catalog_drift(expected, actual)
    if not drift:
        return
    limit = max(1, int(diagnostic_limit))
    displayed = list(drift[:limit])
    remaining = len(drift) - len(displayed)
    suffix = ""
    if remaining:
        noun = "difference" if remaining == 1 else "differences"
        suffix = f"; {remaining} additional {noun}"
    raise RuntimeError(
        "Normalized PostgreSQL schema drift: " + "; ".join(displayed) + suffix
    )


def _normalize_schema_qualifier(
    definition: str | None,
    schema_name: str,
    quoted_schema_name: str,
) -> str | None:
    if definition is None:
        return None
    normalized = str(definition)
    for qualifier in (f"{quoted_schema_name}.", f"{schema_name}."):
        normalized = normalized.replace(qualifier, "$SCHEMA.")
    normalized = normalized.replace(" public.gin_trgm_ops", " gin_trgm_ops")
    return normalized


def read_postgres_schema_catalog(cursor) -> dict[str, Any]:
    """Read the application schema into the stable, PostgreSQL-deparsed form."""

    schema_row = cursor.execute(
        """SELECT current_schema(), quote_ident(current_schema()),
                  current_setting('server_version_num')::integer / 10000"""
    ).fetchone()
    schema_name = str(schema_row[0] or "")
    quoted_schema_name = str(schema_row[1] or "")
    if not schema_name:
        raise RuntimeError("PostgreSQL current_schema() is empty.")

    table_rows = cursor.execute(
        """SELECT relation.relname, relation.relpersistence,
                  relation.relrowsecurity
             FROM pg_class AS relation
             JOIN pg_namespace AS namespace
               ON namespace.oid = relation.relnamespace
            WHERE namespace.nspname = current_schema()
              AND relation.relkind IN ('r', 'p')
            ORDER BY relation.relname"""
    ).fetchall()
    tables: dict[str, dict[str, Any]] = {
        str(row[0]): {
            "persistence": str(row[1]),
            "rowSecurity": bool(row[2]),
            "columns": {},
            "constraints": {},
        }
        for row in table_rows
    }

    column_rows = cursor.execute(
        """SELECT relation.relname, attribute.attname,
                  format_type(attribute.atttypid, attribute.atttypmod),
                  attribute.attnotnull,
                  pg_get_expr(default_value.adbin, default_value.adrelid, true),
                  attribute.attidentity, attribute.attgenerated
             FROM pg_attribute AS attribute
             JOIN pg_class AS relation ON relation.oid = attribute.attrelid
             JOIN pg_namespace AS namespace
               ON namespace.oid = relation.relnamespace
        LEFT JOIN pg_attrdef AS default_value
               ON default_value.adrelid = attribute.attrelid
              AND default_value.adnum = attribute.attnum
            WHERE namespace.nspname = current_schema()
              AND relation.relkind IN ('r', 'p')
              AND attribute.attnum > 0
              AND NOT attribute.attisdropped
            ORDER BY relation.relname, attribute.attnum"""
    ).fetchall()
    for row in column_rows:
        table_name = str(row[0])
        tables[table_name]["columns"][str(row[1])] = {
            "type": str(row[2]),
            "notNull": bool(row[3]),
            "default": _normalize_schema_qualifier(
                row[4], schema_name, quoted_schema_name
            ),
            "identity": str(row[5] or ""),
            "generated": str(row[6] or ""),
        }

    constraint_rows = cursor.execute(
        """SELECT relation.relname, constraint_record.conname,
                  constraint_record.contype,
                  pg_get_constraintdef(constraint_record.oid, true),
                  constraint_record.convalidated,
                  constraint_record.condeferrable,
                  constraint_record.condeferred
             FROM pg_constraint AS constraint_record
             JOIN pg_class AS relation
               ON relation.oid = constraint_record.conrelid
             JOIN pg_namespace AS namespace
               ON namespace.oid = relation.relnamespace
            WHERE namespace.nspname = current_schema()
              AND relation.relkind IN ('r', 'p')
            ORDER BY relation.relname, constraint_record.conname"""
    ).fetchall()
    for row in constraint_rows:
        table_name = str(row[0])
        tables[table_name]["constraints"][str(row[1])] = {
            "kind": str(row[2]),
            "definition": _normalize_schema_qualifier(
                row[3], schema_name, quoted_schema_name
            ),
            "validated": bool(row[4]),
            "deferrable": bool(row[5]),
            "initiallyDeferred": bool(row[6]),
        }

    index_rows = cursor.execute(
        """SELECT table_relation.relname, index_relation.relname,
                  pg_get_indexdef(index_record.indexrelid),
                  index_record.indisvalid, index_record.indisready,
                  index_record.indislive
             FROM pg_index AS index_record
             JOIN pg_class AS index_relation
               ON index_relation.oid = index_record.indexrelid
             JOIN pg_class AS table_relation
               ON table_relation.oid = index_record.indrelid
             JOIN pg_namespace AS namespace
               ON namespace.oid = table_relation.relnamespace
            WHERE namespace.nspname = current_schema()
              AND table_relation.relkind IN ('r', 'p')
            ORDER BY index_relation.relname"""
    ).fetchall()
    indexes = {
        str(row[1]): {
            "table": str(row[0]),
            "definition": _normalize_schema_qualifier(
                row[2], schema_name, quoted_schema_name
            ),
            "valid": bool(row[3]),
            "ready": bool(row[4]),
            "live": bool(row[5]),
        }
        for row in index_rows
    }

    trigger_rows = cursor.execute(
        """SELECT relation.relname, trigger_record.tgname,
                  pg_get_triggerdef(trigger_record.oid, true),
                  trigger_record.tgenabled
             FROM pg_trigger AS trigger_record
             JOIN pg_class AS relation
               ON relation.oid = trigger_record.tgrelid
             JOIN pg_namespace AS namespace
               ON namespace.oid = relation.relnamespace
            WHERE namespace.nspname = current_schema()
              AND relation.relkind IN ('r', 'p')
              AND NOT trigger_record.tgisinternal
            ORDER BY relation.relname, trigger_record.tgname"""
    ).fetchall()
    triggers = {
        f"{row[0]}.{row[1]}": {
            "table": str(row[0]),
            "definition": _normalize_schema_qualifier(
                row[2], schema_name, quoted_schema_name
            ),
            "enabled": str(row[3]),
        }
        for row in trigger_rows
    }

    schema_version = None
    if "database_metadata" in tables:
        version_row = cursor.execute(
            "SELECT schema_version FROM database_metadata WHERE id = 1"
        ).fetchone()
        if version_row is not None:
            schema_version = int(version_row[0])

    return {
        "contractVersion": CATALOG_CONTRACT_VERSION,
        "postgresMajor": int(schema_row[2]),
        "schemaVersion": schema_version,
        "tables": tables,
        "indexes": indexes,
        "triggers": triggers,
    }


def load_expected_postgres_schema_catalog() -> Mapping[str, Any]:
    """Load the generated PostgreSQL 17 catalog snapshot lazily."""

    resource = files("backend.db").joinpath("postgres_schema_contract.json")
    return json.loads(resource.read_text(encoding="utf-8"))
