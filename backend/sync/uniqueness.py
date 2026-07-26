"""Tenant-scoped domain uniqueness checks for sync records."""

from __future__ import annotations

from typing import Any


def _value(item: dict[str, Any], *keys: str) -> str:
    for key in keys:
        value = str(item.get(key) or "").strip()
        if value:
            return value
    return ""


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
