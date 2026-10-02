"""Bounded, parameterized filters for the three business list screens.

These predicates narrow an already authorized list. Visibility, current-version
selection and record projections remain owned by the pagination service.
"""

from __future__ import annotations

from dataclasses import dataclass
from datetime import date
import json
import re

from backend.shared.domain_enums import enum_filter_value
from backend.sync.visibility_scope import SqlPredicate


MAX_FILTER_BYTES = 16_384
MAX_FILTER_CONDITIONS = 24
MAX_FILTER_VALUES = 100
MAX_FILTER_VALUE_LENGTH = 512
MAX_MONEY = 9_223_372_036_854_775_807


class ListFilterError(ValueError):
    """A list-filter request cannot be represented by the supported controls."""


@dataclass(frozen=True)
class FilterField:
    column: str
    kind: str = "text"


def _fields(*, text=(), choice=(), money=(), dates=(), timestamps=(), ids=(), boolean=()):
    return {
        key: FilterField(column, kind)
        for kind, entries in (
            ("text", text), ("choice", choice), ("money", money),
            ("date", dates), ("timestamp", timestamps), ("id", ids),
            ("boolean", boolean),
        )
        for key, column in entries
    }


FILTER_FIELDS = {
    "ke_hoach_lcnt": _fields(
        text=(
            ("maKeHoach", "ma_ke_hoach"), ("tenKeHoach", "ten_ke_hoach"),
            ("tenDuAnDuToan", "ten_du_an_du_toan"), ("maDuan", "ma_du_an"),
            ("nguonVon", "nguon_von"), ("quyetDinhPheDuyet", "quyet_dinh_phe_duyet"),
        ),
        choice=(("loaiHinhMuaSam", "loai_hinh_mua_sam"), ("pheDuyet", "phe_duyet")),
        ids=(("chuDauTuId", "chu_dau_tu_id"),),
        money=(("tongMucDauTu", "tong_muc_dau_tu"),),
        dates=(
            ("ngayPheDuyet", "ngay_phe_duyet"),
            ("ngayPheDuyetDuToan", "ngay_phe_duyet_du_toan"),
            ("ngayQdPheDuyetDuAn", "ngay_qd_phe_duyet_du_an"),
        ),
        timestamps=(("thoiGianDangMa", "thoi_gian_dang_tai"),),
    ),
    "goi_thau": _fields(
        text=(
            ("maGoiThau", "ma_goi_thau"), ("tenGoiThau", "ten_goi_thau"),
            ("nguonVon", "nguon_von"), ("soQuyetDinh", "so_quyet_dinh"),
        ),
        choice=(
            ("trangThai", "trang_thai"), ("hinhThucLuaChon", "hinh_thuc_lua_chon"),
            ("linhVuc", "linh_vuc"), ("phuongThucLuaChon", "phuong_thuc_lua_chon"),
            ("loaiHopDong", "loai_hop_dong"), ("quaMang", "qua_mang"),
            ("trongNuocQuocTe", "trong_nuoc_quoc_te"), ("phanLo", "phan_lo"),
            ("tuyChonMuaThem", "tuy_chon_mua_them"),
        ),
        ids=(("keHoachId", "ke_hoach_id"), ("nhaThauTrungThauId", "nha_thau_trung_thau_id")),
        boolean=(("isThuoc", "is_thuoc"),),
        money=(
            ("giaGoiThau", "gia_goi_thau"), ("giaTrungThau", "gia_trung_thau"),
            ("giaTriDamBaoDuThau", "gia_tri_dam_bao_du_thau"),
        ),
        dates=(("ngayQuyetDinh", "ngay_quyet_dinh"),),
        timestamps=(
            ("thoiGianDangTai", "thoi_gian_dang_tai"),
            ("thoiGianDongThau", "thoi_gian_dong_thau"),
            ("thoiGianMoThau", "thoi_gian_mo_thau"),
        ),
    ),
    "hop_dong": _fields(
        text=(
            ("soHopDong", "so_hop_dong"), ("tenHopDong", "ten_hop_dong"),
            ("soNgayThucHien", "thoi_gian_thuc_hien"), ("soQdChiDinh", "so_qd_chi_dinh"),
        ),
        choice=(
            ("trangThaiHopDong", "trang_thai_hop_dong"),
            ("loaiHopDong", "loai_hop_dong"), ("phanLoai", "phan_loai"),
        ),
        ids=(
            ("chuDauTuId", "chu_dau_tu_id"), ("nhaThauId", "nha_thau_id"),
            ("keHoachId", "ke_hoach_id"),
        ),
        boolean=(("coQdChiDinh", "co_qd_chi_dinh"),),
        money=(("giaTri", "gia_tri"),),
        dates=(
            ("ngayKy", "ngay_ky"), ("ngayThanhLy", "ngay_thanh_ly"),
            ("ngayQdChiDinh", "ngay_qd_chi_dinh"),
        ),
    ),
}
FILTER_FIELDS["goi_thau"]["assigneeId"] = FilterField("", "assignee")
FILTER_FIELDS["hop_dong"]["assigneeId"] = FilterField("", "assignee")
FILTER_FIELDS["hop_dong"]["goiThauIds"] = FilterField("", "packages")

