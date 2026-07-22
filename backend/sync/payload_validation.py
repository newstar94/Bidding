import json
import math
import re
from datetime import datetime
from decimal import Decimal, InvalidOperation, ROUND_HALF_UP

from backend.db.schema import MONEY_COLUMNS, SCHEMA_DINH_NGHIA
from backend.partners.position_normalization import derive_investor_head_position
from .mapper import json_key_for_column
from .queries import TABLE_KEYS
from backend.shared.date_utils import is_datetime_column, parse_datetime_value, vietnam_today
from backend.shared.text_utils import safe_int
from backend.shared.numeric_utils import parse_vnd_amount
from backend.shared.domain_enums import PACKAGE_STATUS_CODES, PACKAGE_STATUS_LABELS, enum_label
from backend.sync.evaluation_metadata import parse_evaluation_metadata


PACKAGE_STATUSES = set(PACKAGE_STATUS_LABELS.values())
LEGACY_PACKAGE_STATUS_ALIASES = {
    "Huỷ thầu": "Hủy thầu"
}
DEFAULT_CONTRACT_STATUS_COLOR = "#64748B"
PLAIN_TEXT_FIELDS = {"thoi_gian_bat_dau_to_chuc"}
DATE_KEYS_BY_TABLE = {
    table_name: [
        json_key_for_column(table_name, col)
        for col in table_spec.get("columns", {}).keys()
        if is_datetime_column(col) and col not in PLAIN_TEXT_FIELDS
    ]
    for table_name, table_spec in SCHEMA_DINH_NGHIA.items()
}
PACKAGE_STATUS_TRANSITIONS = {
    "Chuẩn bị": {"Đang mời thầu", "Hủy thầu"},
    "Đang mời thầu": {"Đã mở thầu", "Hủy thầu"},
    "Đã mở thầu": {"Đang chấm thầu", "Hủy thầu"},
    "Đang chấm thầu": {"Đã có kết quả", "Hủy thầu"},
    "Đã có kết quả": {"Đang chấm thầu", "Hủy thầu"},
    # Khôi phục hủy thầu dùng trạng thái nghiệp vụ đã lưu ở phía client.
    "Hủy thầu": PACKAGE_STATUSES - {"Hủy thầu"},
}
PACKAGE_LOCKED_FIELDS_AFTER_INVITATION = {
    "maGoiThau": "ma_goi_thau",
    "keHoachId": "ke_hoach_id",
    "tenGoiThau": "ten_goi_thau",
    "giaGoiThau": "gia_goi_thau",
    "loaiHopDong": "loai_hop_dong",
    "hinhThucLuaChon": "hinh_thuc_lua_chon",
    "phuongThucLuaChon": "phuong_thuc_lua_chon",
    "phuongPhapDanhGia": "phuong_phap_danh_gia",
    "quaMang": "qua_mang",
    "trongNuocQuocTe": "trong_nuoc_quoc_te",
    "linhVuc": "linh_vuc",
    "nguonVon": "nguon_von",
    "phanLo": "phan_lo",
    "tuyChonMuaThem": "tuy_chon_mua_them",
}


def get_package_field_policy():
    """Public, presentation-neutral policy consumed by the frontend form."""
    return {
        "lockedAfterInvitation": sorted(PACKAGE_LOCKED_FIELDS_AFTER_INVITATION),
        "statusOrder": list(PACKAGE_STATUS_LABELS.values()),
        "statusCodes": dict(PACKAGE_STATUS_LABELS),
    }

SYNC_CHILD_FIELDS = {
    "ke_hoach_lcnt": {
        "cvDaThucHienList", "cvKhongApDungList", "cvChuaDuDieuKienList",
    },
    "goi_thau": {
        "phanLoList", "awardedPhanLoList", "tuyChonMuaThemList", "giaHanList",
        "yeuCauLamRoList", "traLoiLamRoList", "toChuyenGia", "toThamDinh",
        "timelineItems",
    },
    "nha_thau": {"thanhVienLienDanh"},
    "thong_tin_mo_thau": {"thanhVienLienDanh"},
    "hop_dong": {"goiThauIds"},
}
SYNC_VIRTUAL_FIELDS = {
    "goi_thau": {"danhGiaHsdtMetadata"},
    "thong_tin_mo_thau": {
        "danhGiaHopLe", "danhGiaNangLuc", "danhGiaKyThuat", "danhGiaTaiChinh",
        "danhGiaKetLuan", "diemDanhGia", "lyDoTruot", "lamRoHopLe",
        "lamRoNangLuc", "lamRoKyThuat", "lamRoTaiChinh",
        "nguyenNhanKhongDatHopLe", "nguyenNhanKhongDatNangLuc",
        "nguyenNhanKhongDatKyThuat",
    }
}
MAX_SYNC_TEXT_LENGTH = 100_000
MAX_SYNC_CHILD_ITEMS = 500
BOOLEAN_COLUMNS = {
    "is_latest", "is_tong_muc_tu_dong", "is_thuoc", "is_rebid", "co_qd_chi_dinh",
}
TABLE_KEYS_FOR_VALIDATION = TABLE_KEYS
CHILD_MONEY_FIELDS = {
    "giaTri", "gia_tri", "giaTriPhanLo", "gia_tri_phan_lo",
    "baoDamDuThau", "bao_dam_du_thau", "giaTrungThau", "gia_trung_thau",
    "giaTriUocTinh", "gia_tri_uoc_tinh",
}
CHILD_NUMBER_FIELDS = {"soLuong", "so_luong", "tyLe", "ty_le"}
TIMELINE_TEXT_LIMITS = {
    "id": 160,
    "maNhom": 3,
    "tenNhom": 160,
    "maMoc": 10,
    "congViec": 300,
    "donViBanHanh": 300,
    "soVanBan": 300,
    "ngayDuKien": 10,
    "ngayThucTe": 10,
    "ghiChu": 2000,
    "sourceKey": 160,
    "sourceMode": 10,
    "trangThai": 24,
}
TIMELINE_REQUIRED_FIELDS = {"maNhom", "tenNhom", "maMoc", "congViec"}
TIMELINE_ALLOWED_FIELDS = set(TIMELINE_TEXT_LIMITS) | {
    "isOptional", "sortOrder", "templateVersion",
}
TIMELINE_STATUSES = {"PENDING", "IN_PROGRESS", "DONE", "NOT_APPLICABLE"}


