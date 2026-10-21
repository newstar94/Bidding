"""Append-only clarification merge for ADR 0091.

Mirrors the manual invitation update (``frontend/procurement/InvitationUpdates.js``)
so a scheduled write adds exactly the rows the button would add, with the same
source-derived row ids. Unlike the button it never relinks existing rows.
Parity is pinned by ``tests/fixtures/clarification_auto_write_parity.json``.
"""

from __future__ import annotations

from collections import defaultdict, deque
from datetime import datetime
from hashlib import sha256
import json
import re

from backend.db.id_utils import generate_record_id
from backend.shared.date_utils import normalize_datetime_value, parse_datetime_value


# JavaScript \d is ASCII-only; spell digits out so Unicode digits never match.
NOTICE_CODE = re.compile(r"^(IB[0-9]{10})(?:-([0-9]{2}))?$", re.IGNORECASE)
IMPORTED_ROW_ID = re.compile(r"^lr-[a-f0-9]{64}$")
# Characters removed by JavaScript String.prototype.trim().
_JS_WHITESPACE = (
    "\t\n\v\f\r \u00a0\u1680\u2000\u2001\u2002\u2003\u2004\u2005\u2006"
    "\u2007\u2008\u2009\u200a\u2028\u2029\u202f\u205f\u3000\ufeff"
)
_YMD = re.compile(r"^([0-9]{4})-([0-9]{2})-([0-9]{2})(?:[T\s]([0-9]{2}):([0-9]{2}))?")
_DMY = re.compile(r"^([0-9]{2})/([0-9]{2})/([0-9]{4})(?:[T\s]([0-9]{2}):([0-9]{2}))?")
# kind -> (stored loai, source time field, record id kind)
KINDS = {
    "request": ("yeu_cau", "requestedAt", "request"),
    "response": ("tra_loi", "respondedAt", "reply"),
}


class NoticeTargetError(ValueError):
    def __init__(self, code):
        super().__init__(code)
        self.code = code


def _js_text(value) -> str:
    return "" if value is None else str(value)


def js_trim(value) -> str:
    return _js_text(value).strip(_JS_WHITESPACE)


def revision_number(value) -> str:
    text = js_trim(value)
    if not re.fullmatch(r"[0-9]{1,16}", text):
        raise NoticeTargetError("PROCUREMENT_REVISION_INVALID")
    return (text.lstrip("0") or "0").zfill(2)


def resolve_notice_target(package) -> tuple[str, str]:
    """Notice code and TBMT version of a persisted record, as the button resolves it after reload."""
    match = NOTICE_CODE.fullmatch(js_trim(package.get("ma_goi_thau")).upper())
    if not js_trim(package.get("id")) or not match:
        raise NoticeTargetError("PROCUREMENT_CODE_INVALID")
    versions = [match[2]] if match[2] else []
    if not versions and js_trim(package.get("phien_ban")):
        versions.append(package.get("phien_ban"))
    normalized = [revision_number(version) for version in versions]
    if not normalized:
        raise NoticeTargetError("PROCUREMENT_REVISION_INVALID")
    return match[1], normalized[0]


def format_for_datetime_local(value) -> str:
    """Port of formatForDatetimeLocal: ``dd/MM/yyyy HH:mm`` from the literal digits."""
    if not value:
        return ""
    if isinstance(value, datetime):
        parsed = value
    else:
        text = js_trim(value)
        match = _YMD.match(text)
        if match:
            return f"{match[3]}/{match[2]}/{match[1]} {match[4] or '00'}:{match[5] or '00'}"
        match = _DMY.match(text) or _DMY.match(re.sub(r"\s*-\s*", " ", text, count=1))
        if match:
            return f"{match[1]}/{match[2]}/{match[3]} {match[4] or '00'}:{match[5] or '00'}"
        parsed = parse_datetime_value(text)
        if parsed is None:
            return ""
    return parsed.strftime("%d/%m/%Y %H:%M")


def normalized_content(value) -> str:
    return js_trim(re.sub(r"\r\n?", "\n", _js_text(value)))


def _compact_json(value) -> str:
    return json.dumps(value, ensure_ascii=False, separators=(",", ":"))


def source_identity(row) -> str:
    return js_trim(row.get("sourceRequestNo") or "") or js_trim(row.get("sourceRequestId") or "")


def local_row_id(package_id, notice_no, version, kind, identity) -> str:
    payload = _compact_json([str(package_id), notice_no, version, kind, identity])
    return "lr-" + sha256(payload.encode("utf-8")).hexdigest()


def rows_in_scope(rows_by_version, target_version):
    """Source versions not newer than the record, oldest first, with duplicate-version rejection."""
    versions = {}
    for raw_version, rows in (rows_by_version or {}).items():
        version = revision_number(raw_version)
        if version in versions:
            raise NoticeTargetError("PROCUREMENT_REVISION_INVALID")
        versions[version] = rows or {}
    ordered = sorted(versions, key=int)
    in_scope = [version for version in ordered if int(version) <= int(target_version)]
    newer = any(
        (versions[version].get("requests") or versions[version].get("responses"))
        for version in ordered if int(version) > int(target_version)
    )
    return [(version, versions[version]) for version in in_scope], newer


def plan_append(*, package_id, notice_no, target_version, current_rows, rows_by_version, generate_id=generate_record_id):
    """Rows to append per stored ``loai``; existing rows are never changed."""
    scoped, newer = rows_in_scope(rows_by_version, target_version)
    result = {"yeu_cau": [], "tra_loi": [], "newer_revision_rows": newer}
    for kind, (loai, time_field, id_kind) in KINDS.items():
        current = [row for row in current_rows if row.get("loai") == loai]
        current_ids = {str(row.get("id") or "") for row in current}
        unkeyed = defaultdict(deque)
        for row in current:
            row_id = str(row.get("id") or "")
            content = normalized_content(row.get("noi_dung"))
            if IMPORTED_ROW_ID.fullmatch(row_id) or not row.get("thoi_gian") or not content:
                continue
            unkeyed[(format_for_datetime_local(row.get("thoi_gian")), content)].append(row_id)
        seen_keys = set()
        for version, rows in scoped:
            for source in rows.get("requests" if kind == "request" else "responses") or []:
                time = format_for_datetime_local(source.get(time_field))
                content = _js_text(source.get("content"))
                if not time or not normalized_content(content):
                    continue
                identity = source_identity(source)
                row_id = local_row_id(package_id, notice_no, version, kind, identity) if identity else ""
                key = _compact_json([kind, version, row_id]) if row_id else ""
                if key and key in seen_keys:
                    continue
                if row_id and row_id in current_ids:
                    seen_keys.add(key)
                    continue
                matches = unkeyed.get((format_for_datetime_local(time), normalized_content(content)))
                if matches:
                    matches.popleft()
                    if key:
                        seen_keys.add(key)
                    continue
                new_id = row_id or generate_id(id_kind)
                current_ids.add(new_id)
                if key:
                    seen_keys.add(key)
                result[loai].append({
                    "id": new_id,
                    "loai": loai,
                    "thoi_gian": normalize_datetime_value(time),
                    "noi_dung": content,
                    "display_time": time,
                })
    return result
