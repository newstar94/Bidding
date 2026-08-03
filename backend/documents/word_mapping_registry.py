"""Resolve shared Word mappings with sparse scope-owned customization."""

from __future__ import annotations

from functools import lru_cache

from backend.db.id_utils import generate_record_id
from backend.documents.word_defaults import (
    WORD_DEFAULT_MAPPINGS_VERSION,
    _is_default_mapping_description,
    _stable_word_mapping_id,
    build_default_word_mappings,
)
from backend.shared.workspace_scope import personal_scope_owner_id


SYSTEM_MAPPING_ID_PREFIX = "word-default:"


def _row_dict(row, columns=()):
    if row is None:
        return None
    if hasattr(row, "keys"):
        return {key: row[key] for key in row.keys()}
    return dict(zip(columns, row))


@lru_cache(maxsize=1)
def _catalog():
    return tuple(build_default_word_mappings())


@lru_cache(maxsize=1)
def _catalog_by_key():
    return {mapping["mapping_key"]: mapping for mapping in _catalog()}


def _system_mapping_id(mapping_key):
    return f"{SYSTEM_MAPPING_ID_PREFIX}{mapping_key}"


def _system_mapping_key(mapping_id):
    value = str(mapping_id or "")
    if not value.startswith(SYSTEM_MAPPING_ID_PREFIX):
        return None
    return value[len(SYSTEM_MAPPING_ID_PREFIX):]


def _owner_type(scope_id):
    return "personal" if personal_scope_owner_id(scope_id) else "organization"


def _load_overrides(cursor, scope_id):
    rows = cursor.execute(
        """SELECT organization_id, owner_type, mapping_key,
                  ten_bien_override, source_table_override,
                  source_column_override, mo_ta_override, disabled, base_version
           FROM word_mapping_overrides
           WHERE organization_id = ?""",
        (scope_id,),
    ).fetchall()
    columns = (
        "organization_id",
        "owner_type",
        "mapping_key",
        "ten_bien_override",
        "source_table_override",
        "source_column_override",
        "mo_ta_override",
        "disabled",
        "base_version",
    )
    return {
        value["mapping_key"]: value
        for value in (_row_dict(row, columns) for row in rows)
    }


def _load_custom_mappings(cursor, scope_id):
    rows = cursor.execute(
        """SELECT id, organization_id, owner_type, ten_bien,
                  source_table, source_column, mo_ta
           FROM cau_hinh_bien_word
           WHERE organization_id = ?
           ORDER BY id""",
        (scope_id,),
    ).fetchall()
    columns = (
        "id",
        "organization_id",
        "owner_type",
        "ten_bien",
        "source_table",
        "source_column",
        "mo_ta",
    )
    return [_row_dict(row, columns) for row in rows]


def resolve_word_mappings(cursor, scope_id, *, include_disabled=False):
    """Return effective system, overridden, and custom mappings for one scope."""

    overrides = _load_overrides(cursor, scope_id)
    effective = []
    for default in _catalog():
        override = overrides.get(default["mapping_key"])
        disabled = bool(override and override.get("disabled"))
        if disabled and not include_disabled:
            continue
        mapping = {
            "id": _system_mapping_id(default["mapping_key"]),
            "organization_id": scope_id,
            "owner_type": override.get("owner_type") if override else _owner_type(scope_id),
            "mapping_key": default["mapping_key"],
            "ten_bien": default["ten_bien"],
            "source_table": default["source_table"],
            "source_column": default["source_column"],
            "mo_ta": default.get("mo_ta") or "",
            "origin": "system",
            "is_modified": False,
            "disabled": disabled,
            "base_version": WORD_DEFAULT_MAPPINGS_VERSION,
        }
        if override:
            for target, source in (
                ("ten_bien", "ten_bien_override"),
                ("source_table", "source_table_override"),
                ("source_column", "source_column_override"),
                ("mo_ta", "mo_ta_override"),
            ):
                if override.get(source) is not None:
                    mapping[target] = override[source]
            mapping["origin"] = "override"
            mapping["is_modified"] = True
            mapping["base_version"] = override.get("base_version") or WORD_DEFAULT_MAPPINGS_VERSION
        effective.append(mapping)

    for custom in _load_custom_mappings(cursor, scope_id):
        custom.update({
            "mapping_key": None,
            "origin": "custom",
            "is_modified": True,
            "disabled": False,
            "base_version": None,
        })
        effective.append(custom)
    return effective


def _find_system_default(mapping_id, source_table, source_column):
    catalog = _catalog()
    mapping_key = _system_mapping_key(mapping_id)
    if mapping_key:
        default = _catalog_by_key().get(mapping_key)
        if not default:
            raise ValueError("Ánh xạ mặc định không tồn tại.")
        return default
    if mapping_id:
        return None
    return next(
        (
            mapping for mapping in catalog
            if mapping["source_table"] == source_table
            and mapping["source_column"] == source_column
        ),
        None,
    )


