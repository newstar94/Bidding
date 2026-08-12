"""Map Mua Sắm Công codes to Bidding's Vietnamese domain values.

The raw bundle remains the source of truth.  These functions only build the
canonical projection used by previews and persistence.  Unknown open-ended
codes are returned unchanged so a future mapping release can reprocess the
stored raw bundle without having guessed a business meaning.
"""

from __future__ import annotations

import unicodedata


def _key(value: object) -> str:
    text = "" if value is None else str(value).strip()
    if not text:
        return ""
    folded = unicodedata.normalize("NFD", text.casefold())
    return "".join(
        character
        for character in folded
        if not unicodedata.combining(character)
    ).upper()


def _table(*entries: tuple[tuple[str, ...], str]) -> dict[str, str]:
    return {
        _key(alias): label
        for aliases, label in entries
        for alias in (*aliases, label)
    }


PACKAGE_FIELDS = _table(
    (("HH",), "Hàng hóa"),
    (("XL",), "Xây lắp"),
    (("TV",), "Tư vấn"),
    (("PTV",), "Phi tư vấn"),
    (("HON_HOP",), "Hỗn hợp"),
)

SELECTION_FORMS = _table(
    (("DTRR",), "Đấu thầu rộng rãi"),
    (("DTHC",), "Đấu thầu hạn chế"),
    (("CDT",), "Chỉ định thầu"),
    (("CDTRG",), "Chỉ định thầu rút gọn"),
    (("CHCT",), "Chào hàng cạnh tranh"),
    (("LCNT_DB",), "Lựa chọn nhà thầu trong trường hợp đặc biệt"),
)

SELECTION_MODES = _table(
    (("1_MTHS",), "Một giai đoạn một túi hồ sơ"),
    (("1_HTHS",), "Một giai đoạn hai túi hồ sơ"),
    (("2_MTHS",), "Hai giai đoạn một túi hồ sơ"),
    (("2_HTHS",), "Hai giai đoạn hai túi hồ sơ"),
    (("NONE",), "Không có"),
)

CONTRACT_TYPES = _table(
    (("TG", "TRON_GOI"), "Trọn gói"),
    (
        ("DGCD", "DON_GIA_CO_DINH", "Đơn giá cố định"),
        "Theo đơn giá cố định",
    ),
    (
        ("DGDC", "DON_GIA_DIEU_CHINH", "Đơn giá điều chỉnh"),
        "Theo đơn giá điều chỉnh",
    ),
    (("TTG", "THEO_THOI_GIAN"), "Theo thời gian"),
    (("HON_HOP", "Hợp đồng hỗn hợp"), "Hỗn hợp"),
)


def _map_open(value: object, table: dict[str, str]):
    if value is None:
        return None
    text = str(value).strip()
    if not text:
        return None
    return table.get(_key(text), text)


def map_package_field(value: object):
    return _map_open(value, PACKAGE_FIELDS)


def map_selection_form(value: object):
    return _map_open(value, SELECTION_FORMS)


def map_selection_mode(value: object):
    return _map_open(value, SELECTION_MODES)


def map_contract_type(value: object):
    return _map_open(value, CONTRACT_TYPES)


def _map_flag(value: object, *, true_label: str, false_label: str):
    if value is None or (isinstance(value, str) and not value.strip()):
        return None
    normalized = _key(value)
    if normalized in {"1", "TRUE", "YES", "Y", _key(true_label)}:
        return true_label
    if normalized in {"0", "FALSE", "NO", "N", _key(false_label)}:
        return false_label
    # These two fields have DB CHECK constraints.  Returning None is safer
    # than persisting an invented interpretation; the raw value is retained.
    return None


def map_online_mode(value: object):
    return _map_flag(value, true_label="Qua mạng", false_label="Không qua mạng")


def map_domestic_scope(value: object):
    return _map_flag(value, true_label="Trong nước", false_label="Quốc tế")


def map_optional_boolean(value: object):
    """Map observed 0/1 package flags without inventing unknown truthiness."""

    if value is None or (isinstance(value, str) and not value.strip()):
        return None
    normalized = _key(value)
    if normalized in {"1", "TRUE", "YES", "Y", "CO"}:
        return True
    if normalized in {"0", "FALSE", "NO", "N", "KHONG"}:
        return False
    return None
