"""Vietnam business schedule, eligibility and content-only change detection."""

from __future__ import annotations

from datetime import datetime
from hashlib import sha256
import json
import re

from backend.integrations.muasamcong_browser.canonical import normalize_notice_clarifications
from backend.shared.date_utils import VIETNAM_TIMEZONE, parse_datetime_value


ACTIVE_STATUSES = ("INVITED", "OPENED", "EVALUATING", "PARTIALLY_AWARDED", "AWARDED")


def due_slot(now: datetime) -> int | None:
    """Latest elapsed slot today only; no historic catch-up email burst."""
    local = now.astimezone(VIETNAM_TIMEZONE)
    for hour in (14, 8):
        slot = local.replace(hour=hour, minute=30, second=0, microsecond=0)
        if local >= slot:
            return int(slot.timestamp())
    return None


def notice_code(value) -> str | None:
    match = re.fullmatch(r"(IB\d{10})(?:-\d{2})?", str(value or "").strip().upper())
    return match[1] if match else None


def eligible(package: dict, now: datetime) -> bool:
    if package["trang_thai"] not in ACTIVE_STATUSES or not notice_code(package["ma_goi_thau"]):
        return False
    if package["trang_thai"] == "AWARDED":
        result_date = parse_datetime_value(package.get("ngay_quyet_dinh_ket_qua"))
        # Unknown date is not evidence that the result is over ten days old.
        if result_date and (now.astimezone(VIETNAM_TIMEZONE).date() - result_date.date()).days > 10:
            return False
    return True


def _canonical(value):
    if isinstance(value, dict):
        return {key: _canonical(item) for key, item in value.items()}
    if isinstance(value, list):
        return sorted((_canonical(item) for item in value), key=lambda item: json.dumps(item, sort_keys=True))
    return value


def digest(value) -> str:
    serialized = json.dumps(_canonical(value), sort_keys=True, ensure_ascii=False, separators=(",", ":"))
    return sha256(serialized.encode("utf-8")).hexdigest()


def petition_rows(source) -> list | None:
    """Accept explicit row arrays only; unknown/error/null envelopes remain retryable.

    The version/resolution arrays are the observed live endpoint envelope.
    Fingerprint its business rows without inventing petition content fields.
    """
    if not isinstance(source, dict) or source.get("success") is not True:
        return None
    value = source.get("response")
    for _ in range(4):
        if isinstance(value, list):
            return value if all(isinstance(row, dict) and row for row in value) else None
        if not isinstance(value, dict) or value.get("error") or value.get("errors") or value.get("success") is False:
            return None
        if "biduPetitionContractorVersionDTOList" in value or "biduPetitionResolutionList" in value:
            result = []
            for key in ("biduPetitionContractorVersionDTOList", "biduPetitionResolutionList"):
                rows = value.get(key)
                if not isinstance(rows, list) or any(not isinstance(row, dict) or not row for row in rows):
                    return None
                result.extend({"collection": key, "record": row} for row in rows)
            return result
        keys = [key for key in ("data", "content", "items", "rows") if key in value]
        if len(keys) != 1:
            return None
        value = value[keys[0]]
    return None


def snapshots(bundle: dict, code: str) -> dict[str, list | None]:
    if bundle.get("noticeNo") != code or not str(bundle.get("revisionNumber", "")).isdigit():
        raise ValueError("MONITOR_NOTICE_MISMATCH")
    sources = bundle.get("sources") or {}
    source = sources.get("clarification")
    clarification = None
    if isinstance(source, dict) and source.get("success") is True:
        response = source.get("response")
        groups = response.get("biduClarifyReqInvAndContentViewVersionDTOList") if isinstance(response, dict) else None
        if isinstance(groups, list):
            clarification = []
            # A response to a question on an earlier HSMT revision is still new
            # information for this notice. Validate each version independently.
            for group in groups:
                version = group.get("notifyVersion") if isinstance(group, dict) else None
                if not str(version).isdigit():
                    clarification = None
                    break
                normalized = normalize_notice_clarifications(source, notice_no=code, revision_number=version)
                if not normalized["clarificationAvailable"]:
                    clarification = None
                    break
                clarification.extend(normalized["clarificationRequests"])
                clarification.extend(normalized["clarificationResponses"])
    return {
        "clarification": clarification,
        "petition": petition_rows(sources.get("petition")),
    }


def changes(previous: dict, observed: dict) -> tuple[dict, dict[str, int], list[str]]:
    """Initialize unknown categories silently; compare known (even empty) baselines.

    Keep only content hashes (not source documents or provider identifiers).
    Previously seen content remains seen if temporarily absent upstream.
    """
    updated = dict(previous)
    counts = {}
    failures = []
    for category, rows in observed.items():
        if rows is None:
            failures.append(category)
            continue
        hashes = {digest(row) for row in rows}
        old = previous.get(category)
        seen = set(old or [])
        if old is not None and hashes - seen:
            counts[category] = len(hashes - seen)
        updated[category] = sorted(seen | hashes)
    return updated, counts, failures
