"""Stable persisted domain values and Vietnamese API labels."""

import unicodedata

PACKAGE_STATUS_LABELS = {
    "UNKNOWN": "Chưa xác định",
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
PLAN_APPROVAL_TYPE_LABELS = (
    "Kế hoạch",
    "Dự toán và kế hoạch",
)


def _reverse(mapping):
    return {label: code for code, label in mapping.items()}


PACKAGE_STATUS_CODES = _reverse(PACKAGE_STATUS_LABELS)
PACKAGE_STATUS_CODES["Huỷ thầu"] = "CANCELLED"
PERSISTED_ENUM_FIELDS = {
    ("goi_thau", "trang_thai"): (PACKAGE_STATUS_LABELS, PACKAGE_STATUS_CODES),
}


def _filter_key(value):
    text = " ".join(str(value).strip().split()).casefold().replace("đ", "d")
    return "".join(
        character
        for character in unicodedata.normalize("NFKD", text)
        if unicodedata.category(character) != "Mn"
    )


def _filter_aliases(labels, *, persist_codes):
    aliases = {}
    for code, label in labels.items():
        persisted_value = code if persist_codes else label
        for alias in (code, code.replace("_", " "), label):
            aliases[_filter_key(alias)] = persisted_value
    return aliases


FILTER_ENUM_FIELDS = {
    ("goi_thau", "trang_thai"): _filter_aliases(PACKAGE_STATUS_LABELS, persist_codes=True),
    ("ke_hoach_lcnt", "phe_duyet"): {
        _filter_key(label): label for label in PLAN_APPROVAL_TYPE_LABELS
    },
}
USER_DEFINED_ENUM_FIELDS = frozenset({
    ("hop_dong", "trang_thai_hop_dong"),
})


def enum_filter_value(table_name, column_name, value):
    """Return the canonical persisted value for a user/model supplied filter."""
    if value is None:
        return None
    text = str(value).strip()
    aliases = FILTER_ENUM_FIELDS.get((table_name, column_name))
    return aliases.get(_filter_key(text), text) if aliases else text


def is_user_defined_enum_filter(table_name, column_name):
    """Return whether a filter targets workspace-defined display labels."""
    return (table_name, column_name) in USER_DEFINED_ENUM_FIELDS


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
