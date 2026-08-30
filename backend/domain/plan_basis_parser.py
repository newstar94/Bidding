"""Deterministic parser for free-text procurement-plan legal bases."""

from __future__ import annotations

from dataclasses import dataclass
from datetime import date
import re


PARSER_VERSION = "can-cu-citation-v1"

_SPACE_RE = re.compile(r"\s+")
_PREFIX_RE = re.compile(r"^\s*căn\s+cứ\s+", re.IGNORECASE)
_BASE_MARKER_RE = re.compile(r"\bcăn\s+cứ\b", re.IGNORECASE)
_NUMBER_MARKER_RE = re.compile(r"\s+số\s+", re.IGNORECASE)
_DATE_MARKER_RE = re.compile(r"\s+ngày\s+", re.IGNORECASE)
_ABSTRACT_MARKER_RE = re.compile(r"\s+về\s+việc\s+", re.IGNORECASE)
_ISSUER_MARKER_RE = re.compile(r"\s+(?=(?:của\s+|do\s+))", re.IGNORECASE)
_ISSUER_OF_RE = re.compile(r"^của\s+(.+)$", re.IGNORECASE)
_ISSUER_BY_RE = re.compile(r"^do\s+(.+?)\s+ban\s+hành$", re.IGNORECASE)
_NUMERIC_DATE_RE = re.compile(r"\b(\d{1,2})\s*[/.-]\s*(\d{1,2})\s*[/.-]\s*(\d{4})\b")
_WRITTEN_DATE_RE = re.compile(
    r"\b(\d{1,2})\s+tháng\s+(\d{1,2})\s+năm\s+(\d{4})\b",
    re.IGNORECASE,
)
_ANY_DATE_RE = re.compile(
    r"\b(?:\d{1,2}\s*[/.-]\s*\d{1,2}\s*[/.-]\s*\d{4}"
    r"|\d{1,2}\s+tháng\s+\d{1,2}\s+năm\s+\d{4})\b",
    re.IGNORECASE,
)
_TRAILING_PUNCTUATION_RE = re.compile(r"[\s.;,]+$")


def _clean_component(value: str | None) -> str | None:
    if value is None:
        return None
    cleaned = _SPACE_RE.sub(" ", value).strip()
    cleaned = _TRAILING_PUNCTUATION_RE.sub("", cleaned).strip()
    return cleaned or None


def derive_ten_can_cu(
    ten_van_ban: str | None,
    trich_yeu: str | None,
) -> str:
    """Build the convenience label without creating a persistence authority."""

    name = _clean_component(ten_van_ban)
    abstract = _clean_component(trich_yeu)
    if name and abstract:
        return f"{name} về việc {abstract}"
    return name or abstract or ""


@dataclass(frozen=True)
class PlanBasisParseResult:
    noi_dung_goc: str
    ten_van_ban: str | None
    so_van_ban: str | None
    ngay_ban_hanh: str | None
    don_vi_ban_hanh: str | None
    trich_yeu: str | None
    parse_status: str
    parse_version: str
    parse_reasons: tuple[str, ...]

    @property
    def ten_can_cu(self) -> str:
        return derive_ten_can_cu(self.ten_van_ban, self.trich_yeu)

    def as_dict(self) -> dict[str, object]:
        return {
            "noiDungGoc": self.noi_dung_goc,
            "tenVanBan": self.ten_van_ban,
            "soVanBan": self.so_van_ban,
            "ngayBanHanh": self.ngay_ban_hanh,
            "donViBanHanh": self.don_vi_ban_hanh,
            "trichYeu": self.trich_yeu,
            "tenCanCu": self.ten_can_cu,
            "parseStatus": self.parse_status,
            "parseVersion": self.parse_version,
            "parseReasons": list(self.parse_reasons),
        }


def _canonical_date(candidate: str) -> tuple[str | None, str | None]:
    match = _NUMERIC_DATE_RE.fullmatch(candidate.strip())
    if match is None:
        match = _WRITTEN_DATE_RE.fullmatch(candidate.strip())
    if match is None:
        return None, "MISSING_DATE"
    day, month, year = (int(part) for part in match.groups())
    try:
        return date(year, month, day).isoformat(), None
    except ValueError:
        return None, "INVALID_DATE"