_OPERATORS = {
    "text": {"contains", "not_contains", "equals", "in"},
    "choice": {"equals", "in"},
    "id": {"equals", "in"},
    "assignee": {"equals", "in"},
    "packages": {"equals", "in"},
    "money": {"equals", "in", "range"},
    "boolean": {"equals", "in"},
    "date": {"equals", "in", "range", "year", "month"},
    "timestamp": {"equals", "in", "range", "year", "month"},
}


def _text_value(value):
    if value is None:
        return ""
    if not isinstance(value, str) or len(value) > MAX_FILTER_VALUE_LENGTH:
        raise ListFilterError("Giá trị bộ lọc không hợp lệ hoặc quá dài.")
    return value.strip()


def _typed_value(table_name, field, value):
    text = _text_value(value)
    if not text:
        return None
    if field.kind == "money":
        if not re.fullmatch(r"[0-9]{1,19}", text):
            raise ListFilterError("Giá trị tiền phải là số nguyên không âm.")
        number = int(text)
        if number > MAX_MONEY:
            raise ListFilterError("Giá trị tiền vượt quá giới hạn.")
        return number
    if field.kind == "boolean":
        if text not in {"0", "1"}:
            raise ListFilterError("Giá trị lựa chọn phải là 0 hoặc 1.")
        return int(text)
    if field.kind in {"date", "timestamp"}:
        try:
            if not re.fullmatch(r"[0-9]{4}-[0-9]{2}-[0-9]{2}", text):
                raise ValueError("invalid date format")
            return date.fromisoformat(text).isoformat()
        except ValueError as error:
            raise ListFilterError("Ngày lọc phải có định dạng YYYY-MM-DD hợp lệ.") from error
    if field.kind == "choice":
        return enum_filter_value(table_name, field.column, text)
    return text


def parse_list_filters(table_name, raw_filters):
    """Validate the entire input before a database connection is acquired."""
    if raw_filters is None or raw_filters == "":
        return ()
    if not isinstance(raw_filters, str) or len(raw_filters) > MAX_FILTER_BYTES:
        raise ListFilterError("Bộ lọc vượt quá kích thước cho phép.")
    try:
        if len(raw_filters.encode("utf-8")) > MAX_FILTER_BYTES:
            raise ListFilterError("Bộ lọc vượt quá kích thước cho phép.")
        conditions = json.loads(raw_filters)
    except (ValueError, TypeError, RecursionError, UnicodeEncodeError) as error:
        raise ListFilterError("Dữ liệu bộ lọc không hợp lệ.") from error
    if not isinstance(conditions, list) or len(conditions) > MAX_FILTER_CONDITIONS:
        raise ListFilterError("Bộ lọc phải là danh sách tối đa 24 điều kiện.")
    parsed = []
    for condition in conditions:
        if not isinstance(condition, dict):
            raise ListFilterError("Điều kiện lọc không hợp lệ.")
        key = condition.get("field")
        operator = condition.get("operator")
        fields = FILTER_FIELDS.get(table_name, {})
        if not isinstance(key, str) or key not in fields:
            raise ListFilterError("Trường lọc không được hỗ trợ.")
        field = fields[key]
        if not isinstance(operator, str) or operator not in _OPERATORS[field.kind]:
            raise ListFilterError("Phép lọc không được hỗ trợ cho trường đã chọn.")
        raw_value = condition.get("value")
        if operator == "range":
            if raw_value is None or raw_value == "":
                continue
            if not isinstance(raw_value, dict) or set(raw_value) - {"min", "max"}:
                raise ListFilterError("Khoảng lọc phải chứa giá trị min và max.")
            minimum = _typed_value(table_name, field, raw_value.get("min"))
            maximum = _typed_value(table_name, field, raw_value.get("max"))
            if minimum is None and maximum is None:
                continue
            if minimum is not None and maximum is not None and minimum > maximum:
                raise ListFilterError("Giá trị từ không được lớn hơn giá trị đến.")
            value = (minimum, maximum)
        elif operator == "in":
            if raw_value is None or raw_value == "":
                continue
            if not isinstance(raw_value, list) or len(raw_value) > MAX_FILTER_VALUES:
                raise ListFilterError("Danh sách lọc phải có tối đa 100 giá trị.")
            value = tuple(dict.fromkeys(
                item for item in (_typed_value(table_name, field, part) for part in raw_value)
                if item is not None
            ))
            if not value:
                continue
        elif operator in {"year", "month"}:
            raw_values = raw_value if isinstance(raw_value, list) else [raw_value]
            if len(raw_values) > MAX_FILTER_VALUES:
                raise ListFilterError("Danh sách lọc phải có tối đa 100 giá trị.")
            texts = [_text_value(part) for part in raw_values]
            texts = [text for text in texts if text]
            if not texts:
                continue
            upper = 9998 if operator == "year" else 12
            if any(not re.fullmatch(r"[0-9]{1,4}", text) or not 1 <= int(text) <= upper for text in texts):
                raise ListFilterError("Năm hoặc tháng lọc không hợp lệ.")
            value = tuple(dict.fromkeys(int(text) for text in texts))
        else:
            value = _typed_value(table_name, field, raw_value)
            if value is None:
                continue
        parsed.append((key, operator, value))
    return tuple(parsed)


