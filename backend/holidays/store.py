"""File-backed holiday calendar with validation, atomic writes and reload.

``holidays.json`` stays the single source of truth so every existing reader
(the browser calendar, dashboard working-day rules, Word formulas) keeps the
same format: ``{"2026": {"holidays": [...], "working_weekends": [...]}}``.
Readers detect edits by file signature, so a change made through the admin
console reaches every worker process without a restart.
"""

from __future__ import annotations

from datetime import date
import json
import os
import tempfile
import threading

from backend.shared.paths import PROJECT_ROOT


MIN_YEAR = 2000
MAX_YEAR = 2100
MAX_DATES_PER_YEAR = 120
_lock = threading.Lock()
_cache = {"signature": None, "data": {}}


class HolidayValidationError(ValueError):
    """The submitted calendar is not a valid holiday definition."""


def holidays_path():
    return os.environ.get("HOLIDAYS_FILE") or os.path.join(str(PROJECT_ROOT), "holidays.json")


def _signature(path):
    try:
        stat = os.stat(path)
    except OSError:
        return None
    return (stat.st_mtime_ns, stat.st_size)


def load_holidays():
    """Return the current calendar; re-read only when the file changed."""

    path = holidays_path()
    signature = _signature(path)
    if signature is not None and signature == _cache["signature"]:
        return _cache["data"]
    with _lock:
        signature = _signature(path)
        if signature is not None and signature == _cache["signature"]:
            return _cache["data"]
        try:
            with open(path, "r", encoding="utf-8") as stream:
                data = json.load(stream)
            if not isinstance(data, dict):
                data = {}
        except (OSError, UnicodeError, json.JSONDecodeError):
            data = {}
        _cache.update(signature=signature, data=data)
        return data


def _parse_day(value, year):
    try:
        parsed = date.fromisoformat(str(value).strip())
    except ValueError as exc:
        raise HolidayValidationError(f"Ngày không hợp lệ: {value}.") from exc
    if parsed.year != year:
        raise HolidayValidationError(f"Ngày {parsed.isoformat()} không thuộc năm {year}.")
    return parsed


def validate_holidays(payload):
    """Return a normalized calendar or raise ``HolidayValidationError``."""

    if not isinstance(payload, dict):
        raise HolidayValidationError("Dữ liệu ngày nghỉ phải là một đối tượng theo năm.")
    normalized = {}
    for raw_year, entry in payload.items():
        try:
            year = int(str(raw_year))
        except ValueError as exc:
            raise HolidayValidationError(f"Năm không hợp lệ: {raw_year}.") from exc
        if not MIN_YEAR <= year <= MAX_YEAR or str(year) != str(raw_year).strip():
            raise HolidayValidationError(f"Năm không hợp lệ: {raw_year}.")
        if not isinstance(entry, dict):
            raise HolidayValidationError(f"Dữ liệu năm {year} không hợp lệ.")
        unknown = set(entry) - {"holidays", "working_weekends"}
        if unknown:
            raise HolidayValidationError(f"Năm {year} có trường không hỗ trợ: {', '.join(sorted(unknown))}.")
        holidays = entry.get("holidays") or []
        weekends = entry.get("working_weekends") or []
        if not isinstance(holidays, list) or not isinstance(weekends, list):
            raise HolidayValidationError(f"Danh sách ngày của năm {year} không hợp lệ.")
        if len(holidays) > MAX_DATES_PER_YEAR or len(weekends) > MAX_DATES_PER_YEAR:
            raise HolidayValidationError(f"Năm {year} có quá nhiều ngày.")
        holiday_days = sorted({_parse_day(value, year) for value in holidays})
        weekend_days = sorted({_parse_day(value, year) for value in weekends})
        for day in weekend_days:
            if day.weekday() < 5:
                raise HolidayValidationError(
                    f"Ngày làm bù {day.strftime('%d/%m/%Y')} không phải thứ Bảy hoặc Chủ nhật."
                )
        overlap = set(holiday_days) & set(weekend_days)
        if overlap:
            first = min(overlap).strftime("%d/%m/%Y")
            raise HolidayValidationError(f"Ngày {first} không thể vừa là ngày nghỉ vừa là ngày làm bù.")
        normalized[str(year)] = {
            "holidays": [day.isoformat() for day in holiday_days],
            "working_weekends": [day.isoformat() for day in weekend_days],
        }
    return dict(sorted(normalized.items()))


def save_holidays(payload):
    """Validate and atomically replace the calendar file. Returns the data."""

    normalized = validate_holidays(payload)
    path = holidays_path()
    directory = os.path.dirname(os.path.abspath(path))
    content = json.dumps(normalized, ensure_ascii=False, indent=2) + "\n"
    with _lock:
        descriptor, temporary = tempfile.mkstemp(prefix=".holidays-", suffix=".json", dir=directory)
        try:
            with os.fdopen(descriptor, "w", encoding="utf-8", newline="\n") as stream:
                stream.write(content)
                stream.flush()
                os.fsync(stream.fileno())
            os.replace(temporary, path)
        except BaseException:
            try:
                os.unlink(temporary)
            except OSError:
                pass
            raise
        _cache.update(signature=_signature(path), data=normalized)
    return normalized


def calendar_coverage(data=None, today=None):
    """Report which upcoming years still lack an official calendar."""

    data = load_holidays() if data is None else data
    current = (today or date.today()).year
    return {
        "years": sorted(int(year) for year in data if str(year).isdigit()),
        "missingYears": [year for year in (current, current + 1) if str(year) not in data],
    }