def _validate_timeline_items(items, item_path, errors):
    seen_codes = set()
    for child_index, child in enumerate(items):
        child_path = f"{item_path}.timelineItems[{child_index}]"
        if not isinstance(child, dict):
            errors.append(_field_error(child_path, "TYPE_OBJECT_REQUIRED", "Mốc timeline phải là object."))
            continue
        unknown = sorted(set(child) - TIMELINE_ALLOWED_FIELDS)
        for field_name in unknown:
            errors.append(_field_error(
                f"{child_path}.{field_name}",
                "UNKNOWN_FIELD",
                "Trường timeline không được hỗ trợ.",
            ))
        for field_name in TIMELINE_REQUIRED_FIELDS:
            if _is_blank(child.get(field_name)):
                errors.append(_field_error(
                    f"{child_path}.{field_name}",
                    "REQUIRED",
                    "Trường timeline không được để trống.",
                ))
        for field_name, limit in TIMELINE_TEXT_LIMITS.items():
            value = child.get(field_name)
            if value is None:
                continue
            if not isinstance(value, str):
                errors.append(_field_error(
                    f"{child_path}.{field_name}", "INVALID_STRING", "Giá trị phải là chuỗi."
                ))
            elif len(value) > limit:
                errors.append(_field_error(
                    f"{child_path}.{field_name}", "STRING_TOO_LONG", "Chuỗi vượt quá giới hạn cho phép."
                ))
        group_code = child.get("maNhom")
        if isinstance(group_code, str) and group_code not in {"I", "II", "III", "IV", "V"}:
            errors.append(_field_error(f"{child_path}.maNhom", "INVALID_TIMELINE_GROUP", "Mã nhóm timeline không hợp lệ."))
        milestone_code = child.get("maMoc")
        if isinstance(milestone_code, str):
            if not re.fullmatch(r"[1-5]\.(?:[1-9]|1[0-3])", milestone_code):
                errors.append(_field_error(f"{child_path}.maMoc", "INVALID_TIMELINE_CODE", "Mã mốc timeline không hợp lệ."))
            elif milestone_code in seen_codes:
                errors.append(_field_error(f"{child_path}.maMoc", "DUPLICATE_TIMELINE_CODE", "Mã mốc timeline bị trùng."))
            else:
                seen_codes.add(milestone_code)
        for field_name in ("ngayDuKien", "ngayThucTe"):
            value = child.get(field_name)
            if value in (None, ""):
                continue
            try:
                parsed = datetime.strptime(value, "%Y-%m-%d")
                valid_date = parsed.strftime("%Y-%m-%d") == value
            except (TypeError, ValueError):
                valid_date = False
            if not valid_date:
                errors.append(_field_error(f"{child_path}.{field_name}", "INVALID_DATE", "Ngày timeline phải theo định dạng YYYY-MM-DD."))
        source_mode = child.get("sourceMode", "MANUAL")
        if source_mode not in {"AUTO", "MANUAL"}:
            errors.append(_field_error(f"{child_path}.sourceMode", "INVALID_SOURCE_MODE", "Nguồn timeline không hợp lệ."))
        status = child.get("trangThai", "PENDING")
        if status not in TIMELINE_STATUSES:
            errors.append(_field_error(f"{child_path}.trangThai", "INVALID_TIMELINE_STATUS", "Trạng thái timeline không hợp lệ."))
        if "isOptional" in child and not isinstance(child.get("isOptional"), bool):
            errors.append(_field_error(f"{child_path}.isOptional", "INVALID_BOOLEAN", "isOptional phải là boolean."))
        sort_order = child.get("sortOrder", child_index)
        if isinstance(sort_order, bool) or not isinstance(sort_order, int) or not 0 <= sort_order <= 499:
            errors.append(_field_error(f"{child_path}.sortOrder", "INVALID_SORT_ORDER", "Thứ tự timeline phải từ 0 đến 499."))
        template_version = child.get("templateVersion", 1)
        if isinstance(template_version, bool) or not isinstance(template_version, int) or template_version < 1:
            errors.append(_field_error(f"{child_path}.templateVersion", "INVALID_TEMPLATE_VERSION", "Phiên bản checklist không hợp lệ."))


def _is_blank(value):
    return value is None or (isinstance(value, str) and not value.strip())


def _require_fields(item, fields, errors):
    for key, label in fields:
        if _is_blank(item.get(key)):
            errors.append(f"{label} không được để trống.")


def _as_list(value):
    if isinstance(value, list):
        return value
    if isinstance(value, str) and value.strip():
        try:
            parsed = json.loads(value)
            return parsed if isinstance(parsed, list) else []
        except (TypeError, ValueError):
            return []
    return []


def _validate_single_team_leader(item, field_name, label, errors):
    members = _as_list(item.get(field_name))
    if members:
        leader_count = sum(
            1 for member in members
            if isinstance(member, dict) and str(member.get("chucVu") or member.get("chuc_vu") or "").strip() == "Tổ trưởng"
        )
        if leader_count != 1:
            errors.append(f"{label} phải có đúng một Tổ trưởng.")


