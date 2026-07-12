import json
import re
from datetime import datetime

from .schema import SCHEMA_DINH_NGHIA
from .sync_mapper import json_key_for_column
from .date_utils import is_datetime_column, parse_datetime_value
from .text_utils import safe_float, safe_int


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
        item["ngayApDung"] = created_at[:10] if parse_datetime_value(created_at) else datetime.now().strftime("%Y-%m-%d")

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
        if gia is not None:
            gia_val = safe_float(gia)
            if gia_val is not None and gia_val < 0:
                errors.append("Giá gói thầu không được nhỏ hơn 0.")

    elif table_name == "ke_hoach_lcnt":
        is_auto = item.get("isTongMucTuDong")
        item["isTongMucTuDong"] = 1 if (is_auto is True or str(is_auto) in ("1", "true", "True")) else 0

        tong_muc = item.get("tongMucDauTu")
        if tong_muc is not None:
            tm_val = safe_float(tong_muc)
            if tm_val is not None and tm_val < 0:
                errors.append("Tổng mức đầu tư không được nhỏ hơn 0.")

    elif table_name == "hop_dong":
        gia_tri = item.get("giaTri")
        if gia_tri is not None:
            gt_val = safe_float(gia_tri)
            if gt_val is not None and gt_val < 0:
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
