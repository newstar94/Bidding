"""File-backed public business profile (ADR 0095).

The operator identity (legal name, tax code, address, contact) is public
information required on a commercial website. It is edited by a Super Admin
and read anonymously by the landing and legal pages, so it lives in one JSON
file below the data directory, is replaced atomically and is re-read by file
signature so every worker process sees an edit without a restart.
"""

from __future__ import annotations

import json
import os
import re
import tempfile
import threading

from backend.shared.paths import DATA_DIR


# (key, label, max length). Order is the display order in the admin form.
PROFILE_FIELDS = (
    ("legalName", "Tên doanh nghiệp", 200),
    ("taxCode", "Mã số thuế", 14),
    ("businessRegistration", "Giấy chứng nhận đăng ký kinh doanh", 300),
    ("representative", "Người đại diện", 120),
    ("address", "Địa chỉ", 300),
    ("phone", "Điện thoại", 20),
    ("email", "Email hỗ trợ", 254),
)
PROFILE_KEYS = tuple(key for key, _label, _limit in PROFILE_FIELDS)

_TAX_CODE = re.compile(r"^\d{10}(?:-\d{3})?$")
_PHONE = re.compile(r"^\+?[0-9 .()-]{8,20}$")
_EMAIL = re.compile(r"^[^@\s]+@[^@\s]+\.[^@\s]+$")
_CONTROL = re.compile(r"[\x00-\x1f\x7f]")

_lock = threading.Lock()
_cache = {"signature": None, "data": None}


class BusinessProfileValidationError(ValueError):
    """The submitted profile is not valid public business information."""


def business_profile_path():
    return os.environ.get("BUSINESS_PROFILE_FILE") or os.path.join(str(DATA_DIR), "business_profile.json")


def _signature(path):
    try:
        stat = os.stat(path)
    except OSError:
        return None
    return (stat.st_mtime_ns, stat.st_size)


def _empty_profile():
    return {key: "" for key in PROFILE_KEYS}


def _coerce_stored(data):
    profile = _empty_profile()
    if isinstance(data, dict):
        for key in PROFILE_KEYS:
            value = data.get(key)
            if isinstance(value, str):
                profile[key] = value
    return profile


def load_business_profile():
    """Return the stored profile with every field present (empty when unset)."""

    path = business_profile_path()
    signature = _signature(path)
    if signature is not None and signature == _cache["signature"]:
        return dict(_cache["data"])
    with _lock:
        signature = _signature(path)
        if signature is not None and signature == _cache["signature"]:
            return dict(_cache["data"])
        try:
            with open(path, "r", encoding="utf-8") as stream:
                data = _coerce_stored(json.load(stream))
        except (OSError, UnicodeError, json.JSONDecodeError):
            data = _empty_profile()
        _cache.update(signature=signature, data=data)
        return dict(data)


def is_profile_configured(profile):
    return any(str(profile.get(key) or "").strip() for key in PROFILE_KEYS)


def validate_business_profile(payload):
    """Return a normalized profile or raise ``BusinessProfileValidationError``."""

    if not isinstance(payload, dict):
        raise BusinessProfileValidationError("Thông tin doanh nghiệp phải là một đối tượng.")
    unknown = sorted(set(payload) - set(PROFILE_KEYS))
    if unknown:
        raise BusinessProfileValidationError(f"Trường không được hỗ trợ: {', '.join(unknown)}.")
    profile = _empty_profile()
    for key, label, limit in PROFILE_FIELDS:
        value = payload.get(key, "")
        if value is None:
            value = ""
        if not isinstance(value, str):
            raise BusinessProfileValidationError(f"{label} phải là chuỗi ký tự.")
        value = " ".join(value.split())
        if _CONTROL.search(value):
            raise BusinessProfileValidationError(f"{label} chứa ký tự không hợp lệ.")
        if len(value) > limit:
            raise BusinessProfileValidationError(f"{label} tối đa {limit} ký tự.")
        profile[key] = value
    if profile["taxCode"] and not _TAX_CODE.fullmatch(profile["taxCode"]):
        raise BusinessProfileValidationError("Mã số thuế phải gồm 10 chữ số hoặc 10 chữ số kèm mã chi nhánh (ví dụ 0101234567-001).")
    if profile["phone"] and not _PHONE.fullmatch(profile["phone"]):
        raise BusinessProfileValidationError("Số điện thoại không hợp lệ.")
    if profile["email"] and not _EMAIL.fullmatch(profile["email"]):
        raise BusinessProfileValidationError("Email hỗ trợ không hợp lệ.")
    return profile


def save_business_profile(payload):
    """Validate and atomically replace the profile file. Returns the data."""

    normalized = validate_business_profile(payload)
    path = business_profile_path()
    directory = os.path.dirname(os.path.abspath(path))
    os.makedirs(directory, exist_ok=True)
    content = json.dumps(normalized, ensure_ascii=False, indent=2) + "\n"
    with _lock:
        descriptor, temporary = tempfile.mkstemp(prefix=".business-profile-", suffix=".json", dir=directory)
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
    return dict(normalized)
