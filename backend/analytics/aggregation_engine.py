"""Deterministic, allowlisted aggregation for AI and future reports."""

# ruff: noqa: S608

from __future__ import annotations

from datetime import date, datetime, timedelta
from decimal import Decimal
from typing import Any

from backend.ai.errors import ai_error
from backend.ai.types import AiRequestContext, ToolResult
from backend.analytics.query_scope import table_for_entity, visibility_clause
from backend.analytics.semantic_registry import get_metric
from backend.shared.domain_enums import enum_code


MAX_DATE_RANGE_DAYS = 366 * 5
MAX_RECORDS = 20

_DATE_FIELDS = {
    "packages": {
        "thoi_gian_dang_tai": "thoi_gian_dang_tai",
        "thoi_gian_mo_thau": "thoi_gian_mo_thau",
        "ngay_quyet_dinh_ket_qua": "ngay_quyet_dinh_ket_qua",
    },
    "plans": {"ngay_phe_duyet": "ngay_phe_duyet"},
    "contracts": {
        "signed_date": "ngay_ky",
        "liquidation_date": "ngay_thanh_ly",
        "ngay_ky": "ngay_ky",
        "ngay_thanh_ly": "ngay_thanh_ly",
    },
}
_STATUS_FIELDS = {
    "packages": "trang_thai",
    "plans": "phe_duyet",
    "contracts": "trang_thai_hop_dong",
}
_GROUP_FIELDS = {
    "status": {
        "packages": "trang_thai",
        "plans": "phe_duyet",
        "contracts": "trang_thai_hop_dong",
    },
    "contract_type": {"contracts": "loai_hop_dong"},
}
_LIST_ROUTES = {"packages": "/goi-thau", "plans": "/ke-hoach", "contracts": "/hop-dong"}
_DETAIL_ROUTES = {
    "packages": "/goi-thau-chi-tiet",
    "plans": "/ke-hoach-chi-tiet",
    "contracts": "/hop-dong-chi-tiet",
}


def _parse_date(value: Any, field: str) -> date | None:
    if value in (None, ""):
        return None
    if not isinstance(value, str):
        raise ai_error("AI_TOOL_INVALID_ARGUMENTS", f"{field} phải có định dạng YYYY-MM-DD.")
    try:
        return date.fromisoformat(value)
    except ValueError as exc:
        raise ai_error("AI_TOOL_INVALID_ARGUMENTS", f"{field} phải có định dạng YYYY-MM-DD.") from exc


def _date_window(arguments: dict[str, Any]) -> tuple[date | None, date | None]:
    start = _parse_date(arguments.get("dateFrom"), "dateFrom")
    end = _parse_date(arguments.get("dateTo"), "dateTo")
    if start and end and end < start:
        raise ai_error("AI_TOOL_INVALID_ARGUMENTS", "Khoảng ngày không hợp lệ.")
    if start and end and (end - start).days > MAX_DATE_RANGE_DAYS:
        raise ai_error("AI_QUERY_TOO_BROAD", "Khoảng ngày vượt quá giới hạn truy vấn.")
    return start, end


def _decimal_string(value: Any) -> str:
    if value is None:
        return "0"
    parsed = value if isinstance(value, Decimal) else Decimal(str(value))
    return format(parsed, "f")


def _source_links(entity: str, records: list[dict[str, Any]], *, filtered: bool = True) -> list[dict[str, str]]:
    links = [{"type": "list", "label": f"Mở danh sách {entity}", "url": _LIST_ROUTES[entity]}]
    for record in records[:MAX_RECORDS]:
        record_id = str(record.get("id") or "").strip()
        if record_id:
            links.append({
                "type": "record",
                "label": str(record.get("name") or record_id),
                "url": f"{_DETAIL_ROUTES[entity]}/{record_id}",
            })
    del filtered
    return links


