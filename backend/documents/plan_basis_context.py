"""Resolve and materialize the exact plan-basis selection for Word export."""

from __future__ import annotations

from datetime import date, datetime
import hashlib
import json

from backend.sync.child_projection import format_plan_basis_child


SELECTION_FIELD = "selectedCanCuLapKeHoachIds"
SELECTION_ALL = "all"
SELECTION_EXPLICIT = "explicit"


class PlanBasisSelectionError(ValueError):
    pass


def parse_selection_payload(payload, *, field_present=None):
    if field_present is None:
        field_present = isinstance(payload, dict) and SELECTION_FIELD in payload
    if not field_present:
        return None
    value = payload.get(SELECTION_FIELD) if isinstance(payload, dict) else None
    if not isinstance(value, list):
        raise PlanBasisSelectionError("DOCUMENT_EXPORT_PLAN_BASIS_SELECTION_INVALID")
    normalized = []
    seen = set()
    for item in value:
        if not isinstance(item, str) or not item.strip():
            raise PlanBasisSelectionError("DOCUMENT_EXPORT_PLAN_BASIS_SELECTION_INVALID")
        basis_id = item.strip()
        if basis_id in seen:
            raise PlanBasisSelectionError("DOCUMENT_EXPORT_PLAN_BASIS_SELECTION_DUPLICATE")
        seen.add(basis_id)
        normalized.append(basis_id)
    return normalized


def resolve_plan_basis_rows(cursor, organization_id, plan_id, selected_ids=None):
    rows = cursor.execute(
        """SELECT * FROM ke_hoach_can_cu
           WHERE organization_id = ? AND ke_hoach_id = ?
           ORDER BY sort_order, id""",
        (organization_id, plan_id),
    ).fetchall()
    available = [dict(row) for row in rows]
    if selected_ids is None:
        return available, SELECTION_ALL
    selected = set(selected_ids)
    available_ids = {str(row.get("id") or "") for row in available}
    if selected - available_ids:
        raise PlanBasisSelectionError("DOCUMENT_EXPORT_PLAN_BASIS_SELECTION_UNKNOWN")
    return [row for row in available if str(row.get("id") or "") in selected], SELECTION_EXPLICIT


def _short_date(value):
    if isinstance(value, datetime):
        value = value.date()
    if isinstance(value, date):
        return value.strftime("%d/%m/%Y")
    raw = str(value or "").strip()
    try:
        return date.fromisoformat(raw[:10]).strftime("%d/%m/%Y") if raw else ""
    except ValueError:
        return ""


def materialize_plan_basis_items(rows):
    items = []
    for index, row in enumerate(rows, start=1):
        item = format_plan_basis_child(row, "snake")
        values = {
            "stt": index,
            "noi_dung_goc": item.get("noi_dung_goc") or "",
            "ten_can_cu": item.get("ten_can_cu") or "",
            "ten_van_ban": item.get("ten_van_ban") or "",
            "so_van_ban": item.get("so_van_ban") or "",
            "ngay_ban_hanh": item.get("ngay_ban_hanh") or "",
            "S_ngay_ban_hanh": _short_date(item.get("ngay_ban_hanh")),
            "don_vi_ban_hanh": item.get("don_vi_ban_hanh") or "",
            "trich_yeu": item.get("trich_yeu") or "",
            "parse_status": item.get("parse_status") or "UNPARSED",
        }
        values.update({
            "cum_so_van_ban": f" số {values['so_van_ban']}" if values["so_van_ban"] else "",
            "cum_ngay_ban_hanh": f" ngày {values['S_ngay_ban_hanh']}" if values["S_ngay_ban_hanh"] else "",
            "cum_don_vi_ban_hanh": f" của {values['don_vi_ban_hanh']}" if values["don_vi_ban_hanh"] else "",
            "cum_trich_yeu": f" về việc {values['trich_yeu']}" if values["trich_yeu"] else "",
        })
        items.append(values)
    return items


def selection_audit_metadata(rows, mode):
    ids = [str(row.get("id") or "") for row in rows]
    digest = hashlib.sha256(
        json.dumps(ids, ensure_ascii=False, separators=(",", ":")).encode("utf-8")
    ).hexdigest()
    return {
        "plan_basis_selection_mode": mode,
        "plan_basis_count": len(ids),
        "plan_basis_ids": ids,
        "plan_basis_ids_sha256": digest,
    }