def _escaped_like(value):
    return "%" + value.replace("\\", "\\\\").replace("%", "\\%").replace("_", "\\_") + "%"


def build_list_filter_predicate(table_name, filters, *, effective_package_status=False):
    """Compile validated controls; identifiers originate only in this registry."""
    parts = []
    parameters = []
    for key, operator, value in filters:
        field = FILTER_FIELDS[table_name][key]
        column = field.column
        if effective_package_status and table_name == "goi_thau" and key == "trangThai":
            column = "effective_status"
        expression = f"{table_name}.{column}"
        if field.kind == "timestamp":
            expression = f"({expression} AT TIME ZONE 'Asia/Ho_Chi_Minh')::date"
        if field.kind in {"assignee", "packages"}:
            values = value if operator == "in" else (value,)
            placeholders = ", ".join("?" for _ in values)
            if field.kind == "assignee":
                target_type = {"goi_thau": "goithau", "hop_dong": "hopdong"}[table_name]
                sql = (
                    "EXISTS (SELECT 1 FROM phan_cong_nhan_su AS filter_assignment "  # noqa: S608 - fixed identifiers and bounded placeholders
                    f"WHERE filter_assignment.organization_id = {table_name}.organization_id "
                    f"AND filter_assignment.id_muc_tieu = {table_name}.id "
                    "AND filter_assignment.loai_doi_tuong = ? "
                    f"AND filter_assignment.id_nhan_vien IN ({placeholders}))"
                )  # noqa: S608 - identifiers from the fixed field registry
                parameters.append(target_type)
            else:
                sql = (
                    "EXISTS (SELECT 1 FROM hop_dong_goi_thau AS filter_package "  # noqa: S608 - fixed identifiers and bounded placeholders
                    "WHERE filter_package.organization_id = hop_dong.organization_id "
                    "AND filter_package.hop_dong_id = hop_dong.id "
                    f"AND filter_package.goi_thau_id IN ({placeholders}))"
                )  # noqa: S608 - fixed relation and bounded placeholders
            parameters.extend(values)
            parts.append(sql)
        elif operator in {"contains", "not_contains"}:
            comparison = "NOT LIKE" if operator == "not_contains" else "LIKE"
            parts.append(f"lower(COALESCE({expression}, '')) {comparison} lower(?) ESCAPE E'\\\\'")
            parameters.append(_escaped_like(value))
        elif operator == "range":
            minimum, maximum = value
            if minimum is not None:
                parts.append(f"{expression} >= ?")
                parameters.append(minimum)
            if maximum is not None:
                parts.append(f"{expression} <= ?")
                parameters.append(maximum)
        elif operator == "year":
            alternatives = []
            for year in value:
                alternatives.append(f"({expression} >= ? AND {expression} < ?)")
                parameters.extend((f"{year:04d}-01-01", f"{year + 1:04d}-01-01"))
            parts.append("(" + " OR ".join(alternatives) + ")")
        elif operator == "month":
            placeholders = ", ".join("?" for _ in value)
            parts.append(f"EXTRACT(MONTH FROM {expression}) IN ({placeholders})")
            parameters.extend(value)
        else:
            values = value if operator == "in" else (value,)
            if field.kind == "text":
                comparisons = [f"lower(COALESCE({expression}, '')) = lower(?)" for _ in values]
                parts.append("(" + " OR ".join(comparisons) + ")")
            else:
                placeholders = ", ".join("?" for _ in values)
                parts.append(f"{expression} IN ({placeholders})")
            parameters.extend(values)
    return SqlPredicate(" AND ".join(f"({part})" for part in parts), tuple(parameters))