def aggregate_entity(cursor, context: AiRequestContext, entity: str, arguments: dict[str, Any]) -> ToolResult:
    entity = str(entity or "").strip()
    metric_id = str(arguments.get("metric") or "").strip()
    spec = get_metric(entity, metric_id)
    if arguments.get("dateField") and str(arguments["dateField"]) not in _DATE_FIELDS.get(entity, {}):
        raise ai_error("AI_UNSUPPORTED_DATE_FIELD", "Trường ngày không được hỗ trợ cho miền dữ liệu này.")
    date_field_key = str(arguments.get("dateField") or spec.default_date_column or "")
    date_column = _DATE_FIELDS.get(entity, {}).get(date_field_key) if date_field_key else None
    if date_field_key and date_column is None:
        raise ai_error("AI_UNSUPPORTED_DATE_FIELD", "Trường ngày không được hỗ trợ cho chỉ số này.")
    group_by = str(arguments.get("groupBy") or "none")
    if group_by not in spec.supported_groups:
        raise ai_error("AI_UNSUPPORTED_GROUP_BY", "Cách nhóm dữ liệu không được hỗ trợ.")
    table_name, _module, _assignment = table_for_entity(entity)
    visibility, params = visibility_clause(context, entity, table_name)
    where = [visibility, f"{table_name}.archived_at IS NULL"]
    if "is_latest" in {"is_latest"}:
        where.append(f"{table_name}.is_latest = 1")
    if spec.status_expression:
        where.append(spec.status_expression)

    statuses = arguments.get("statuses") or []
    if statuses:
        if not isinstance(statuses, list) or len(statuses) > 12 or not all(isinstance(item, str) and item.strip() for item in statuses):
            raise ai_error("AI_TOOL_INVALID_ARGUMENTS", "Danh sách trạng thái không hợp lệ.")
        status_column = _STATUS_FIELDS[entity]
        statuses = [enum_code(table_name, status_column, item) for item in statuses]
        placeholders = ", ".join("?" for _ in statuses)
        where.append(f"{table_name}.{status_column} IN ({placeholders})")
        params += tuple(statuses)

    date_from, date_to = _date_window(arguments)
    if date_from or date_to:
        if not date_column:
            raise ai_error("AI_UNSUPPORTED_DATE_FIELD", "Chỉ số này không hỗ trợ lọc theo ngày.")
        if date_from:
            where.append(f"{table_name}.{date_column} >= ?")
            params += (date_from.isoformat(),)
        if date_to:
            where.append(f"{table_name}.{date_column} < ?")
            params += ((date_to + timedelta(days=1)).isoformat(),)

    group_expression = None
    group_label = None
    if group_by in {"year", "month"}:
        if not date_column:
            raise ai_error("AI_UNSUPPORTED_GROUP_BY", "Chỉ số này cần trường ngày để nhóm.")
        group_expression = (
            f"EXTRACT(YEAR FROM {table_name}.{date_column})::TEXT"
            if group_by == "year"
            else f"TO_CHAR({table_name}.{date_column}, 'YYYY-MM')"
        )
        group_label = "Năm" if group_by == "year" else "Tháng"
    elif group_by in _GROUP_FIELDS:
        group_expression = f"{table_name}.{_GROUP_FIELDS[group_by].get(entity, '')}"
        if group_expression.endswith("."):
            raise ai_error("AI_UNSUPPORTED_GROUP_BY", "Dimension không được hỗ trợ cho miền dữ liệu này.")
        group_label = "Trạng thái" if group_by == "status" else "Loại hợp đồng"

    if group_expression:
        select_group = f"{group_expression} AS group_key, "
        group_clause = f" GROUP BY {group_expression} ORDER BY group_key LIMIT ?"
    else:
        select_group = ""
        group_clause = ""

    limit = arguments.get("limit", MAX_RECORDS)
    if not isinstance(limit, int) or isinstance(limit, bool) or not 1 <= limit <= MAX_RECORDS:
        raise ai_error("AI_TOOL_INVALID_ARGUMENTS", f"limit phải nằm trong khoảng 1-{MAX_RECORDS}.")

    value_expression = "COUNT(*)"
    if spec.aggregation == "sum":
        value_expression = f"COALESCE(SUM({table_name}.{spec.value_column}), 0)"
    query = (  # noqa: S608 - identifiers and expressions come only from static semantic registries
        f"SELECT {select_group} COUNT(*) AS record_count, {value_expression} AS aggregate_value "
        f"FROM {table_name} WHERE {' AND '.join(where)}"
    )
    query_params = params
    if group_expression:
        query += group_clause
        query_params += (limit,)
    row = cursor.execute(query, query_params).fetchall()

    records = []
    total_count = 0
    total_value = Decimal("0")
    for item in row:
        count = int(item["record_count"] or 0)
        value = Decimal(str(item["aggregate_value"] or 0))
        total_count += count
        total_value += value
        if group_expression:
            record = {"group": str(item["group_key"] or "Không xác định"), "recordCount": count}
            if spec.aggregation == "sum":
                record["value"] = _decimal_string(value)
                record["currency"] = "VND"
            records.append(record)

    if not group_expression and row:
        total_count = int(row[0]["record_count"] or 0)
        total_value = Decimal(str(row[0]["aggregate_value"] or 0))
    filters = {
        "dateFrom": date_from.isoformat() if date_from else None,
        "dateTo": date_to.isoformat() if date_to else None,
        "dateField": date_field_key or None,
        "statuses": statuses,
        "groupBy": group_by,
    }
    summary = {"recordCount": total_count}
    if spec.aggregation == "sum":
        summary.update({"value": _decimal_string(total_value), "currency": "VND"})
    if group_label:
        summary["groupLabel"] = group_label
    generated_at = datetime.now().astimezone().isoformat()
    return ToolResult(
        tool_name=f"aggregate_{entity}",
        scope={"organizationId": context.organization_id, "organizationName": context.organization_name},
        filters={key: value for key, value in filters.items() if value not in (None, [], "")},
        summary=summary,
        records=records,
        generated_at=generated_at,
        source_links=_source_links(entity, records),
    )


