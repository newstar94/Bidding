"""Resolve the technical evaluation method used by evaluation Excel workbooks."""

from __future__ import annotations

import re
import unicodedata


PASS_FAIL = "pass_fail"
SCORE = "score"
UNKNOWN = "unknown"

_FORCED_PASS_FAIL_FORMS = {
    "chao hang canh tranh",
    "chi dinh thau",
    "chi dinh thau rut gon",
    "lua chon nha thau trong truong hop dac biet",
}
_SCORE_METHODS = {
    "combined technical price",
    "ket hop giua ky thuat va gia",
    "ket hop ky thuat va gia",
    "technical based",
    "dua tren ky thuat",
}


def _normalize(value):
    text = unicodedata.normalize("NFD", str(value or ""))
    text = "".join(char for char in text if not unicodedata.combining(char))
    return re.sub(r"[^a-z0-9]+", " ", text.lower().replace("đ", "d")).strip()


def _first(package, *keys):
    for key in keys:
        value = package.get(key)
        if value not in (None, ""):
            return value
    return ""


def resolve_technical_evaluation_method(package_context):
    """Return ``pass_fail``, ``score``, or ``unknown`` using frontend semantics."""

    package = package_context or {}
    explicit = _normalize(_first(
        package,
        "technicalEvaluationMethod",
        "technical_evaluation_method",
        "phuongPhapDanhGiaKyThuat",
        "phuong_phap_danh_gia_ky_thuat",
    ))
    if explicit in {"score", "scoring", "cham diem", "diem"}:
        return SCORE
    if explicit in {"pass fail", "pass_fail", "dat khong dat", "dat va khong dat"}:
        return PASS_FAIL

    field = _normalize(_first(package, "linhVuc", "linh_vuc", "loaiGoiThau", "loai_goi_thau"))
    if field == "tu van" or field.startswith("tu van "):
        return SCORE
    selection_form = _normalize(_first(package, "hinhThucLuaChon", "hinh_thuc_lua_chon"))
    if selection_form in _FORCED_PASS_FAIL_FORMS:
        return PASS_FAIL
    evaluation_method = _normalize(_first(package, "phuongPhapDanhGia", "phuong_phap_danh_gia", "evaluationMethodCode"))
    if evaluation_method in _SCORE_METHODS:
        return SCORE
    return UNKNOWN