def _assert_unique_effective_mapping(
    cursor,
    scope_id,
    target_id,
    ten_bien,
    source_table,
    source_column,
):
    for mapping in resolve_word_mappings(cursor, scope_id):
        if mapping["id"] == target_id:
            continue
        if str(mapping["ten_bien"]).casefold() == str(ten_bien).casefold():
            raise ValueError("Tên biến Word đã tồn tại trong phạm vi hiện hành.")
        if (
            mapping["source_table"] == source_table
            and mapping["source_column"] == source_column
        ):
            raise ValueError("Nguồn dữ liệu đã có một ánh xạ Word.")


def _upsert_override(
    cursor,
    scope_id,
    owner_type,
    mapping_key,
    *,
    ten_bien_override=None,
    source_table_override=None,
    source_column_override=None,
    mo_ta_override=None,
    disabled=False,
):
    cursor.execute(
        """INSERT INTO word_mapping_overrides (
               organization_id, owner_type, mapping_key,
               ten_bien_override, source_table_override,
               source_column_override, mo_ta_override,
               disabled, base_version
           ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
           ON CONFLICT(organization_id, mapping_key) DO UPDATE SET
               owner_type = excluded.owner_type,
               ten_bien_override = excluded.ten_bien_override,
               source_table_override = excluded.source_table_override,
               source_column_override = excluded.source_column_override,
               mo_ta_override = excluded.mo_ta_override,
               disabled = excluded.disabled,
               base_version = excluded.base_version,
               updated_at = CURRENT_TIMESTAMP""",
        (
            scope_id,
            owner_type,
            mapping_key,
            ten_bien_override,
            source_table_override,
            source_column_override,
            mo_ta_override,
            1 if disabled else 0,
            WORD_DEFAULT_MAPPINGS_VERSION,
        ),
    )


def save_word_mapping(
    cursor,
    scope_id,
    owner_type,
    *,
    mapping_id,
    ten_bien,
    source_table,
    source_column,
    mo_ta=None,
):
    """Save one mapping as a sparse override or a scope-owned custom row."""

    default = _find_system_default(mapping_id, source_table, source_column)
    if default:
        target_id = _system_mapping_id(default["mapping_key"])
        current = next(
            (
                mapping for mapping in resolve_word_mappings(
                    cursor,
                    scope_id,
                    include_disabled=True,
                )
                if mapping["id"] == target_id
            ),
            default,
        )
        desired_description = current.get("mo_ta", "") if mo_ta is None else mo_ta
        _assert_unique_effective_mapping(
            cursor,
            scope_id,
            target_id,
            ten_bien,
            source_table,
            source_column,
        )
        differences = {
            "ten_bien_override": ten_bien if ten_bien != default["ten_bien"] else None,
            "source_table_override": (
                source_table if source_table != default["source_table"] else None
            ),
            "source_column_override": (
                source_column if source_column != default["source_column"] else None
            ),
            "mo_ta_override": (
                desired_description
                if desired_description != (default.get("mo_ta") or "")
                else None
            ),
        }
        if not any(value is not None for value in differences.values()):
            cursor.execute(
                """DELETE FROM word_mapping_overrides
                   WHERE organization_id = ? AND mapping_key = ?""",
                (scope_id, default["mapping_key"]),
            )
        else:
            _upsert_override(
                cursor,
                scope_id,
                owner_type,
                default["mapping_key"],
                **differences,
            )
        return next(
            mapping for mapping in resolve_word_mappings(cursor, scope_id)
            if mapping["id"] == target_id
        )

    target_id = str(mapping_id or "").strip() or generate_record_id(
        "cau_hinh_bien_word"
    )
    _assert_unique_effective_mapping(
        cursor,
        scope_id,
        target_id,
        ten_bien,
        source_table,
        source_column,
    )
    existing = cursor.execute(
        """SELECT mo_ta FROM cau_hinh_bien_word
           WHERE id = ? AND organization_id = ?""",
        (target_id, scope_id),
    ).fetchone()
    if mapping_id and not existing:
        raise ValueError("Không tìm thấy ánh xạ Word cần cập nhật.")
    description = (
        (_row_dict(existing, ("mo_ta",)).get("mo_ta") or "")
        if mo_ta is None and existing
        else (mo_ta or "")
    )
    if existing:
        cursor.execute(
            """UPDATE cau_hinh_bien_word
               SET ten_bien = ?, source_table = ?, source_column = ?,
                   mo_ta = ?
               WHERE id = ? AND organization_id = ?""",
            (
                ten_bien,
                source_table,
                source_column,
                description,
                target_id,
                scope_id,
            ),
        )
    else:
        cursor.execute(
            """INSERT INTO cau_hinh_bien_word (
                   id, organization_id, owner_type, ten_bien,
                   source_table, source_column, mo_ta
               ) VALUES (?, ?, ?, ?, ?, ?, ?)""",
            (
                target_id,
                scope_id,
                owner_type,
                ten_bien,
                source_table,
                source_column,
                description,
            ),
        )
    return next(
        mapping for mapping in resolve_word_mappings(cursor, scope_id)
        if mapping["id"] == target_id
    )


