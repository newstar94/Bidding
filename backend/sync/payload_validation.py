import json
import math
import re
from datetime import datetime, timezone

from backend.db.schema import MONEY_COLUMNS, SCHEMA_DINH_NGHIA
from .mapper import json_key_for_column
from .queries import TABLE_KEYS
from backend.shared.date_utils import is_datetime_column, parse_datetime_value
from backend.shared.text_utils import safe_int
from backend.shared.numeric_utils import parse_vnd_amount
from backend.sync.evaluation_metadata import parse_evaluation_metadata


PACKAGE_STATUSES = {"Chuẩn bị", "Đang mời thầu", "Đã mở thầu", "Đang chấm thầu", "Đã có kết quả", "Hủy thầu"}
LEGACY_PACKAGE_STATUS_ALIASES = {
    "Huỷ thầu": "Hủy thầu"
}
DEFAULT_PAPER_STATUS_COLOR = "#64748b"
PLAIN_TEXT_FIELDS = {"thoi_gian_bat_dau_to_chuc"}
DATE_KEYS_BY_TABLE = {
    table_name: [
        json_key_for_column(table_name, col)
        for col in table_spec.get("columns", {}).keys()
        if is_datetime_column(col) and col not in PLAIN_TEXT_FIELDS
    ]
    for table_name, table_spec in SCHEMA_DINH_NGHIA.items()
}

SYNC_CHILD_FIELDS = {
    "ke_hoach_lcnt": {
        "cvDaThucHienList", "cvKhongApDungList", "cvChuaDuDieuKienList",
    },
    "goi_thau": {
        "phanLoList", "awardedPhanLoList", "tuyChonMuaThemList", "giaHanList",
        "yeuCauLamRoList", "traLoiLamRoList", "toChuyenGia", "toThamDinh",
    },
    "nha_thau": {"thanhVienLienDanh"},
    "thong_tin_mo_thau": {"thanhVienLienDanh"},
    "hop_dong": {"goiThauIds"},
}
SYNC_VIRTUAL_FIELDS = {
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
    "is_latest", "is_tong_muc_tu_dong", "is_thuoc", "co_qd_chi_dinh",
}
TABLE_KEYS_FOR_VALIDATION = TABLE_KEYS
CHILD_MONEY_FIELDS = {
    "giaTri", "gia_tri", "giaTriPhanLo", "gia_tri_phan_lo",
    "baoDamDuThau", "bao_dam_du_thau", "giaTrungThau", "gia_trung_thau",
    "giaTriUocTinh", "gia_tri_uoc_tinh",
}
CHILD_NUMBER_FIELDS = {"soLuong", "so_luong", "tyLe", "ty_le"}


def _field_error(path, code, message):
    return {"field": path, "code": code, "message": message}


def _is_strict_integer(value):
    return isinstance(value, int) and not isinstance(value, bool)


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
        "deletions", "baseSyncVersion", "clientMutationId", "upserts",
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

    upserts = payload.get("upserts")
    if upserts is not None and not isinstance(upserts, dict):
        errors.append(_field_error("upserts", "TYPE_OBJECT_REQUIRED", "upserts phải là object."))
    elif isinstance(upserts, dict):
        for key, values in upserts.items():
            if key not in TABLE_KEYS_FOR_VALIDATION:
                errors.append(_field_error(f"upserts.{key}", "INVALID_TABLE", "Bảng upsert không hợp lệ."))
            elif not isinstance(values, (list, dict)) or not _validate_json_depth(values):
                errors.append(_field_error(f"upserts.{key}", "PAYLOAD_TOO_COMPLEX", "Upsert không hợp lệ hoặc vượt giới hạn."))

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
                    if key == "diemDanhGia":
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
                field_path = f"{item_path}.{key}"
                if table_name == "goi_thau" and column == "danh_gia_hsdt_metadata":
                    try:
                        parse_evaluation_metadata(value, require_version=True)
                    except ValueError as exc:
                        errors.append(_field_error(field_path, "INVALID_EVALUATION_METADATA", str(exc)))
                    continue
                if value is None:
                    if "NOT NULL" in definition:
                        errors.append(_field_error(field_path, "NULL_NOT_ALLOWED", "Trường này không được là null."))
                    continue
                if (table_name, column) in MONEY_COLUMNS:
                    if parse_vnd_amount(value) is None:
                        errors.append(_field_error(field_path, "INVALID_MONEY", "Số tiền phải là số nguyên không âm hợp lệ."))
                elif "INTEGER" in definition:
                    if column in BOOLEAN_COLUMNS:
                        if not (isinstance(value, bool) or (_is_strict_integer(value) and value in (0, 1))):
                            errors.append(_field_error(field_path, "INVALID_BOOLEAN", "Giá trị phải là boolean hoặc 0/1."))
                    elif not _is_strict_integer(value):
                        errors.append(_field_error(field_path, "INVALID_INTEGER", "Giá trị phải là số nguyên."))
                elif "REAL" in definition:
                    if isinstance(value, bool) or not isinstance(value, (int, float)) or not math.isfinite(value):
                        errors.append(_field_error(field_path, "INVALID_NUMBER", "Giá trị phải là số hữu hạn."))
                elif "TEXT" in definition and not isinstance(value, str):
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


