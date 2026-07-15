from datetime import datetime, timezone


DATETIME_COLUMNS = {
    "thoi_gian_dang_tai",
    "thoi_gian_dang_ma",
    "thoi_gian_dong_thau",
    "thoi_gian_mo_thau",
    "thoi_gian_mo_ehsdxtc",
    "thoi_gian",
}


def is_datetime_column(column_name):
    if not column_name:
        return False
    return column_name.startswith("ngay_") or column_name in DATETIME_COLUMNS


def parse_datetime_value(value):
    if value in (None, ""):
        return None
    text = str(value).strip()
    if not text:
        return None
    text = text.replace("T", " ")
    formats = (
        "%Y-%m-%d %H:%M:%S",
        "%Y-%m-%d %H:%M",
        "%Y-%m-%d",
        "%d/%m/%Y %H:%M:%S",
        "%d/%m/%Y %H:%M",
        "%d/%m/%Y",
    )
    for fmt in formats:
        try:
            return datetime.strptime(text, fmt)
        except ValueError:
            pass
    return None


def normalize_datetime_value(value):
    parsed = parse_datetime_value(value)
    if not parsed:
        return value
    return parsed.strftime("%Y-%m-%d %H:%M:%S")


def normalize_date_value(value):
    """Canonical persisted business date without a synthetic midnight."""
    parsed = parse_datetime_value(value)
    if not parsed:
        return value
    return parsed.strftime("%Y-%m-%d")


def utc_now_sql():
    """Canonical persisted technical timestamp: UTC, second precision."""
    return datetime.now(timezone.utc).strftime("%Y-%m-%d %H:%M:%S")
