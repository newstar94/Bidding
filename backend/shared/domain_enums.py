"""Stable persisted domain codes and Vietnamese API labels."""

PACKAGE_STATUS_LABELS = {
    "PREPARING": "Chuẩn bị", "INVITED": "Đang mời thầu",
    "OPENED": "Đã mở thầu", "EVALUATING": "Đang chấm thầu",
    "PARTIALLY_AWARDED": "Đã có kết quả một phần",
    "AWARDED": "Đã có kết quả", "CANCELLED": "Hủy thầu",
}
CONTRACT_STATUS_LABELS = {
    "NOT_EFFECTIVE": "Chưa hiệu lực", "ACTIVE": "Đang thực hiện",
    "SUSPENDED": "Tạm dừng", "COMPLETED": "Đã hoàn thành",
    "LIQUIDATED": "Đã thanh lý", "CANCELLED": "Đã hủy",
}


def _reverse(mapping):
    return {label: code for code, label in mapping.items()}


PACKAGE_STATUS_CODES = _reverse(PACKAGE_STATUS_LABELS)
PACKAGE_STATUS_CODES["Huỷ thầu"] = "CANCELLED"
PERSISTED_ENUM_FIELDS = {
    ("goi_thau", "trang_thai"): (PACKAGE_STATUS_LABELS, PACKAGE_STATUS_CODES),
}


def enum_code(table_name, column_name, value):
    if value is None:
        return None
    contract = PERSISTED_ENUM_FIELDS.get((table_name, column_name))
    if not contract:
        return value
    labels, codes = contract
    text = str(value).strip()
    return text if text in labels else codes.get(text, text)


def enum_label(table_name, column_name, value):
    if value is None:
        return None
    contract = PERSISTED_ENUM_FIELDS.get((table_name, column_name))
    return contract[0].get(str(value).strip(), value) if contract else value