def list_entity(cursor, context: AiRequestContext, entity: str, arguments: dict[str, Any]) -> ToolResult:
    table_name, _module, _assignment = table_for_entity(entity)
    visibility, params = visibility_clause(context, entity, table_name)
    where = [visibility, f"{table_name}.archived_at IS NULL", f"{table_name}.is_latest = 1"]
    date_column = _DATE_FIELDS.get(entity, {}).get(str(arguments.get("dateField") or ""))
    date_from, date_to = _date_window(arguments)
    if date_from or date_to:
        if not date_column:
            raise ai_error("AI_UNSUPPORTED_DATE_FIELD", "Trường ngày không được hỗ trợ.")
        if date_from:
            where.append(f"{table_name}.{date_column} >= ?")
            params += (date_from.isoformat(),)
        if date_to:
            where.append(f"{table_name}.{date_column} < ?")
            params += ((date_to + timedelta(days=1)).isoformat(),)
    status = str(arguments.get("status") or "").strip()
    if status:
        column = _STATUS_FIELDS[entity]
        status = enum_code(table_name, column, status)
        where.append(f"{table_name}.{column} = ?")
        params += (status,)
    limit = arguments.get("limit", MAX_RECORDS)
    if not isinstance(limit, int) or isinstance(limit, bool) or not 1 <= limit <= MAX_RECORDS:
        raise ai_error("AI_TOOL_INVALID_ARGUMENTS", f"limit phải nằm trong khoảng 1-{MAX_RECORDS}.")
    if entity == "packages":
        fields = "id, ma_goi_thau, ten_goi_thau, gia_goi_thau, trang_thai, thoi_gian_mo_thau"
        name_column, code_column, value_column, status_column, date_output = "ten_goi_thau", "ma_goi_thau", "gia_goi_thau", "trang_thai", "thoi_gian_mo_thau"
    elif entity == "plans":
        fields = "id, ma_ke_hoach, ten_ke_hoach, tong_muc_dau_tu, phe_duyet, ngay_phe_duyet"
        name_column, code_column, value_column, status_column, date_output = "ten_ke_hoach", "ma_ke_hoach", "tong_muc_dau_tu", "phe_duyet", "ngay_phe_duyet"
    else:
        fields = "id, so_hop_dong, ten_hop_dong, gia_tri, trang_thai_hop_dong, ngay_ky, ngay_thanh_ly"
        name_column, code_column, value_column, status_column, date_output = "ten_hop_dong", "so_hop_dong", "gia_tri", "trang_thai_hop_dong", "ngay_ky"
    rows = cursor.execute(  # noqa: S608 - table/column names are selected from static entity maps
        f"SELECT {fields} FROM {table_name} WHERE {' AND '.join(where)} ORDER BY {date_output} DESC NULLS LAST, id DESC LIMIT ?",
        params + (limit,),
    ).fetchall()
    records = []
    for row in rows:
        records.append({
            "id": str(row["id"]),
            "code": str(row[code_column] or ""),
            "name": str(row[name_column] or row["id"]),
            "value": _decimal_string(row[value_column]) if row[value_column] is not None else None,
            "currency": "VND" if row[value_column] is not None else None,
            "status": str(row[status_column] or ""),
            "date": str(row[date_output] or ""),
        })
    return ToolResult(
        tool_name=f"list_{entity}",
        scope={"organizationId": context.organization_id, "organizationName": context.organization_name},
        filters={key: value for key, value in {"dateFrom": date_from.isoformat() if date_from else None, "dateTo": date_to.isoformat() if date_to else None, "status": status or None}.items() if value},
        summary={"recordCount": len(records), "truncated": len(records) >= limit},
        records=records,
        generated_at=datetime.now().astimezone().isoformat(),
        source_links=_source_links(entity, records),
    )