def validate_sync_item(table_name, item, incoming_paper_status_names=None):
    incoming_paper_status_names = incoming_paper_status_names or set()
    errors = []
    paper_statuses_to_seed = set()

    if table_name in {"chu_dau_tu", "nha_thau"} and not str(item.get("ngayApDung") or "").strip():
        created_at = str(item.get("createdAt") or "").strip()
        item["ngayApDung"] = created_at[:10] if parse_datetime_value(created_at) else datetime.now(timezone.utc).strftime("%Y-%m-%d")

    if table_name == "chu_dau_tu":
        if not str(item.get("tenChuDauTu") or "").strip():
            errors.append("Tên chủ đầu tư không được để trống.")
    elif table_name == "ke_hoach_lcnt":
        if not str(item.get("tenKeHoach") or "").strip():
            errors.append("Tên kế hoạch LCNT không được để trống.")
    elif table_name == "goi_thau":
        if not str(item.get("tenGoiThau") or "").strip():
            errors.append("Tên gói thầu không được để trống.")
    elif table_name == "nha_thau":
        if not str(item.get("tenNhaThau") or "").strip():
            errors.append("Tên nhà thầu không được để trống.")
    elif table_name == "chuyen_gia":
        if not str(item.get("hoTen") or "").strip():
            errors.append("Họ và tên chuyên gia không được để trống.")
        cccd = item.get("soCCCD")
        if cccd and not re.match(r"^\d{12}$", str(cccd).strip()):
            errors.append("Số CCCD phải gồm đúng 12 chữ số.")
    elif table_name == "hop_dong":
        if not str(item.get("tenHopDong") or "").strip():
            errors.append("Tên hợp đồng không được để trống.")
        if not str(item.get("soHopDong") or "").strip():
            errors.append("Số hợp đồng không được để trống.")

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
        raw_status = item.get("trangThai")
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

    elif table_name == "hop_dong":
        gia_tri = item.get("giaTri")
        if gia_tri not in (None, ""):
            gt_val = parse_vnd_amount(gia_tri)
            if gt_val is None:
                errors.append("Giá trị hợp đồng không được nhỏ hơn 0.")
        trang_thai_hs = item.get("trangThaiHoSo")
        if trang_thai_hs:
            trang_thai_hs = str(trang_thai_hs).strip()
            if trang_thai_hs not in incoming_paper_status_names:
                paper_statuses_to_seed.add(trang_thai_hs)

    elif table_name == "trang_thai_ho_so_giay":
        status_name = item.get("name") or item.get("tenTrangThai")
        status_color = item.get("color") or item.get("mauSac") or DEFAULT_PAPER_STATUS_COLOR
        if not status_name or not str(status_name).strip():
            errors.append("Tên trạng thái hồ sơ giấy không được để trống.")
        if status_color and not re.match(r"^#[0-9a-fA-F]{6}$", str(status_color).strip()):
            errors.append("Màu trạng thái hồ sơ giấy phải ở dạng HEX.")

    return item, errors, paper_statuses_to_seed