def validate_package_status_transition(previous_status, item):
    previous_status = enum_label("goi_thau", "trang_thai", previous_status)
    old_status = LEGACY_PACKAGE_STATUS_ALIASES.get(
        str(previous_status or "").strip(), str(previous_status or "").strip()
    )
    new_status = LEGACY_PACKAGE_STATUS_ALIASES.get(
        str(item.get("trangThai") or "Chuẩn bị").strip(),
        str(item.get("trangThai") or "Chuẩn bị").strip(),
    )
    if not old_status or old_status == new_status:
        return []
    direct_or_special = str(item.get("hinhThucLuaChon") or "").strip() in {
        "Chỉ định thầu rút gọn",
        "Lựa chọn nhà thầu trong trường hợp đặc biệt",
    }
    if direct_or_special and old_status == "Chuẩn bị" and new_status in {
        "Đang chấm thầu", "Đã có kết quả", "Hủy thầu"
    }:
        return []
    if new_status not in PACKAGE_STATUS_TRANSITIONS.get(old_status, set()):
        return [f"Không được chuyển trạng thái gói thầu từ '{old_status}' sang '{new_status}'."]
    return []


def validate_package_locked_fields(previous_record, item):
    """Reject material edits on an already-issued package version."""
    previous_status = enum_label("goi_thau", "trang_thai", (previous_record or {}).get("trang_thai"))
    previous_status = LEGACY_PACKAGE_STATUS_ALIASES.get(
        str(previous_status or "Chuẩn bị").strip(), str(previous_status or "Chuẩn bị").strip(),
    )
    if previous_status == "Chuẩn bị":
        return []

    errors = []
    for json_key, column_name in PACKAGE_LOCKED_FIELDS_AFTER_INVITATION.items():
        if json_key not in item:
            continue
        before = (previous_record or {}).get(column_name)
        after = item.get(json_key)
        if str(before if before is not None else "").strip() != str(after if after is not None else "").strip():
            errors.append(_field_error(
                json_key,
                "PACKAGE_FIELD_LOCKED",
                "Trường này không được sửa sau khi phát hành mời thầu; hãy tạo phiên bản gói thầu mới.",
            ))
    return errors


def validate_contract_status_transition(previous_status, item):
    """Custom contract statuses intentionally have no hard-coded transition graph."""

    del previous_status, item
    return []


def _field_error(path, code, message):
    return {"field": path, "code": code, "message": message}


def _is_strict_integer(value):
    return isinstance(value, int) and not isinstance(value, bool)


def _has_supported_decimal_precision(value, decimal_places=4):
    try:
        decimal_value = Decimal(str(value))
        return decimal_value.is_finite() and decimal_value == decimal_value.quantize(
            Decimal(1).scaleb(-decimal_places)
        )
    except (InvalidOperation, ValueError):
        return False


def _validate_json_depth(value, depth=0):
    if depth > 8:
        return False
    if isinstance(value, dict):
        return len(value) <= 500 and all(
            isinstance(key, str) and _validate_json_depth(item, depth + 1)
            for key, item in value.items()
        )
    if isinstance(value, list):
        return len(value) <= MAX_SYNC_CHILD_ITEMS and all(
            _validate_json_depth(item, depth + 1) for item in value
        )
    return not isinstance(value, str) or len(value) <= MAX_SYNC_TEXT_LENGTH


