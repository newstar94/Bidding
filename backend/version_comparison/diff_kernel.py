"""Pure, bounded scalar and relation comparison."""

from __future__ import annotations

import base64
import hashlib
import hmac
import json
from datetime import date, datetime, timezone
from decimal import Decimal

from backend.version_comparison.field_registry import (
    TECHNICAL_FIELDS,
    comparison_type,
    label_key,
)
from backend.version_comparison.relation_policies import (
    business_identity,
    relation_policy,
)

DEFAULT_RELATION_LIMIT = 100
MAX_RELATION_LIMIT = 500
CLONED_LINK_FIELDS = frozenset({
    "targetId",
    "goiThauId",
    "keHoachId",
    "phanLoId",
    "thongTinMoThauId",
    "goiThauHangHoaId",
    "vongDanhGiaId",
    "baoCaoDanhGiaNhaThauId",
    "tieuChiDanhGiaId",
})


def _decimal_text(value):
    normalized = Decimal(str(value)).normalize()
    if normalized == 0:
        normalized = Decimal(0)
    return format(normalized, "f")


def _canonical_datetime(value):
    parsed = value
    if isinstance(value, str):
        try:
            parsed = datetime.fromisoformat(value.strip().replace("Z", "+00:00"))
        except ValueError:
            return value
    if not isinstance(parsed, datetime) or parsed.tzinfo is None:
        return value
    return parsed.astimezone(timezone.utc).isoformat().replace("+00:00", "Z")


def _canonical_date(value):
    parsed = value
    if isinstance(value, str):
        try:
            parsed = date.fromisoformat(value.strip())
        except ValueError:
            return value
    if isinstance(parsed, datetime) or not isinstance(parsed, date):
        return value
    return parsed.isoformat()


def _canonical(value, path=""):
    if isinstance(value, dict):
        return {
            key: _canonical(item, f"{path}.{key}" if path else key)
            for key, item in sorted(value.items())
            if key not in TECHNICAL_FIELDS and key not in CLONED_LINK_FIELDS
        }
    if isinstance(value, list):
        return [_canonical(item, path) for item in value]
    if isinstance(value, bool):
        return value
    if isinstance(value, (Decimal, int, float)):
        return {"$decimal": _decimal_text(value)}
    value_type = comparison_type(path)
    if value_type == "DATETIME" or isinstance(value, datetime):
        return {"$datetime": _canonical_datetime(value)}
    if value_type == "DATE" or (
        isinstance(value, date) and not isinstance(value, datetime)
    ):
        return {"$date": _canonical_date(value)}
    return value


def _json_value(value):
    if isinstance(value, dict):
        return {
            key: _json_value(item)
            for key, item in value.items()
            if key not in TECHNICAL_FIELDS and key not in CLONED_LINK_FIELDS
        }
    if isinstance(value, list):
        return [_json_value(item) for item in value]
    if isinstance(value, Decimal):
        return _decimal_text(value)
    if isinstance(value, datetime):
        return value.isoformat().replace("+00:00", "Z")
    if isinstance(value, date):
        return value.isoformat()
    return value


def _is_absent(value):
    return value is None or value == ""


def _change(old_value, new_value, path=""):
    if _canonical(old_value, path) == _canonical(new_value, path):
        return "UNCHANGED"
    if _is_absent(old_value) and not _is_absent(new_value):
        return "ADDED"
    if not _is_absent(old_value) and _is_absent(new_value):
        return "REMOVED"
    return "MODIFIED"


def _flatten(record, prefix=""):
    result = {}
    for key in sorted((record or {}).keys()):
        if key in TECHNICAL_FIELDS:
            continue
        path = f"{prefix}.{key}" if prefix else key
        value = record[key]
        if isinstance(value, dict):
            result.update(_flatten(value, path))
        elif not isinstance(value, list):
            result[path] = value
    return result


