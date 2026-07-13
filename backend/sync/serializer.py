from starlette.responses import JSONResponse

from backend.sync.queries import TABLE_KEYS


def iter_sync_table_payloads(data, table_keys=TABLE_KEYS):
    for payload_key, table_name in table_keys.items():
        items = data.get(payload_key)
        if not isinstance(items, list):
            continue
        yield payload_key, table_name, items


def rollback_sync_response(conn, errors, message, status_code=400):
    conn.rollback()
    return JSONResponse({
        "status": "error",
        "message": message,
        "errors": errors
    }, status_code=status_code)
