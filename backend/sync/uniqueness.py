"""Tenant-scoped domain uniqueness checks for sync records."""

from __future__ import annotations

from dataclasses import dataclass, field
from typing import Any


_QUERY_CHUNK_SIZE = 500


@dataclass(frozen=True)
class _UniquenessRule:
    token: str
    item_keys: tuple[str, ...]
    column: str
    case_insensitive: bool = True
    archived: bool = True
    lineage_scoped: bool = True


@dataclass(slots=True)
class DomainUniquenessContext:
    candidates: dict[tuple[str, str, str], list[tuple[str, str | None]]] = field(
        default_factory=dict
    )
    assignment_candidates: dict[tuple[str, str, str], list[str]] = field(
        default_factory=dict
    )


_RULES_BY_TABLE = {
    "chu_dau_tu": (
        _UniquenessRule("code", ("maChuDauTu",), "ma_chu_dau_tu"),
        _UniquenessRule("tax_code", ("maSoThue",), "ma_so_thue"),
    ),
    "ke_hoach_lcnt": (
        _UniquenessRule("code", ("maKeHoach",), "ma_ke_hoach"),
    ),
    "goi_thau": (
        _UniquenessRule("code", ("maGoiThau",), "ma_goi_thau"),
    ),
    "nha_thau": (
        _UniquenessRule("code", ("maNhaThau",), "ma_nha_thau"),
        _UniquenessRule("tax_code", ("maSoThue",), "ma_so_thue"),
    ),
    "chuyen_gia": (
        _UniquenessRule(
            "citizen_id",
            ("soCCCD",),
            "so_cccd",
            case_insensitive=False,
        ),
    ),
    "hop_dong": (
        _UniquenessRule("number", ("soHopDong",), "so_hop_dong"),
    ),
    "danh_muc_trang_thai_hop_dong": (
        _UniquenessRule(
            "name",
            ("name", "tenTrangThai"),
            "name",
            archived=False,
            lineage_scoped=False,
        ),
    ),
}


def _value(item: dict[str, Any], *keys: str) -> str:
    for key in keys:
        value = str(item.get(key) or "").strip()
        if value:
            return value
    return ""


def _normalized_value(rule: _UniquenessRule, value: str) -> str:
    normalized = value.strip()
    return normalized.lower() if rule.case_insensitive else normalized


def _assignment_key(item: dict[str, Any]) -> tuple[str, str, str] | None:
    employee_id = _value(item, "empId", "id_nhan_vien")
    target_id = _value(item, "targetId", "id_muc_tieu")
    target_type = _value(item, "type", "loai_doi_tuong")
    if not employee_id or not target_id or not target_type:
        return None
    return employee_id, target_id, target_type


def assignment_conflict_detail(conflicting_id: str) -> dict[str, str]:
    return {
        "field": "$record",
        "code": "ASSIGNMENT_ALREADY_EXISTS",
        "message": "Nhân sự đã được phân công cho đối tượng này.",
        "conflictingId": conflicting_id,
    }


def build_domain_uniqueness_context(
    cursor,
    organization_id: str,
    records_by_table: dict[str, list[dict[str, Any]]],
) -> DomainUniquenessContext:
    """Load stored uniqueness candidates once per table/field/chunk."""

    context = DomainUniquenessContext()
    for table_name, rules in _RULES_BY_TABLE.items():
        items = records_by_table.get(table_name, ())
        for rule in rules:
            values = list(dict.fromkeys(
                normalized
                for item in items
                if (raw_value := _value(item, *rule.item_keys))
                if (normalized := _normalized_value(rule, raw_value))
            ))
            expression = (
                f"lower(trim({rule.column}))"
                if rule.case_insensitive
                else f"trim({rule.column})"
            )
            for offset in range(0, len(values), _QUERY_CHUNK_SIZE):
                chunk = values[offset:offset + _QUERY_CHUNK_SIZE]
                placeholders = ", ".join("?" for _ in chunk)
                id_goc_select = "id_goc" if rule.lineage_scoped else "NULL AS id_goc"
                active_clause = " AND archived_at IS NULL" if rule.archived else ""
                rows = cursor.execute(
                    f"""SELECT id, {id_goc_select}, {expression} AS normalized_value
                        FROM {table_name}
                        WHERE organization_id = ?{active_clause}
                          AND {expression} IN ({placeholders})""",
                    (organization_id, *chunk),
                ).fetchall()
                for row in rows:
                    candidate_id = str(row[0])
                    candidate_root = None if row[1] is None else str(row[1])
                    normalized = str(row[2])
                    context.candidates.setdefault(
                        (table_name, rule.token, normalized),
                        [],
                    ).append((candidate_id, candidate_root))

    assignment_items = records_by_table.get("phan_cong_nhan_su", ())
    assignment_keys = list(dict.fromkeys(
        key
        for item in assignment_items
        if (key := _assignment_key(item)) is not None
    ))
    for offset in range(0, len(assignment_keys), _QUERY_CHUNK_SIZE):
        chunk = assignment_keys[offset:offset + _QUERY_CHUNK_SIZE]
        tuple_placeholders = ", ".join("(?, ?, ?)" for _key in chunk)
        rows = cursor.execute(
            f"""SELECT id, id_nhan_vien, id_muc_tieu, loai_doi_tuong
                FROM phan_cong_nhan_su
                WHERE organization_id = ?
                  AND (id_nhan_vien, id_muc_tieu, loai_doi_tuong)
                      IN ({tuple_placeholders})""",  # noqa: S608 - validated placeholder count
            (
                organization_id,
                *(value for key in chunk for value in key),
            ),
        ).fetchall()
        for row in rows:
            key = (str(row[1]), str(row[2]), str(row[3]))
            context.assignment_candidates.setdefault(key, []).append(str(row[0]))
    for item in assignment_items:
        key = _assignment_key(item)
        record_id = str(item.get("id") or "").strip()
        if key and record_id:
            candidates = context.assignment_candidates.setdefault(key, [])
            if record_id not in candidates:
                candidates.append(record_id)
    return context


