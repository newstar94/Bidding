"""Canonical payload/row mapping seam for sync adapters.

The functions here are deliberately pure: callers provide a table name and a
payload or database row, and receive the canonical representation.  Keeping
schema-key conversion and business-identifier normalization together prevents
read and write paths from independently recreating those rules.
"""

from __future__ import annotations

import json
import re

from backend.db.schema import MONEY_COLUMNS, SCHEMA_DINH_NGHIA
from backend.shared.domain_enums import enum_label
from backend.shared.numeric_utils import money_json_value
from backend.shared.text_utils import (
    normalize_business_identifier,
    normalize_organization_name,
    normalize_person_name,
    to_camel_case,
)


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
    return re.sub(r"(?<!^)(?=[A-Z])", "_", json_key).lower()


def get_payload_value(table_name, item, col):
    return item.get(json_key_for_column(table_name, col))


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
    business_key_fields = {
        "chu_dau_tu": (("maChuDauTu", False), ("maSoThue", True)),
        "ke_hoach_lcnt": (("maKeHoach", False),),
        "goi_thau": (("maGoiThau", False),),
        "nha_thau": (("maNhaThau", False), ("maSoThue", True)),
        "chuyen_gia": (("soCCCD", True),),
        "hop_dong": (("soHopDong", False),),
    }
    for field_name, digits_only in business_key_fields.get(table_name, ()):
        if field_name in normalized and normalized.get(field_name) not in (None, ""):
            normalized[field_name] = normalize_business_identifier(
                normalized[field_name],
                digits_only=digits_only,
                preserve_case=(table_name, field_name) in {
                    ("chu_dau_tu", "maChuDauTu"),
                    ("nha_thau", "maNhaThau"),
                },
            )
    if table_name == "chu_dau_tu" and normalized.get("tenChuDauTu"):
        normalized["tenChuDauTu"] = normalize_organization_name(
            normalized["tenChuDauTu"]
        )
    elif table_name == "nha_thau" and normalized.get("tenNhaThau"):
        normalized["tenNhaThau"] = normalize_organization_name(
            normalized["tenNhaThau"]
        )
    elif (
        table_name == "goi_thau"
        and str(normalized.get("hinhThucLuaChon") or "").strip().lower()
        == "chào hàng cạnh tranh"
    ):
        normalized["yeuCauThamDinhHsmt"] = "Không"
        normalized["soBaoCaoThamDinhHsmt"] = ""
        normalized["ngayBaoCaoThamDinhHsmt"] = ""
        normalized["toThamDinh"] = []
        raw_metadata = normalized.get("danhGiaHsdtMetadata")
        try:
            metadata = (
                json.loads(raw_metadata)
                if isinstance(raw_metadata, str) and raw_metadata.strip()
                else raw_metadata
            )
        except (TypeError, ValueError, json.JSONDecodeError):
            metadata = None
        if isinstance(metadata, dict):
            if isinstance(metadata.get("technical"), dict):
                metadata["technical"].pop("soBctdKt", None)
                metadata["technical"].pop("ngayBctdKt", None)
            if isinstance(metadata.get("result"), dict):
                metadata["result"].pop("soBctdKetQua", None)
                metadata["result"].pop("ngayBctdKetQua", None)
            normalized["danhGiaHsdtMetadata"] = (
                json.dumps(metadata, ensure_ascii=False)
                if isinstance(raw_metadata, str)
                else metadata
            )
    return normalized


def map_db_to_json(table_name, row_dict):
    item = {}
    table_spec = SCHEMA_DINH_NGHIA[table_name]
    explicit_json_fields = set(table_spec.get("json_fields", []))
    for col in table_spec["columns"].keys():
        json_key = json_key_for_column(table_name, col)
        value = enum_label(table_name, col, row_dict.get(col))
        if (
            (table_name == "chu_dau_tu" and col == "dai_dien_cdt")
            or (table_name == "nha_thau" and col == "nguoi_dai_dien")
        ):
            value = normalize_person_name(value)
        elif table_name == "chu_dau_tu" and col == "ten_chu_dau_tu":
            value = normalize_organization_name(value)
        elif table_name == "nha_thau" and col == "ten_nha_thau":
            value = normalize_organization_name(value)
        if (table_name, col) in MONEY_COLUMNS:
            value = money_json_value(value)
        is_json_field = (
            col in explicit_json_fields
            or col.endswith("_list")
            or col.startswith("cv_")
        )
        if is_json_field:
            if value:
                try:
                    value = json.loads(value)
                except (TypeError, json.JSONDecodeError):
                    value = []
            else:
                value = []
        item[json_key] = value
    return item