def validate_sync_payload_shape(payload):
    """Validate sync input without coercing invalid values or dropping unknown fields."""
    errors = []
    if not isinstance(payload, dict):
        return [_field_error("$", "TYPE_OBJECT_REQUIRED", "Dữ liệu đồng bộ phải là JSON object.")]

    allowed_top_level = set(TABLE_KEYS_FOR_VALIDATION) | {
        "deletions", "baseSyncVersion", "clientMutationId", "includeDashboardSummary",
    }
    for key in payload:
        if key not in allowed_top_level:
            errors.append(_field_error(key, "UNKNOWN_FIELD", "Trường không được hỗ trợ."))

    mutation_id = payload.get("clientMutationId")
    if mutation_id is not None and (
        not isinstance(mutation_id, str) or not mutation_id.strip() or len(mutation_id) > 128
    ):
        errors.append(_field_error(
            "clientMutationId", "INVALID_MUTATION_ID",
            "clientMutationId phải là chuỗi từ 1 đến 128 ký tự.",
        ))
    base_version = payload.get("baseSyncVersion")
    if base_version not in (None, ""):
        if isinstance(base_version, bool) or not re.fullmatch(r"\d+", str(base_version)):
            errors.append(_field_error(
                "baseSyncVersion", "INVALID_INTEGER",
                "baseSyncVersion phải là số nguyên không âm.",
            ))

    include_dashboard_summary = payload.get("includeDashboardSummary")
    if include_dashboard_summary is not None and not isinstance(include_dashboard_summary, bool):
        errors.append(_field_error(
            "includeDashboardSummary", "INVALID_BOOLEAN",
            "includeDashboardSummary phải là boolean.",
        ))

    deletions = payload.get("deletions", [])
    if not isinstance(deletions, list):
        errors.append(_field_error("deletions", "TYPE_ARRAY_REQUIRED", "deletions phải là mảng."))
    else:
        for index, deletion in enumerate(deletions):
            path = f"deletions[{index}]"
            if not isinstance(deletion, dict):
                errors.append(_field_error(path, "TYPE_OBJECT_REQUIRED", "Mục xóa phải là object."))
                continue
            unknown = set(deletion) - {"table", "id", "expectedVersion"}
            for key in sorted(unknown):
                errors.append(_field_error(f"{path}.{key}", "UNKNOWN_FIELD", "Trường không được hỗ trợ."))
            if deletion.get("table") not in TABLE_KEYS_FOR_VALIDATION:
                errors.append(_field_error(f"{path}.table", "INVALID_TABLE", "Bảng xóa không hợp lệ."))
            if not isinstance(deletion.get("id"), str) or not deletion.get("id", "").strip():
                errors.append(_field_error(f"{path}.id", "INVALID_ID", "ID xóa phải là chuỗi không rỗng."))
            expected_version = deletion.get("expectedVersion")
            if expected_version is not None and (
                not _is_strict_integer(expected_version) or expected_version <= 0
            ):
                errors.append(_field_error(
                    f"{path}.expectedVersion", "INVALID_ROW_VERSION",
                    "expectedVersion phải là số nguyên dương.",
                ))

    for payload_key, table_name in TABLE_KEYS_FOR_VALIDATION.items():
        if payload_key not in payload:
            continue
        items = payload[payload_key]
        if not isinstance(items, list):
            errors.append(_field_error(payload_key, "TYPE_ARRAY_REQUIRED", "Danh sách bản ghi phải là mảng."))
            continue
        table_spec = SCHEMA_DINH_NGHIA[table_name]
        columns = table_spec.get("columns", {})
        key_to_column = {}
        for column in columns:
            key_to_column[column] = column
            key_to_column[json_key_for_column(table_name, column)] = column
        allowed_item_keys = (
            set(key_to_column)
            | SYNC_CHILD_FIELDS.get(table_name, set())
            | SYNC_VIRTUAL_FIELDS.get(table_name, set())
            | {"expectedVersion"}
        )

        for index, item in enumerate(items):
            item_path = f"{payload_key}[{index}]"
            if not isinstance(item, dict):
                errors.append(_field_error(item_path, "TYPE_OBJECT_REQUIRED", "Bản ghi phải là object."))
                continue
            if not _validate_json_depth(item):
                errors.append(_field_error(item_path, "PAYLOAD_TOO_COMPLEX", "Bản ghi vượt giới hạn kích thước hoặc độ sâu."))
            for key in item:
                if key not in allowed_item_keys:
                    errors.append(_field_error(f"{item_path}.{key}", "UNKNOWN_FIELD", "Trường không được hỗ trợ."))
                    continue
                if key == "expectedVersion":
                    if not _is_strict_integer(item[key]) or item[key] <= 0:
                        errors.append(_field_error(
                            f"{item_path}.{key}", "INVALID_ROW_VERSION",
                            "expectedVersion phải là số nguyên dương.",
                        ))
                    continue
                if key in SYNC_VIRTUAL_FIELDS.get(table_name, set()):
                    value = item[key]
                    field_path = f"{item_path}.{key}"
                    if key == "danhGiaHsdtMetadata":
                        try:
                            parse_evaluation_metadata(value, require_version=True)
                        except ValueError as exc:
                            errors.append(_field_error(field_path, "INVALID_EVALUATION_METADATA", str(exc)))
                    elif key == "diemDanhGia":
                        if value is not None and (
                            isinstance(value, bool)
                            or not isinstance(value, (int, float))
                            or not math.isfinite(value)
                            or value < 0
                        ):
                            errors.append(_field_error(field_path, "INVALID_NUMBER", "Điểm đánh giá phải là số không âm hữu hạn."))
                    elif value is not None and not isinstance(value, str):
                        errors.append(_field_error(field_path, "INVALID_STRING", "Trường kết quả đánh giá phải là chuỗi."))
                    elif isinstance(value, str) and len(value) > MAX_SYNC_TEXT_LENGTH:
                        errors.append(_field_error(field_path, "STRING_TOO_LONG", "Chuỗi vượt quá giới hạn cho phép."))
                    continue
                if key in SYNC_CHILD_FIELDS.get(table_name, set()):
                    child_value = item[key]
                    if not isinstance(child_value, list):
                        errors.append(_field_error(f"{item_path}.{key}", "TYPE_ARRAY_REQUIRED", "Trường con phải là mảng."))
                    elif len(child_value) > MAX_SYNC_CHILD_ITEMS:
                        errors.append(_field_error(f"{item_path}.{key}", "INVALID_CHILD_LIST", "Danh sách con không hợp lệ hoặc quá dài."))
                    elif key == "goiThauIds":
                        if any(not isinstance(child, str) or not child.strip() for child in child_value):
                            errors.append(_field_error(f"{item_path}.{key}", "INVALID_ID_LIST", "Danh sách ID gói thầu không hợp lệ."))
                    elif key == "timelineItems":
                        _validate_timeline_items(child_value, item_path, errors)
                    else:
                        for child_index, child in enumerate(child_value):
                            child_path = f"{item_path}.{key}[{child_index}]"
                            if not isinstance(child, dict):
                                errors.append(_field_error(child_path, "TYPE_OBJECT_REQUIRED", "Bản ghi con phải là object."))
                                continue
                            for child_key, child_field_value in child.items():
                                field_path = f"{child_path}.{child_key}"
                                if child_field_value is None:
                                    continue
                                if child_key in CHILD_MONEY_FIELDS and parse_vnd_amount(child_field_value) is None:
                                    errors.append(_field_error(field_path, "INVALID_MONEY", "Số tiền phải là số nguyên không âm hợp lệ."))
                                elif child_key in CHILD_NUMBER_FIELDS:
                                    if (
                                        isinstance(child_field_value, bool)
                                        or not isinstance(child_field_value, (int, float))
                                        or not math.isfinite(child_field_value)
                                    ):
                                        errors.append(_field_error(field_path, "INVALID_NUMBER", "Giá trị phải là số hữu hạn."))
                                    elif child_key in {"tyLe", "ty_le"} and not 0 <= child_field_value <= 100:
                                        errors.append(_field_error(field_path, "VALUE_OUT_OF_RANGE", "Tỷ lệ phải nằm trong khoảng 0-100."))
                                    elif child_key in {"soLuong", "so_luong"} and child_field_value < 0:
                                        errors.append(_field_error(field_path, "VALUE_OUT_OF_RANGE", "Số lượng không được âm."))
                                elif isinstance(child_field_value, str) and len(child_field_value) > MAX_SYNC_TEXT_LENGTH:
                                    errors.append(_field_error(field_path, "STRING_TOO_LONG", "Chuỗi vượt quá giới hạn cho phép."))
                    continue

                column = key_to_column[key]
                value = item[key]
                definition = columns[column].upper()
                declared_type = definition.split(None, 1)[0]
                field_path = f"{item_path}.{key}"
                if value is None:
                    if "NOT NULL" in definition:
                        errors.append(_field_error(field_path, "NULL_NOT_ALLOWED", "Trường này không được là null."))
                    continue
                if (table_name, column) in MONEY_COLUMNS:
                    if parse_vnd_amount(value) is None:
                        errors.append(_field_error(field_path, "INVALID_MONEY", "Số tiền phải là số nguyên không âm hợp lệ."))
                elif declared_type == "INTEGER":
                    if column in BOOLEAN_COLUMNS:
                        if not (isinstance(value, bool) or (_is_strict_integer(value) and value in (0, 1))):
                            errors.append(_field_error(field_path, "INVALID_BOOLEAN", "Giá trị phải là boolean hoặc 0/1."))
                    elif not _is_strict_integer(value):
                        errors.append(_field_error(field_path, "INVALID_INTEGER", "Giá trị phải là số nguyên."))
                elif declared_type == "REAL":
                    if isinstance(value, bool) or not isinstance(value, (int, float)) or not math.isfinite(value):
                        errors.append(_field_error(field_path, "INVALID_NUMBER", "Giá trị phải là số hữu hạn."))
                    elif not _has_supported_decimal_precision(value):
                        errors.append(_field_error(field_path, "DECIMAL_PRECISION_EXCEEDED", "Giá trị chỉ được có tối đa 4 chữ số thập phân."))
                elif declared_type == "TEXT" and not isinstance(value, str):
                    errors.append(_field_error(field_path, "INVALID_STRING", "Giá trị phải là chuỗi."))
                elif isinstance(value, str) and len(value) > MAX_SYNC_TEXT_LENGTH:
                    errors.append(_field_error(field_path, "STRING_TOO_LONG", "Chuỗi vượt quá giới hạn cho phép."))
    return errors



