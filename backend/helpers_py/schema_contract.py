from .schema import SCHEMA_DINH_NGHIA
from .text_utils import to_camel_case


CLIENT_TABLE_MAP = {
    "systempackages": "goi_dich_vu",
    "employees": "tai_khoan",
    "chudautu": "chu_dau_tu",
    "kehoach": "ke_hoach_lcnt",
    "nhathau": "nha_thau",
    "goithau": "goi_thau",
    "chuyengia": "chuyen_gia",
    "hopdong": "hop_dong",
    "assignments": "phan_cong_nhan_su",
    "custompaperstatuses": "trang_thai_ho_so_giay",
    "thongtinmothau": "thong_tin_mo_thau",
    "organizations": "to_chuc",
    "permissionmatrix": "ma_tran_phan_quyen",
}


def json_key_for_column(table_name, column_name):
    table_spec = SCHEMA_DINH_NGHIA.get(table_name, {})
    field_map = table_spec.get("field_map", {})
    return field_map.get(column_name) or ("rootId" if column_name == "id_goc" else to_camel_case(column_name))


def build_schema_contract():
    tables = {}
    seen_common = {}
    conflicts = set()

    for table_name, table_spec in SCHEMA_DINH_NGHIA.items():
        columns = list(table_spec.get("columns", {}).keys())
        field_map = {column: json_key_for_column(table_name, column) for column in columns}
        tables[table_name] = {
            "columns": columns,
            "fieldMap": field_map,
            "reverseFieldMap": {json_key: column for column, json_key in field_map.items()},
            "jsonFields": list(table_spec.get("json_fields", [])),
        }
        for column, json_key in field_map.items():
            if column not in seen_common:
                seen_common[column] = json_key
            elif seen_common[column] != json_key:
                conflicts.add(column)

    common_field_map = {
        column: json_key
        for column, json_key in seen_common.items()
        if column not in conflicts and column != json_key
    }
    common_field_map["root_id"] = "rootId"

    return {
        "version": 1,
        "clientTableMap": CLIENT_TABLE_MAP,
        "commonFieldMap": dict(sorted(common_field_map.items())),
        "tables": tables,
    }
