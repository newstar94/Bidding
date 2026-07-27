"""Shared field metadata for persistence, UI, Word and Excel integrations."""

from backend.shared.date_utils import DATETIME_COLUMNS
from backend.db.schema import SCHEMA_DINH_NGHIA


DATE_ONLY_COLUMNS = {
    column
    for table in SCHEMA_DINH_NGHIA.values()
    for column in table.get("columns", {})
    if column.startswith("ngay_")
}

PERCENT_COLUMNS = {
    "trong_so_ky_thuat",
    "ty_le",
    "ty_le_bao_dam_hop_dong",
    "ty_le_giam_gia",
}

CURRENCY_COLUMNS = {
    "bao_dam_du_thau",
    "gia_ca",
    "gia_du_thau",
    "gia_goi_thau",
    "gia_xep_hang",
    "gia_de_nghi_trung_thau",
    "gia_sau_giam_gia",
    "gia_tri",
    "gia_tri_dam_bao",
    "gia_tri_dam_bao_du_thau",
    "gia_tri_phan_lo",
    "gia_tri_uoc_tinh",
    "gia_trung_thau",
    "tong_muc_dau_tu",
}

LABEL_WORDS = {
    "anh": "Ảnh", "bao": "bảo", "cao": "cáo", "cap": "cấp",
    "chi": "chỉ", "chuc": "chức", "dai": "đại", "dang": "đăng",
    "dau": "đấu", "dia": "địa", "dien": "điện", "dong": "đóng",
    "du": "dự", "gia": "giá", "gian": "gian", "goi": "gói",
    "hop": "hợp", "ke": "kế", "ky": "ký", "lua": "lựa",
    "ma": "mã", "mo": "mở", "ngay": "ngày", "nguoi": "người",
    "nha": "nhà", "phe": "phê", "quyet": "quyết", "so": "số",
    "tai": "tài", "ten": "tên", "thau": "thầu", "thoi": "thời",
    "thuc": "thực", "tien": "tiền", "tinh": "tỉnh", "trang": "trạng",
    "tri": "trị", "xung": "xưng",
}


def _base_type(sql_type):
    normalized = str(sql_type or "TEXT").strip().upper()
    if normalized.startswith("INTEGER"):
        return "integer"
    if normalized.startswith(("REAL", "NUMERIC", "DECIMAL")):
        return "number"
    if normalized.startswith("BLOB"):
        return "binary"
    return "string"


def field_format(column_name):
    if column_name in DATETIME_COLUMNS:
        return "datetime"
    if column_name in DATE_ONLY_COLUMNS:
        return "date"
    if column_name in CURRENCY_COLUMNS:
        return "currency"
    if column_name in PERCENT_COLUMNS:
        return "percent"
    return "text"


def field_label(column_name):
    words = [LABEL_WORDS.get(part, part.upper() if len(part) <= 3 else part) for part in column_name.split("_")]
    return " ".join(words).capitalize()


def build_field_manifest(json_key_resolver, word_mappings=None):
    word_by_source = {}
    for mapping in word_mappings or []:
        source = (mapping.get("source_table"), mapping.get("source_column"))
        if source[0] in SCHEMA_DINH_NGHIA and source[1]:
            word_by_source[source] = mapping.get("ten_bien")

    tables = {}
    for table_name, table_spec in SCHEMA_DINH_NGHIA.items():
        fields = {}
        for column, sql_type in table_spec.get("columns", {}).items():
            fields[column] = {
                "column": column,
                "jsonKey": json_key_resolver(table_name, column),
                "dataType": _base_type(sql_type),
                "label": field_label(column),
                "format": field_format(column),
                "wordVariable": word_by_source.get((table_name, column)),
                "excelCompatible": _base_type(sql_type) != "binary",
            }
        tables[table_name] = {"fields": fields}
    return {"version": 1, "tables": tables}
