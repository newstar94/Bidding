"""Validated raw-snapshot reuse for the opening-import flow.

The interface accepts a source adapter, raw-snapshot adapter, and exact
revision.  It returns a complete canonical opening projection or ``None``;
HTTP, authorization, and upstream fetching stay outside this module.
"""

from __future__ import annotations

from copy import deepcopy
import re

from backend.integrations.muasamcong_browser.canonical import normalize_opening_bundle
from backend.procurement_import.source_contracts import (
    OPENING_OPERATION_CONTRACTS,
    opening_operation_contract,
    source_payload_info,
)


__all__ = [
    "OPENING_OPERATION_CONTRACTS",
    "opening_operation_contract",
    "raw_snapshot_has_complete_opening_sources",
    "load_complete_opening_snapshot",
]


def raw_snapshot_has_complete_opening_sources(raw_bundle, selected_revision):
    """Whether an exact revision has all validated opening evidence."""

    revisions = raw_bundle.get("revisions") or {}
    revision_number = str(selected_revision.get("revisionNumber") or "").strip()
    revision = revisions.get(revision_number)
    if not isinstance(revision, dict):
        revision = next((
            candidate for candidate in revisions.values()
            if isinstance(candidate, dict)
            and str(candidate.get("revisionNumber") or "").strip() == revision_number
        ), None)
    if not isinstance(revision, dict):
        return False
    if str(revision.get("revisionId") or "") != str(
        selected_revision.get("revisionId") or ""
    ):
        return False

    opening_sources = set()
    for key, source in (revision.get("sources") or {}).items():
        if not isinstance(source, dict):
            continue
        operation = str(source.get("operation") or key or "").strip().upper()
        if not operation.startswith("OPENING"):
            continue
        request = source.get("request") or {}
        pack_type = request.get("packType")
        if pack_type is None:
            matched_pack = re.search(r"_(\d+)$", str(key))
            pack_type = int(matched_pack.group(1)) if matched_pack else None
        elif str(pack_type).isdigit():
            pack_type = int(pack_type)
        opening_sources.add((operation, pack_type))
        if source.get("success") is not True:
            return False
        if opening_operation_contract(operation) is not None:
            if source.get("schemaValid") is False:
                return False
            if not source_payload_info(operation, source.get("response"))["schemaValid"]:
                return False
    if not opening_sources:
        return False

    opening_operations = {operation for operation, _pack_type in opening_sources}
    required_sources = revision.get("requiredOpeningSources")
    if isinstance(required_sources, list) and required_sources:
        for required in required_sources:
            if not isinstance(required, dict):
                return False
            operation = str(required.get("operation") or "").strip().upper()
            pack_type = required.get("packType")
            if pack_type is not None and str(pack_type).isdigit():
                pack_type = int(pack_type)
            if (operation, pack_type) not in opening_sources:
                return False
        required_operations = set()
    elif opening_operations & {"OPENING_OTHER", "OPENING_ADB"}:
        required_operations = opening_operations & {"OPENING_OTHER", "OPENING_ADB"}
    else:
        required_operations = {"OPENING_ROUND", "OPENING_BID"}
        identifiers = revision.get("identifiers") or {}
        has_lot_sources = bool(opening_operations & {"OPENING_LOT", "OPENING_LOT_DETAIL"})
        if bool(identifiers.get("isMultiLot")) or has_lot_sources:
            required_operations.update({"OPENING_LOT", "OPENING_LOT_DETAIL"})
    if required_operations and not required_operations.issubset(opening_operations):
        return False

    for failure in raw_bundle.get("failures") or []:
        if isinstance(failure, dict) and str(failure.get("operation") or "").strip().upper().startswith("OPENING"):
            return False
    opening_raw = {
        key: source.get("response")
        for key, source in (revision.get("sources") or {}).items()
        if isinstance(source, dict)
        and str(source.get("operation") or key).upper().startswith("OPENING")
    }
    opening = normalize_opening_bundle(
        opening_raw,
        notice_no=str((raw_bundle.get("entity") or {}).get("canonicalCode") or ""),
        revision_id=str(revision.get("revisionId") or ""),
    )
    return not opening.get("partial")


def load_complete_opening_snapshot(
    source,
    raw_repository,
    organization_id,
    notice_no,
    selected_revision,
    *,
    max_age_seconds=900,
):
    """Project an exact complete opening snapshot without an upstream call."""

    loader = getattr(raw_repository, "load_fresh_notice_bundle", None)
    projector = getattr(source, "lookup_from_raw_bundle", None)
    if not callable(loader) or not callable(projector):
        return None
    revision_number = str(selected_revision.get("revisionNumber") or "").strip()
    raw_bundle = loader(
        organization_id,
        notice_no,
        detail_level="COMPLETE",
        revision_mode="SELECTED",
        revision_numbers=[revision_number],
        max_age_seconds=max_age_seconds,
    )
    if not isinstance(raw_bundle, dict) or not raw_snapshot_has_complete_opening_sources(
        raw_bundle, selected_revision
    ):
        return None
    projected = projector(
        notice_no,
        raw_bundle,
        revision_mode="SELECTED",
        detail_level="COMPLETE",
    )
    revisions = (projected.get("canonical") or {}).get("revisions") or []
    revision = next((
        row for row in revisions
        if str(row.get("revisionId") or "") == str(selected_revision.get("revisionId") or "")
        and str(row.get("revisionNumber") or "") == revision_number
    ), None)
    opening = (revision or {}).get("opening")
    if (
        not isinstance(opening, dict)
        or not isinstance(opening.get("bidders"), list)
        or opening.get("partial")
    ):
        return None
    return {
        **deepcopy(opening),
        "schemaVersion": "biddingflow-opening-bundle-v1",
        "partial": False,
        "failedOperations": [],
        "source": {
            "provider": getattr(source, "name", "MUASAMCONG"),
            "driver": "raw-snapshot",
            "retrievedAt": raw_bundle.get("retrievedAt"),
        },
    }