def _context_conflicting_id(
    context: DomainUniquenessContext,
    table_name: str,
    rule: _UniquenessRule,
    value: str,
    record_id: str | None,
    root_id: str | None,
):
    if record_id is None:
        return None
    normalized = _normalized_value(rule, value)
    for candidate_id, candidate_root in context.candidates.get(
        (table_name, rule.token, normalized),
        (),
    ):
        if candidate_id == str(record_id):
            continue
        if not rule.lineage_scoped:
            return candidate_id
        if root_id is None:
            if candidate_root is None:
                return candidate_id
        elif candidate_root is None or candidate_root != str(root_id):
            return candidate_id
    return None


def validate_domain_uniqueness_from_context(
    context: DomainUniquenessContext,
    table_name: str,
    item: dict[str, Any],
    record_id: str | None,
    root_id: str | None,
) -> list[Any]:
    """Apply the existing uniqueness rules without issuing per-record SQL."""

    rules = {rule.token: rule for rule in _RULES_BY_TABLE.get(table_name, ())}
    errors: list[Any] = []

    def conflict(token, value):
        if not value:
            return None
        return _context_conflicting_id(
            context,
            table_name,
            rules[token],
            value,
            record_id,
            root_id,
        )

    if table_name == "phan_cong_nhan_su":
        key = _assignment_key(item)
        conflicting_id = next((
            candidate_id
            for candidate_id in context.assignment_candidates.get(key, ())
            if candidate_id != str(record_id)
        ), None)
        if conflicting_id:
            errors.append(assignment_conflict_detail(conflicting_id))

    if table_name == "chu_dau_tu":
        code = _value(item, "maChuDauTu")
        tax_code = _value(item, "maSoThue")
        if conflicting_id := conflict("code", code):
            errors.append({
                "message": f"Mã chủ đầu tư '{code}' đã tồn tại.",
                "conflictingId": conflicting_id,
            })
        if conflicting_id := conflict("tax_code", tax_code):
            errors.append({
                "message": f"Mã số thuế '{tax_code}' đã tồn tại.",
                "conflictingId": conflicting_id,
            })
    elif table_name == "ke_hoach_lcnt":
        code = _value(item, "maKeHoach")
        if conflict("code", code):
            errors.append(f"Mã kế hoạch '{code}' đã tồn tại.")
    elif table_name == "goi_thau":
        code = _value(item, "maGoiThau")
        if conflict("code", code):
            errors.append(f"Mã gói thầu '{code}' đã tồn tại.")
    elif table_name == "nha_thau":
        code = _value(item, "maNhaThau")
        tax_code = _value(item, "maSoThue")
        if conflicting_id := conflict("code", code):
            errors.append({
                "message": f"Mã nhà thầu '{code}' đã tồn tại.",
                "conflictingId": conflicting_id,
            })
        if conflicting_id := conflict("tax_code", tax_code):
            errors.append({
                "message": f"Mã số thuế '{tax_code}' đã tồn tại.",
                "conflictingId": conflicting_id,
            })
    elif table_name == "chuyen_gia":
        citizen_id = _value(item, "soCCCD")
        if conflict("citizen_id", citizen_id):
            errors.append(f"Số CCCD chuyên gia '{citizen_id}' đã tồn tại.")
    elif table_name == "hop_dong":
        contract_number = _value(item, "soHopDong")
        if conflict("number", contract_number):
            errors.append(f"Số hợp đồng '{contract_number}' đã tồn tại.")
    elif table_name == "danh_muc_trang_thai_hop_dong":
        status_name = _value(item, "name", "tenTrangThai")
        if conflict("name", status_name):
            errors.append(f"Trạng thái hợp đồng '{status_name}' đã tồn tại.")
    return errors


def _conflicting_id(cursor, sql: str, params: tuple[Any, ...]) -> Any:
    row = cursor.execute(sql, params).fetchone()
    return row[0] if row else None