def delete_word_mapping(cursor, scope_id, owner_type, mapping_id):
    """Hide a system mapping or physically delete a scope-owned custom mapping."""

    mapping_key = _system_mapping_key(mapping_id)
    if mapping_key:
        if mapping_key not in _catalog_by_key():
            raise ValueError("Ánh xạ mặc định không tồn tại.")
        _upsert_override(
            cursor,
            scope_id,
            owner_type,
            mapping_key,
            disabled=True,
        )
        return {"action": "disabled", "id": mapping_id}
    cursor.execute(
        "DELETE FROM cau_hinh_bien_word WHERE id = ? AND organization_id = ?",
        (mapping_id, scope_id),
    )
    if not cursor.rowcount:
        raise ValueError("Không tìm thấy ánh xạ Word cần xóa.")
    return {"action": "deleted", "id": mapping_id}


def reset_word_mapping(cursor, scope_id, mapping_id):
    """Remove a sparse override so the scope inherits the shared default again."""

    mapping_key = _system_mapping_key(mapping_id)
    if not mapping_key or mapping_key not in _catalog_by_key():
        raise ValueError("Chỉ ánh xạ hệ thống mới có thể khôi phục mặc định.")
    cursor.execute(
        """DELETE FROM word_mapping_overrides
           WHERE organization_id = ? AND mapping_key = ?""",
        (scope_id, mapping_key),
    )
    return {"action": "reset", "id": mapping_id}


def migrate_seeded_word_mappings(cursor):
    """Compact legacy per-scope defaults into overrides and tombstones."""

    seed_rows = cursor.execute(
        "SELECT organization_id, mappings_version FROM word_default_seeds"
    ).fetchall()
    seed_columns = ("organization_id", "mappings_version")
    defaults = _catalog()
    result = {
        "scopes": 0,
        "removed_default_rows": 0,
        "override_rows": 0,
        "tombstones": 0,
    }
    for raw_seed in seed_rows:
        seed = _row_dict(raw_seed, seed_columns)
        scope_id = seed["organization_id"]
        owner_type = _owner_type(scope_id)
        rows = cursor.execute(
            """SELECT id, organization_id, owner_type, ten_bien,
                      source_table, source_column, mo_ta
               FROM cau_hinh_bien_word WHERE organization_id = ?""",
            (scope_id,),
        ).fetchall()
        columns = (
            "id",
            "organization_id",
            "owner_type",
            "ten_bien",
            "source_table",
            "source_column",
            "mo_ta",
        )
        legacy = [_row_dict(row, columns) for row in rows]
        by_id = {row["id"]: row for row in legacy}
        by_source = {
            (row["source_table"], row["source_column"]): row for row in legacy
        }
        by_name = {str(row["ten_bien"]).casefold(): row for row in legacy}
        consumed = set()
        for default in defaults:
            row = by_id.get(
                _stable_word_mapping_id(scope_id, default["ten_bien"])
            )
            if row is None or row["id"] in consumed:
                row = by_source.get(
                    (default["source_table"], default["source_column"])
                )
            if row is None or row["id"] in consumed:
                row = by_name.get(str(default["ten_bien"]).casefold())
            if row is not None and row["id"] in consumed:
                row = None

            if row is None:
                if int(seed["mappings_version"]) >= WORD_DEFAULT_MAPPINGS_VERSION:
                    _upsert_override(
                        cursor,
                        scope_id,
                        owner_type,
                        default["mapping_key"],
                        disabled=True,
                    )
                    result["override_rows"] += 1
                    result["tombstones"] += 1
                continue

            consumed.add(row["id"])
            if not _is_default_mapping_description(row.get("mo_ta")):
                differences = {
                    "ten_bien_override": (
                        row["ten_bien"]
                        if row["ten_bien"] != default["ten_bien"]
                        else None
                    ),
                    "source_table_override": (
                        row["source_table"]
                        if row["source_table"] != default["source_table"]
                        else None
                    ),
                    "source_column_override": (
                        row["source_column"]
                        if row["source_column"] != default["source_column"]
                        else None
                    ),
                    "mo_ta_override": (
                        (row.get("mo_ta") or "")
                        if (row.get("mo_ta") or "") != (default.get("mo_ta") or "")
                        else None
                    ),
                }
                if any(value is not None for value in differences.values()):
                    _upsert_override(
                        cursor,
                        scope_id,
                        row.get("owner_type") or owner_type,
                        default["mapping_key"],
                        **differences,
                    )
                    result["override_rows"] += 1

        for mapping_id in consumed:
            cursor.execute(
                """DELETE FROM cau_hinh_bien_word
                   WHERE id = ? AND organization_id = ?""",
                (mapping_id, scope_id),
            )
        cursor.execute(
            "DELETE FROM word_default_seeds WHERE organization_id = ?",
            (scope_id,),
        )
        result["scopes"] += 1
        result["removed_default_rows"] += len(consumed)
    return result
