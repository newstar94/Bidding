from datetime import datetime
from zoneinfo import ZoneInfo


VIETNAM_TIMEZONE_NAME = "Asia/Ho_Chi_Minh"
VIETNAM_TIMEZONE = ZoneInfo(VIETNAM_TIMEZONE_NAME)


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
    if value is None or (isinstance(value, str) and not value.strip()):
        return None
    parsed = parse_datetime_value(value)
    if not parsed:
        return value
    return parsed.strftime("%Y-%m-%d %H:%M:%S")


def normalize_date_value(value):
    """Canonical persisted business date without a synthetic midnight."""
    if value is None or (isinstance(value, str) and not value.strip()):
        return None
    parsed = parse_datetime_value(value)
    if not parsed:
        return value
    return parsed.strftime("%Y-%m-%d")


def vietnam_now():
    """Return the current timezone-aware Vietnam business time."""
    return datetime.now(VIETNAM_TIMEZONE)


def vietnam_today():
    """Return the current business date in Vietnam."""
    return vietnam_now().date()


def vietnam_now_sql():
    """Canonical SQL wall-clock timestamp in Asia/Ho_Chi_Minh."""
    return vietnam_now().strftime("%Y-%m-%d %H:%M:%S")


def vietnam_date_from_epoch(value):
    """Format a Unix instant as its Vietnam business date."""
    if value in (None, ""):
        return None
    return datetime.fromtimestamp(int(value), VIETNAM_TIMEZONE).strftime("%Y-%m-%d")
