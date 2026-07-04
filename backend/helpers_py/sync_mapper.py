import json
import re

from .schema import SCHEMA_DINH_NGHIA
from .text_utils import to_camel_case


def json_key_for_column(table_name, col):
    table_spec = SCHEMA_DINH_NGHIA.get(table_name, {})
    field_map = table_spec.get("field_map", {})
    return field_map.get(col) or ("rootId" if col == "id_goc" else to_camel_case(col))


def db_column_for_json_key(table_name, json_key):
    table_spec = SCHEMA_DINH_NGHIA.get(table_name, {})
    columns = table_spec.get("columns", {})
    for col in columns.keys():
        if json_key_for_column(table_name, col) == json_key:
            return col
    return re.sub(r'(?<!^)(?=[A-Z])', '_', json_key).lower()


def get_payload_value(table_name, item, col):
    json_key = json_key_for_column(table_name, col)
    return item.get(json_key)


def canonicalize_payload_item(table_name, item):
    if not isinstance(item, dict):
        return {}
    table_spec = SCHEMA_DINH_NGHIA.get(table_name, {})
    columns = table_spec.get("columns", {})
    schema_keys = set(columns.keys())
    normalized = {key: value for key, value in item.items() if key not in schema_keys}
    for col in columns.keys():
        json_key = json_key_for_column(table_name, col)
        if json_key in item:
            normalized[json_key] = item.get(json_key)
        elif col in item:
            normalized[json_key] = item.get(col)
    return normalized


def map_db_to_json(table_name, row_dict):
    item = {}
    table_spec = SCHEMA_DINH_NGHIA[table_name]
    explicit_json_fields = set(table_spec.get("json_fields", []))
    for col in table_spec["columns"].keys():
        json_key = json_key_for_column(table_name, col)
        val = row_dict.get(col)
        is_json_field = (
            col in explicit_json_fields
            or col.endswith("_list")
            or col.startswith("cv_")
        )
        if is_json_field:
            if val:
                try:
                    val = json.loads(val)
                except Exception:
                    val = []
            else:
                val = []
        item[json_key] = val
    return item