def _nested_relations(record, prefix=""):
    result = {}
    for key in sorted((record or {}).keys()):
        if key in TECHNICAL_FIELDS:
            continue
        path = f"{prefix}.{key}" if prefix else key
        value = record[key]
        if isinstance(value, list):
            result[path] = value
        elif isinstance(value, dict):
            result.update(_nested_relations(value, path))
    return result


def _clean_relation_item(item):
    return _json_value(item if isinstance(item, dict) else {"value": item})


def _summary(changes):
    return {
        "added": sum(item["change"] == "ADDED" for item in changes),
        "removed": sum(item["change"] == "REMOVED" for item in changes),
        "modified": sum(item["change"] == "MODIFIED" for item in changes),
        "unchanged": sum(item["change"] == "UNCHANGED" for item in changes),
    }


def _cursor_binding(
    path,
    left_items,
    right_items,
    include_unchanged,
    comparison_identity,
):
    encoded = json.dumps(
        {
            "path": path,
            "comparison": comparison_identity,
            "includeUnchanged": bool(include_unchanged),
            "left": _canonical(left_items, path),
            "right": _canonical(right_items, path),
        },
        ensure_ascii=False,
        sort_keys=True,
        separators=(",", ":"),
    ).encode("utf-8")
    return hashlib.sha256(encoded).hexdigest()


def _cursor_offset(cursor, binding):
    if cursor in (None, ""):
        return 0
    try:
        payload = json.loads(base64.urlsafe_b64decode(str(cursor) + "===").decode("utf-8"))
        offset = int(payload["offset"])
        version = int(payload["version"])
        cursor_binding = str(payload["binding"])
    except (ValueError, TypeError, KeyError, json.JSONDecodeError, UnicodeDecodeError):
        raise ValueError("INVALID_RELATION_CURSOR") from None
    if (
        offset < 0
        or version != 1
        or not hmac.compare_digest(cursor_binding, binding)
    ):
        raise ValueError("INVALID_RELATION_CURSOR")
    return offset


def _next_cursor(offset, binding):
    encoded = base64.urlsafe_b64encode(
        json.dumps(
            {"version": 1, "offset": offset, "binding": binding},
            separators=(",", ":"),
        ).encode("utf-8")
    ).decode("ascii")
    return encoded.rstrip("=")


def _compare_relation(
    path,
    left_items,
    right_items,
    *,
    include_unchanged,
    page,
    comparison_identity,
):
    policy = relation_policy(path)
    left_index = {}
    right_index = {}
    identity_values = {}
    positions = {"left": {}, "right": {}}
    unidentifiable = []
    for side, items, index in (("left", left_items, left_index), ("right", right_items, right_index)):
        for position, item in enumerate(items or []):
            raw = item if isinstance(item, dict) else {"value": item}
            clean = _clean_relation_item(raw)
            identity_key, identity = business_identity(policy, raw)
            if identity_key is None:
                unidentifiable.append({"side": side, "value": clean})
                continue
            index.setdefault(identity_key, []).append(clean)
            identity_values[identity_key] = identity
            positions[side].setdefault(identity_key, []).append(position)

    ambiguous = []
    changes = []
    for identity_key in sorted(set(left_index) | set(right_index)):
        old_rows = left_index.get(identity_key, [])
        new_rows = right_index.get(identity_key, [])
        if len(old_rows) > 1 or len(new_rows) > 1:
            ambiguous.append({
                "identity": identity_values[identity_key],
                "leftCount": len(old_rows),
                "rightCount": len(new_rows),
                "oldValues": old_rows,
                "newValues": new_rows,
                "reasonCode": "DUPLICATE_BUSINESS_IDENTITY",
            })
            continue
        old_value = old_rows[0] if old_rows else None
        new_value = new_rows[0] if new_rows else None
        change = _change(old_value, new_value, path)
        order_change = None
        if (
            policy.ordered
            and old_value is not None
            and new_value is not None
            and positions["left"][identity_key][0] != positions["right"][identity_key][0]
        ):
            change = "MODIFIED"
            order_change = {
                "oldIndex": positions["left"][identity_key][0],
                "newIndex": positions["right"][identity_key][0],
            }
        changes.append({
            "identity": identity_values[identity_key],
            "change": change,
            "oldValue": old_value,
            "newValue": new_value,
            **({"orderChange": order_change} if order_change else {}),
        })

    for item in unidentifiable:
        ambiguous.append({
            "identity": None,
            "side": item["side"],
            "reasonCode": (
                "UNREGISTERED_RELATION_POLICY"
                if not policy.registered
                else "MISSING_BUSINESS_IDENTITY"
            ),
            "oldValues": [item["value"]] if item["side"] == "left" else [],
            "newValues": [item["value"]] if item["side"] == "right" else [],
        })

    full_summary = _summary(changes)
    visible_changes = [
        item for item in changes
        if include_unchanged or item["change"] != "UNCHANGED"
    ]
    limit = min(MAX_RELATION_LIMIT, max(1, int(page.get("limit") or DEFAULT_RELATION_LIMIT)))
    binding = _cursor_binding(
        path,
        left_items,
        right_items,
        include_unchanged,
        comparison_identity,
    )
    offset = _cursor_offset(page.get("cursor"), binding)
    if offset > len(visible_changes):
        raise ValueError("INVALID_RELATION_CURSOR")
    selected = visible_changes[offset:offset + limit]
    next_offset = offset + len(selected)
    return {
        "path": path,
        "summary": full_summary,
        "changes": selected,
        "ambiguousMatches": ambiguous,
        "nextCursor": (
            _next_cursor(next_offset, binding)
            if next_offset < len(visible_changes)
            else None
        ),
    }