def validate_domain_uniqueness(
    cursor,
    organization_id: str,
    table_name: str,
    item: dict[str, Any],
    record_id: str | None,
    root_id: str | None,
) -> list[Any]:
    errors: list[Any] = []
    lineage_params = (record_id, root_id)

    if table_name == "chu_dau_tu":
        code = _value(item, "maChuDauTu")
        tax_code = _value(item, "maSoThue")
        if code:
            conflict = _conflicting_id(
                cursor,
                """SELECT id FROM chu_dau_tu
                   WHERE organization_id = ? AND archived_at IS NULL
                     AND lower(trim(ma_chu_dau_tu)) = lower(trim(?))
                     AND id != ? AND (id_goc IS NULL OR id_goc != ?)""",
                (organization_id, code, *lineage_params),
            )
            if conflict:
                errors.append({
                    "message": f"Mã chủ đầu tư '{code}' đã tồn tại.",
                    "conflictingId": conflict,
                })
        if tax_code:
            conflict = _conflicting_id(
                cursor,
                """SELECT id FROM chu_dau_tu
                   WHERE organization_id = ? AND archived_at IS NULL
                     AND lower(trim(ma_so_thue)) = lower(trim(?))
                     AND id != ? AND (id_goc IS NULL OR id_goc != ?)""",
                (organization_id, tax_code, *lineage_params),
            )
            if conflict:
                errors.append({
                    "message": f"Mã số thuế '{tax_code}' đã tồn tại.",
                    "conflictingId": conflict,
                })

    elif table_name == "ke_hoach_lcnt":
        code = _value(item, "maKeHoach")
        if code and _conflicting_id(
            cursor,
            """SELECT 1 FROM ke_hoach_lcnt
               WHERE organization_id = ? AND archived_at IS NULL
                 AND lower(trim(ma_ke_hoach)) = lower(trim(?))
                 AND id != ? AND (id_goc IS NULL OR id_goc != ?)""",
            (organization_id, code, *lineage_params),
        ):
            errors.append(f"Mã kế hoạch '{code}' đã tồn tại.")

    elif table_name == "goi_thau":
        code = _value(item, "maGoiThau")
        if code and _conflicting_id(
            cursor,
            """SELECT 1 FROM goi_thau
               WHERE organization_id = ? AND archived_at IS NULL
                 AND lower(trim(ma_goi_thau)) = lower(trim(?))
                 AND id != ? AND (id_goc IS NULL OR id_goc != ?)""",
            (organization_id, code, *lineage_params),
        ):
            errors.append(f"Mã gói thầu '{code}' đã tồn tại.")

    elif table_name == "nha_thau":
        code = _value(item, "maNhaThau")
        tax_code = _value(item, "maSoThue")
        if code:
            conflict = _conflicting_id(
                cursor,
                """SELECT id FROM nha_thau
                   WHERE organization_id = ? AND archived_at IS NULL
                     AND lower(trim(ma_nha_thau)) = lower(trim(?))
                     AND id != ? AND (id_goc IS NULL OR id_goc != ?)""",
                (organization_id, code, *lineage_params),
            )
            if conflict:
                errors.append({
                    "message": f"Mã nhà thầu '{code}' đã tồn tại.",
                    "conflictingId": conflict,
                })
        if tax_code:
            conflict = _conflicting_id(
                cursor,
                """SELECT id FROM nha_thau
                   WHERE organization_id = ? AND archived_at IS NULL
                     AND lower(trim(ma_so_thue)) = lower(trim(?))
                     AND id != ? AND (id_goc IS NULL OR id_goc != ?)""",
                (organization_id, tax_code, *lineage_params),
            )
            if conflict:
                errors.append({
                    "message": f"Mã số thuế '{tax_code}' đã tồn tại.",
                    "conflictingId": conflict,
                })

    elif table_name == "chuyen_gia":
        citizen_id = _value(item, "soCCCD")
        if citizen_id and _conflicting_id(
            cursor,
            """SELECT 1 FROM chuyen_gia
               WHERE organization_id = ? AND archived_at IS NULL
                 AND trim(so_cccd) = trim(?)
                 AND id != ? AND (id_goc IS NULL OR id_goc != ?)""",
            (organization_id, citizen_id, *lineage_params),
        ):
            errors.append(f"Số CCCD chuyên gia '{citizen_id}' đã tồn tại.")

    elif table_name == "hop_dong":
        contract_number = _value(item, "soHopDong")
        if contract_number and _conflicting_id(
            cursor,
            """SELECT 1 FROM hop_dong
               WHERE organization_id = ? AND archived_at IS NULL
                 AND lower(trim(so_hop_dong)) = lower(trim(?))
                 AND id != ? AND (id_goc IS NULL OR id_goc != ?)""",
            (organization_id, contract_number, *lineage_params),
        ):
            errors.append(f"Số hợp đồng '{contract_number}' đã tồn tại.")

    elif table_name == "danh_muc_trang_thai_hop_dong":
        status_name = _value(item, "name", "tenTrangThai")
        if status_name and _conflicting_id(
            cursor,
            """SELECT 1 FROM danh_muc_trang_thai_hop_dong
               WHERE organization_id = ?
                 AND lower(trim(name)) = lower(trim(?)) AND id != ?""",
            (organization_id, status_name, record_id),
        ):
            errors.append(f"Trạng thái hợp đồng '{status_name}' đã tồn tại.")

    return errors