def _split_once(pattern: re.Pattern[str], value: str) -> tuple[str, str] | None:
    match = pattern.search(value)
    if match is None:
        return None
    return value[: match.start()], value[match.end() :]


def parse_plan_basis(raw_text: object) -> PlanBasisParseResult:
    raw = "" if raw_text is None else str(raw_text)
    working = _SPACE_RE.sub(" ", raw).strip()
    reasons: list[str] = []

    if len(_BASE_MARKER_RE.findall(working)) > 1:
        return PlanBasisParseResult(
            raw, None, None, None, None, None,
            "PARTIAL", PARSER_VERSION, ("MULTIPLE_BASES_DETECTED",),
        )

    working = _PREFIX_RE.sub("", working, count=1)
    abstract_split = _split_once(_ABSTRACT_MARKER_RE, working)
    if abstract_split is None:
        citation, trich_yeu = working, None
    else:
        citation, trich_yeu = abstract_split
        trich_yeu = _clean_component(trich_yeu)
        if not trich_yeu:
            reasons.append("MISSING_ABSTRACT")

    number_split = _split_once(_NUMBER_MARKER_RE, citation)
    ten_van_ban = _clean_component(number_split[0]) if number_split else None
    after_number = number_split[1] if number_split else citation
    if not ten_van_ban:
        reasons.append("MISSING_DOCUMENT_NAME")

    date_split = _split_once(_DATE_MARKER_RE, after_number)
    issuer_split_without_date = (
        _split_once(_ISSUER_MARKER_RE, after_number) if date_split is None else None
    )
    if date_split:
        so_van_ban = _clean_component(date_split[0])
        after_date_marker = date_split[1]
    elif issuer_split_without_date:
        so_van_ban = _clean_component(issuer_split_without_date[0])
        after_date_marker = issuer_split_without_date[1]
    else:
        so_van_ban = None
        after_date_marker = after_number
    if not number_split or not so_van_ban:
        reasons.append("MISSING_DOCUMENT_NUMBER")

    date_matches = list(_ANY_DATE_RE.finditer(working))
    ngay_ban_hanh = None
    issuer_part = after_date_marker
    if len(date_matches) > 1:
        reasons.append("MULTIPLE_DATES")
        if date_split:
            first_local_date = _ANY_DATE_RE.search(after_date_marker)
            if first_local_date:
                issuer_part = after_date_marker[first_local_date.end() :].strip()
    elif date_split:
        local_date = _ANY_DATE_RE.match(after_date_marker)
        if local_date is None:
            reasons.append("MISSING_DATE")
        else:
            ngay_ban_hanh, date_error = _canonical_date(local_date.group(0))
            if date_error:
                reasons.append(date_error)
            issuer_part = after_date_marker[local_date.end() :].strip()
    else:
        reasons.append("MISSING_DATE")
        if issuer_split_without_date:
            issuer_part = issuer_split_without_date[1]

    issuer_part = _clean_component(issuer_part)
    don_vi_ban_hanh = None
    if issuer_part:
        issuer_match = _ISSUER_OF_RE.fullmatch(issuer_part)
        if issuer_match is None:
            issuer_match = _ISSUER_BY_RE.fullmatch(issuer_part)
        if issuer_match is not None:
            don_vi_ban_hanh = _clean_component(issuer_match.group(1))
    if not don_vi_ban_hanh:
        reasons.append("MISSING_ISSUER")

    fields = (
        ten_van_ban,
        so_van_ban,
        ngay_ban_hanh,
        don_vi_ban_hanh,
        trich_yeu,
    )
    required_complete = all(fields[:4])
    any_parsed = any(fields)
    status = "PARSED" if required_complete and not reasons else (
        "PARTIAL" if any_parsed else "UNPARSED"
    )
    return PlanBasisParseResult(
        noi_dung_goc=raw,
        ten_van_ban=ten_van_ban,
        so_van_ban=so_van_ban,
        ngay_ban_hanh=ngay_ban_hanh,
        don_vi_ban_hanh=don_vi_ban_hanh,
        trich_yeu=trich_yeu,
        parse_status=status,
        parse_version=PARSER_VERSION,
        parse_reasons=tuple(dict.fromkeys(reasons)),
    )