def compare_snapshots(
    left_snapshot,
    right_snapshot,
    *,
    include_unchanged=False,
    relation_page_request=None,
):
    left_record = left_snapshot.get("record") or {}
    right_record = right_snapshot.get("record") or {}
    left_fields = _flatten(left_record)
    right_fields = _flatten(right_record)
    all_fields = []
    for path in sorted(set(left_fields) | set(right_fields)):
        old_value = left_fields.get(path)
        new_value = right_fields.get(path)
        change = _change(old_value, new_value, path)
        all_fields.append({
            "path": path,
            "labelKey": label_key(path),
            "kind": "SCALAR",
            "change": change,
            "oldValue": _json_value(old_value),
            "newValue": _json_value(new_value),
        })
    fields = [
        field for field in all_fields
        if include_unchanged or field["change"] != "UNCHANGED"
    ]

    page_request = relation_page_request or {}
    comparison_identity = {
        side: {
            "entityType": snapshot.get("entityType"),
            "id": (snapshot.get("record") or {}).get("id"),
            "rootId": (snapshot.get("record") or {}).get("rootId"),
            "version": (snapshot.get("record") or {}).get("phienBan"),
            "rowVersion": (snapshot.get("record") or {}).get("rowVersion"),
        }
        for side, snapshot in (("left", left_snapshot), ("right", right_snapshot))
    }
    left_relations = {
        **_nested_relations(left_record),
        **(left_snapshot.get("relations") or {}),
    }
    right_relations = {
        **_nested_relations(right_record),
        **(right_snapshot.get("relations") or {}),
    }
    relation_paths = sorted(set(left_relations) | set(right_relations))
    requested_path = page_request.get("path")
    if requested_path and requested_path not in relation_paths:
        raise ValueError("INVALID_RELATION_PATH")
    relations = [
        _compare_relation(
            path,
            left_relations.get(path) or [],
            right_relations.get(path) or [],
            include_unchanged=include_unchanged,
            page=page_request if page_request.get("path") in (None, "", path) else {},
            comparison_identity=comparison_identity,
        )
        for path in relation_paths
    ]
    summary = _summary(all_fields)
    for relation in relations:
        for key in summary:
            summary[key] += int(relation["summary"].get(key, 0))
    return {
        "summary": summary,
        "fields": fields,
        "relations": relations,
    }
