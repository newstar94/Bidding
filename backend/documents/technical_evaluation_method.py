"""Resolve the technical evaluation method used by evaluation Excel workbooks."""

from __future__ import annotations

import re
import unicodedata
from collections.abc import Mapping

from backend.sync.evaluation_metadata import parse_evaluation_metadata


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


def _explicit_method(value):
    explicit = _normalize(value)
    if explicit in {"score", "scoring", "cham diem", "diem"}:
        return SCORE
    if explicit in {"pass fail", "pass_fail", "dat khong dat", "dat va khong dat"}:
        return PASS_FAIL
    return ""


def _stored_metadata_block(package, round_type):
    raw_metadata = _first(package, "danhGiaHsdtMetadata", "danh_gia_hsdt_metadata")
    try:
        metadata = parse_evaluation_metadata(raw_metadata, require_version=False)
    except ValueError:
        # Match the frontend display resolver: invalid historical metadata must
        # not invent an evaluation method.
        return {}
    if round_type == "single":
        return metadata
    block = metadata.get(round_type)
    return dict(block) if isinstance(block, Mapping) else {}


def _stored_technical_evaluation_method(package, round_type):
    block = _stored_metadata_block(package, round_type)
    return _explicit_method(_first(
        block,
        "technicalEvaluationMethod",
        "technical_evaluation_method",
        "phuongPhapDanhGiaKyThuat",
        "phuong_phap_danh_gia_ky_thuat",
    )) or _explicit_method(_first(
        package,
        "technicalEvaluationMethod",
        "technical_evaluation_method",
        "phuongPhapDanhGiaKyThuat",
        "phuong_phap_danh_gia_ky_thuat",
    ))


def _forced_technical_evaluation_method(package):
    field = _normalize(_first(
        package,
        "linhVuc", "linh_vuc", "loaiGoiThau", "loai_goi_thau",
        "loaiGoi", "loai_goi", "category",
    ))
    if field == "tu van" or field.startswith("tu van "):
        return SCORE

    selection_form = _normalize(_first(
        package, "hinhThucLuaChon", "hinh_thuc_lua_chon",
    ))
    if selection_form in _FORCED_PASS_FAIL_FORMS:
        return PASS_FAIL

    evaluation_method = _normalize(_first(
        package,
        "phuongPhapDanhGia", "phuong_phap_danh_gia", "evaluationMethodCode",
    ))
    if evaluation_method in _SCORE_METHODS:
        return SCORE
    return ""


def resolve_technical_evaluation_method(package_context, *, round_type="single"):
    """Return ``pass_fail``, ``score``, or ``unknown`` using frontend semantics.

    ``round_type`` selects persisted round metadata for a 1G2T package.  Domain
    rules determined from the package remain authoritative, as they do in the
    frontend, before a stored technical-method preference is considered.
    """

    package = package_context if isinstance(package_context, Mapping) else {}
    normalized_round = str(round_type or "single").strip().lower()
    if normalized_round not in {"single", "technical", "financial"}:
        normalized_round = "single"
    return (
        _forced_technical_evaluation_method(package)
        or _stored_technical_evaluation_method(package, normalized_round)
        or UNKNOWN
    )
