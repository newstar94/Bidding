from starlette.responses import JSONResponse

from backend.sync.queries import TABLE_KEYS


def _order_package_dependencies(items):
    """Keep client order except when an incoming rebid depends on a later row."""

    incoming_ids = {
        str(item.get("id"))
        for item in items
        if isinstance(item, dict) and item.get("id")
    }
    remaining = list(items)
    ordered = []
    emitted_ids = set()
    while remaining:
        next_remaining = []
        progressed = False
        for item in remaining:
            if not isinstance(item, dict):
                ordered.append(item)
                progressed = True
                continue
            source_id = str(
                item.get("rebidFromPackageId")
                or item.get("rebid_from_package_id")
                or ""
            ).strip()
            if not source_id or source_id not in incoming_ids or source_id in emitted_ids:
                ordered.append(item)
                record_id = str(item.get("id") or "").strip()
                if record_id:
                    emitted_ids.add(record_id)
                progressed = True
            else:
                next_remaining.append(item)
        if not progressed:
            ordered.extend(next_remaining)
            break
        remaining = next_remaining
    return ordered


def iter_sync_table_payloads(data, table_keys=TABLE_KEYS):
    for payload_key, table_name in table_keys.items():
        items = data.get(payload_key)
        if not isinstance(items, list):
            continue
        if table_name == "goi_thau":
            items = _order_package_dependencies(items)
        yield payload_key, table_name, items


def rollback_sync_response(conn, errors, message, status_code=400):
    conn.rollback()
    return JSONResponse({
        "status": "error",
        "message": message,
        "errors": errors
    }, status_code=status_code)