def is_valid_date_format(val):
    if not val:
        return True
    return parse_datetime_value(val) is not None


def parse_date(val):
    return parse_datetime_value(val)


def validate_sync_item(table_name, item, allowed_contract_status_names=None):
    allowed_contract_status_names = allowed_contract_status_names or set()
    errors = []

    if table_name in {"chu_dau_tu", "nha_thau"} and not str(item.get("ngayApDung") or "").strip():
        created_at = str(item.get("createdAt") or "").strip()
        item["ngayApDung"] = created_at[:10] if parse_datetime_value(created_at) else vietnam_today().isoformat()

    if table_name == "chu_dau_tu":
        if not str(item.get("tenChuDauTu") or "").strip():
            errors.append("Tên chủ đầu tư không được để trống.")
        item["chucVuNguoiDungDau"] = derive_investor_head_position(
            item.get("chucVuDaiDien")
        )
    elif table_name == "ke_hoach_lcnt":
        _require_fields(item, (
            ("tenKeHoach", "Tên kế hoạch LCNT"),
            ("tenDuAnDuToan", "Tên dự án/dự toán"),
            ("loaiHinhMuaSam", "Loại hình mua sắm"),
            ("chuDauTuId", "Chủ đầu tư"),
            ("ngayPheDuyet", "Ngày phê duyệt kế hoạch"),
            ("quyetDinhPheDuyet", "Quyết định phê duyệt kế hoạch"),
        ), errors)
    elif table_name == "goi_thau":
        _require_fields(item, (
            ("keHoachId", "Kế hoạch LCNT liên kết"),
            ("tenGoiThau", "Tên gói thầu"),
            ("giaGoiThau", "Giá gói thầu"),
            ("thoiGianThucHien", "Thời gian thực hiện"),
            ("nguonVon", "Nguồn vốn"),
            ("thoiGianToChuc", "Thời gian tổ chức LCNT"),
            ("thoiGianBatDauToChuc", "Thời gian bắt đầu tổ chức"),
        ), errors)
    elif table_name == "nha_thau":
        if not str(item.get("tenNhaThau") or "").strip():
            errors.append("Tên nhà thầu không được để trống.")
        if str(item.get("loaiNhaThau") or "").strip() == "Liên danh" and str(item.get("maSoThue") or "").strip():
            errors.append(
                "Nhà thầu liên danh không dùng mã số thuế chung; mã số thuế thuộc từng thành viên liên danh."
            )
    elif table_name == "chuyen_gia":
        if not str(item.get("hoTen") or "").strip():
            errors.append("Họ và tên chuyên gia không được để trống.")
        cccd = item.get("soCCCD")
        if cccd and not re.match(r"^\d{12}$", str(cccd).strip()):
            errors.append("Số CCCD phải gồm đúng 12 chữ số.")
    elif table_name == "hop_dong":
        _require_fields(item, (
            ("tenHopDong", "Tên hợp đồng"),
            ("soHopDong", "Số hợp đồng"),
            ("ngayKy", "Ngày ký hợp đồng"),
            ("chuDauTuId", "Chủ đầu tư của hợp đồng"),
            ("nhaThauId", "Nhà thầu của hợp đồng"),
            ("keHoachId", "Kế hoạch LCNT của hợp đồng"),
            ("giaTri", "Giá trị hợp đồng"),
            ("loaiHopDong", "Loại hợp đồng"),
            ("soNgayThucHien", "Thời gian thực hiện hợp đồng"),
            ("trangThaiHopDong", "Trạng thái hợp đồng"),
        ), errors)
        if not _as_list(item.get("goiThauIds")):
            errors.append("Hợp đồng phải liên kết với ít nhất một gói thầu.")

    if table_name in {"nha_thau", "thong_tin_mo_thau"}:
        members = _as_list(item.get("thanhVienLienDanh"))
        is_joint_venture = str(item.get("loaiNhaThau") or "").strip().casefold() == "liên danh"
        if members and not is_joint_venture:
            errors.append("Nhà thầu độc lập không được chứa danh sách thành viên liên danh.")
        if is_joint_venture:
            if len(members) < 2:
                errors.append("Liên danh phải có ít nhất hai thành viên.")
            member_ids = []
            leader_count = 0
            allowed_roles = {"Đứng đầu liên danh", "Thành viên liên danh"}
            for index, member in enumerate(members):
                if not isinstance(member, dict):
                    errors.append(f"Thành viên liên danh thứ {index + 1} không hợp lệ.")
                    continue
                member_id = str(
                    member.get("thanhVienNhaThauId")
                    or member.get("thanh_vien_nha_thau_id")
                    or ""
                ).strip()
                role = str(member.get("vaiTro") or member.get("vai_tro") or "").strip()
                if not member_id:
                    errors.append(f"Thành viên liên danh thứ {index + 1} chưa liên kết nhà thầu.")
                else:
                    member_ids.append(member_id)
                if role not in allowed_roles:
                    errors.append(f"Vai trò thành viên liên danh thứ {index + 1} không hợp lệ.")
                elif role == "Đứng đầu liên danh":
                    leader_count += 1
            if len(member_ids) != len(set(member_ids)):
                errors.append("Một nhà thầu không được xuất hiện nhiều lần trong cùng liên danh.")
            if leader_count != 1:
                errors.append("Liên danh phải có đúng một thành viên đứng đầu.")

    table_spec = SCHEMA_DINH_NGHIA.get(table_name, {})
    explicit_json_fields = set(table_spec.get("json_fields", []))
    for col in table_spec.get("columns", {}).keys():
        is_json_field = col in explicit_json_fields or col.endswith("_list") or col.startswith("cv_")
        if not is_json_field:
            continue
        json_key = json_key_for_column(table_name, col)
        if json_key not in item:
            continue
        raw_json_value = item.get(json_key)
        if raw_json_value in (None, "") or isinstance(raw_json_value, (list, dict)):
            continue
        if isinstance(raw_json_value, str):
            try:
                parsed_json_value = json.loads(raw_json_value)
                if not isinstance(parsed_json_value, (list, dict)):
                    errors.append(f"Trường JSON '{json_key}' phải là mảng hoặc object.")
            except Exception:
                errors.append(f"Trường JSON '{json_key}' không đúng định dạng JSON.")
        else:
            errors.append(f"Trường JSON '{json_key}' phải là mảng, object hoặc chuỗi JSON hợp lệ.")

    email = item.get("email")
    if email and not re.match(r"^[^@\s]+@[^@\s]+\.[^@\s]+$", str(email).strip()):
        errors.append("Email không đúng định dạng.")

    phone = item.get("soDienThoai")
    if phone and not re.match(r"^[0-9\s+\-()]{9,15}$", str(phone).strip()):
        errors.append("Số điện thoại không đúng định dạng.")

    mst = item.get("maSoThue")
    is_auto_created_nt = False
    if table_name == "nha_thau":
        is_auto_created_nt = (
            mst
            and mst == item.get("maNhaThau")
            and not item.get("diaChi")
            and not item.get("soDienThoai")
            and not item.get("email")
        )

    if mst and not is_auto_created_nt and not re.match(r"^\d{10}$|^\d{13}$|^\d{10}-\d{3}$", str(mst).strip()):
        errors.append("Mã số thuế không đúng định dạng.")

    for date_key in DATE_KEYS_BY_TABLE.get(table_name, []):
        val = item.get(date_key)
        if val and not is_valid_date_format(str(val).strip()):
            errors.append(f"Trường ngày/giờ '{date_key}' không đúng định dạng.")

    if table_name == "goi_thau":
        is_rebid = item.get("isRebid") in (True, 1, "1", "true", "True")
        rebid_from = str(item.get("rebidFromPackageId") or "").strip()
        item["isRebid"] = 1 if is_rebid else 0
        item["rebidFromPackageId"] = rebid_from or None
        if is_rebid and not rebid_from:
            errors.append("Gói đấu thầu lại phải tham chiếu gói thầu nguồn.")
        if not is_rebid and rebid_from:
            errors.append("Gói không đấu thầu lại không được tham chiếu gói thầu nguồn.")
        if rebid_from and str(item.get("id") or "").strip() == rebid_from:
            errors.append("Gói đấu thầu lại không được tự tham chiếu.")

        raw_status = item.get("trangThai") or "Chuẩn bị"
        item["trangThai"] = raw_status
        if raw_status:
            normalized_status = LEGACY_PACKAGE_STATUS_ALIASES.get(str(raw_status).strip(), str(raw_status).strip())
            item["trangThai"] = normalized_status
            if normalized_status not in PACKAGE_STATUSES:
                errors.append(f"Trạng thái gói thầu '{raw_status}' không hợp lệ.")

        dang_tai = parse_date(item.get("thoiGianDangTai"))
        dong_thau = parse_date(item.get("thoiGianDongThau"))
        mo_thau = parse_date(item.get("thoiGianMoThau"))
        if dang_tai and dong_thau and dong_thau <= dang_tai:
            errors.append("Thời gian đóng thầu phải sau thời gian đăng tải.")
        if dong_thau and mo_thau and mo_thau < dong_thau:
            errors.append("Thời gian mở thầu phải bằng hoặc sau thời gian đóng thầu.")

        status_order = {
            "Đang mời thầu": 1,
            "Đã mở thầu": 2,
            "Đang chấm thầu": 3,
            "Đã có kết quả": 4,
        }
        status_level = status_order.get(item.get("trangThai"), 0)
        is_direct_or_special = str(item.get("hinhThucLuaChon") or "").strip() in {
            "Chỉ định thầu rút gọn",
            "Lựa chọn nhà thầu trong trường hợp đặc biệt",
        }
        if status_level >= 1 and not is_direct_or_special:
            _require_fields(item, (
                ("thoiGianDangTai", "Thời gian đăng tải"),
                ("thoiGianDongThau", "Thời gian đóng thầu"),
            ), errors)
            hieu_luc = safe_int(item.get("hieuLucHsdt"))
            if hieu_luc is None or hieu_luc <= 0:
                errors.append("Hiệu lực HSDT phải lớn hơn 0 khi gói đã mời thầu.")
        if status_level >= 2 and not is_direct_or_special:
            _require_fields(item, (("thoiGianMoThau", "Thời gian mở thầu"),), errors)
        is_lotted_package = str(item.get("phanLo") or "").strip() == "Có"
        if status_level >= 4:
            _require_fields(item, (
                ("soQuyetDinhKetQua", "Số quyết định kết quả"),
                ("ngayQuyetDinhKetQua", "Ngày quyết định kết quả"),
                ("giaTrungThau", "Giá trúng thầu"),
            ), errors)
            if not is_lotted_package:
                _require_fields(
                    item,
                    (("nhaThauTrungThauId", "Nhà thầu trúng thầu"),),
                    errors,
                )

        phan_lo_list = _as_list(item.get("phanLoList"))
        if str(item.get("phanLo") or "").strip() == "Có":
            if not phan_lo_list:
                errors.append("Gói thầu phân lô phải có ít nhất một phần lô.")
            normalized_codes = []
            lot_total = 0
            for index, lot in enumerate(phan_lo_list):
                if not isinstance(lot, dict):
                    continue
                code = str(lot.get("maPhanLo") or lot.get("ma_phan_lo") or "").strip().casefold()
                if not code:
                    errors.append(f"Phần lô thứ {index + 1} chưa có mã phần lô.")
                else:
                    normalized_codes.append(code)
                value = parse_vnd_amount(lot.get("giaTriPhanLo", lot.get("gia_tri_phan_lo")))
                if value is not None:
                    lot_total += value
            if len(normalized_codes) != len(set(normalized_codes)):
                errors.append("Mã phần lô không được trùng trong cùng gói thầu.")
            package_value = parse_vnd_amount(item.get("giaGoiThau"))
            if package_value is not None and phan_lo_list and lot_total != package_value:
                errors.append("Tổng giá trị các phần lô phải bằng giá gói thầu.")
        elif phan_lo_list:
            errors.append("Gói không phân lô không được chứa danh sách phần lô.")

        if status_level >= 4 and is_lotted_package:
            awarded_lots = _as_list(item.get("awardedPhanLoList"))
            if not awarded_lots:
                awarded_lots = [
                    lot for lot in phan_lo_list
                    if isinstance(lot, dict) and (
                        lot.get("nhaThauTrungThauId") or lot.get("nha_thau_trung_thau_id")
                    )
                ]
            if not awarded_lots:
                errors.append("Gói phân lô đã có kết quả phải có kết quả trúng thầu từng phần lô.")
            known_codes = {
                str(lot.get("maPhanLo") or lot.get("ma_phan_lo") or "").strip().casefold()
                for lot in phan_lo_list if isinstance(lot, dict)
            }
            awarded_codes = []
            awarded_total = 0
            awarded_winner_ids = set()
            for lot in awarded_lots:
                if not isinstance(lot, dict):
                    continue
                code = str(lot.get("maPhanLo") or lot.get("ma_phan_lo") or "").strip().casefold()
                winner = str(lot.get("nhaThauTrungThauId") or lot.get("nha_thau_trung_thau_id") or "").strip()
                value = parse_vnd_amount(lot.get("giaTrungThau", lot.get("gia_trung_thau")))
                awarded_codes.append(code)
                if not code or code not in known_codes:
                    errors.append("Kết quả trúng thầu chứa phần lô không thuộc gói thầu.")
                if not winner:
                    errors.append("Mỗi phần lô trúng thầu phải xác định nhà thầu trúng thầu.")
                else:
                    awarded_winner_ids.add(winner)
                if value is None:
                    errors.append("Mỗi phần lô trúng thầu phải có giá trúng thầu hợp lệ.")
                else:
                    awarded_total += value
            if len(awarded_codes) != len(set(awarded_codes)):
                errors.append("Một phần lô không được xuất hiện nhiều lần trong kết quả trúng thầu.")
            if awarded_lots:
                # Derived financial totals are server-authoritative. The UI may
                # preview the value, but cannot persist a divergent total.
                item["giaTrungThau"] = str(awarded_total)
                # The legacy package winner remains a compatibility projection
                # only when every awarded lot has the same winner. Lot results
                # are the source of truth for a lotted package.
                item["nhaThauTrungThauId"] = (
                    next(iter(awarded_winner_ids))
                    if len(awarded_winner_ids) == 1
                    else None
                )

        option_list = _as_list(item.get("tuyChonMuaThemList"))
        if str(item.get("tuyChonMuaThem") or "").strip() == "Có" and not option_list:
            errors.append("Gói có tùy chọn mua thêm phải khai báo ít nhất một hạng mục.")
        if str(item.get("tuyChonMuaThem") or "").strip() != "Có" and option_list:
            errors.append("Gói không có tùy chọn mua thêm không được chứa danh sách tùy chọn.")

        _validate_single_team_leader(item, "toChuyenGia", "Tổ chuyên gia", errors)
        _validate_single_team_leader(item, "toThamDinh", "Tổ thẩm định", errors)

        phuong_phap = str(item.get("phuongPhapDanhGia") or "").strip()
        if phuong_phap != "Kết hợp giữa kỹ thuật và giá":
            item["trongSoKyThuat"] = None

        trong_so = item.get("trongSoKyThuat")
        if trong_so is not None:
            ts_val = safe_int(trong_so)
            if ts_val is not None and (ts_val < 0 or ts_val > 100):
                errors.append("Trọng số kỹ thuật phải nằm trong khoảng 0-100.")

        gia = item.get("giaGoiThau")
        if gia not in (None, ""):
            gia_val = parse_vnd_amount(gia)
            if gia_val is None:
                errors.append("Giá gói thầu không được nhỏ hơn 0.")

    elif table_name == "ke_hoach_lcnt":
        is_auto = item.get("isTongMucTuDong")
        item["isTongMucTuDong"] = 1 if (is_auto is True or str(is_auto) in ("1", "true", "True")) else 0

        tong_muc = item.get("tongMucDauTu")
        if tong_muc not in (None, ""):
            tm_val = parse_vnd_amount(tong_muc)
            if tm_val is None:
                errors.append("Tổng mức đầu tư không được nhỏ hơn 0.")

        if str(item.get("loaiHinhMuaSam") or "").strip() == "Dự án":
            _require_fields(item, (
                ("maDuan", "Mã dự án"),
                ("soQdPheDuyetDuAn", "Số quyết định phê duyệt dự án"),
                ("ngayQdPheDuyetDuAn", "Ngày quyết định phê duyệt dự án"),
                ("coQuanPheDuyetDuAn", "Cơ quan phê duyệt dự án"),
            ), errors)
        if str(item.get("pheDuyet") or "").strip() == "Kế hoạch":
            _require_fields(item, (
                ("soToTrinhDuToan", "Số tờ trình dự toán"),
                ("ngayTrinhDuToan", "Ngày trình dự toán"),
                ("ngayPheDuyetDuToan", "Ngày phê duyệt dự toán"),
                ("soQdPheDuyetDuToan", "Số quyết định phê duyệt dự toán"),
                ("soToTrinhKeHoach", "Số tờ trình kế hoạch"),
                ("ngayTrinhKeHoach", "Ngày trình kế hoạch"),
            ), errors)
        elif str(item.get("pheDuyet") or "").strip() == "Dự toán và kế hoạch":
            _require_fields(item, (
                ("soToTrinhDuToanKeHoach", "Số tờ trình dự toán và kế hoạch"),
                ("ngayTrinhKeHoach", "Ngày trình dự toán và kế hoạch"),
            ), errors)
        plan_date_pairs = (
            ("ngayTrinhDuToan", "ngayPheDuyetDuToan", "Ngày phê duyệt dự toán không được trước ngày trình dự toán."),
            ("ngayTrinhKeHoach", "ngayPheDuyet", "Ngày phê duyệt kế hoạch không được trước ngày trình kế hoạch."),
        )
        for start_key, end_key, message in plan_date_pairs:
            start_date = parse_date(item.get(start_key))
            end_date = parse_date(item.get(end_key))
            if start_date and end_date and end_date < start_date:
                errors.append(message)

    elif table_name == "hop_dong":
        gia_tri = item.get("giaTri")
        if gia_tri not in (None, ""):
            gt_val = parse_vnd_amount(gia_tri)
            if gt_val is None:
                errors.append("Giá trị hợp đồng không được nhỏ hơn 0.")
        signed_date = parse_date(item.get("ngayKy"))
        liquidation_date = parse_date(item.get("ngayThanhLy"))
        if signed_date and liquidation_date and liquidation_date < signed_date:
            errors.append("Ngày thanh lý không được trước ngày ký hợp đồng.")
        is_direct_award = item.get("coQdChiDinh") in (True, 1, "1", "true", "True")
        if is_direct_award:
            _require_fields(item, (
                ("soQdChiDinh", "Số quyết định chỉ định thầu"),
                ("ngayQdChiDinh", "Ngày quyết định chỉ định thầu"),
            ), errors)
            decision_date = parse_date(item.get("ngayQdChiDinh"))
            if signed_date and decision_date and decision_date > signed_date:
                errors.append("Ngày quyết định chỉ định thầu không được sau ngày ký hợp đồng.")
        elif not _is_blank(item.get("soQdChiDinh")) or not _is_blank(item.get("ngayQdChiDinh")):
            errors.append("Thông tin quyết định chỉ định thầu phải để trống khi không áp dụng.")
        contract_status = str(item.get("trangThaiHopDong") or "Đang thực hiện").strip()
        item["trangThaiHopDong"] = contract_status
        if contract_status not in allowed_contract_status_names:
            errors.append("Trạng thái hợp đồng không tồn tại trong danh mục của tổ chức.")

    elif table_name == "danh_muc_trang_thai_hop_dong":
        status_name = item.get("name") or item.get("tenTrangThai")
        status_color = item.get("color") or item.get("mauSac") or DEFAULT_CONTRACT_STATUS_COLOR
        if not status_name or not str(status_name).strip():
            errors.append("Tên trạng thái hợp đồng không được để trống.")
        if status_color and not re.match(r"^#[0-9a-fA-F]{6}$", str(status_color).strip()):
            errors.append("Màu trạng thái hợp đồng phải ở dạng HEX.")

    elif table_name == "thong_tin_mo_thau":
        bid_price = parse_vnd_amount(item.get("giaDuThau"))
        discounted_price = parse_vnd_amount(item.get("giaSauGiamGia"))
        discount_rate = item.get("tyLeGiamGia")
        if bid_price is not None and discount_rate not in (None, ""):
            try:
                rate = Decimal(str(discount_rate))
                expected = (
                    Decimal(bid_price) * (Decimal("100") - rate) / Decimal("100")
                ).quantize(Decimal("1"), rounding=ROUND_HALF_UP)
                item["giaSauGiamGia"] = str(int(expected))
            except (InvalidOperation, ValueError):
                errors.append("Tỷ lệ giảm giá không hợp lệ.")
        elif bid_price is not None and discount_rate in (None, ""):
            item["giaSauGiamGia"] = str(bid_price)

    return item, errors, set()
