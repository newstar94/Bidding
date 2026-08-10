"""Synthetic fixture provider for deterministic procurement import tests."""

from __future__ import annotations

from copy import deepcopy
import json
import os
from pathlib import Path

from backend.procurement_import.source import ProcurementSourceError


FIXTURE_SCHEMA_VERSION = "vneps-procurement-fixture-v1"


class FixtureProcurementSource:
    name = "VNEPS_FIXTURE"
    schema_version = FIXTURE_SCHEMA_VERSION

    def __init__(self, fixture_path: str):
        if os.environ.get("APP_ENV", "").strip().casefold() in {"prod", "production"}:
            raise RuntimeError("VNEPS procurement fixtures are forbidden in production")
        path = Path(fixture_path).resolve()
        try:
            payload = json.loads(path.read_text(encoding="utf-8"))
        except (OSError, UnicodeError, json.JSONDecodeError) as error:
            raise ProcurementSourceError("PROCUREMENT_SCHEMA_CHANGED") from error
        if payload.get("schemaVersion") != FIXTURE_SCHEMA_VERSION:
            raise ProcurementSourceError("PROCUREMENT_SCHEMA_CHANGED")
        plans = payload.get("plans")
        if not isinstance(plans, list) or not all(isinstance(row, dict) for row in plans):
            raise ProcurementSourceError("PROCUREMENT_SCHEMA_CHANGED")
        self._plans = {
            str(row.get("familyNo") or "").strip().upper(): deepcopy(row)
            for row in plans
            if str(row.get("familyNo") or "").strip()
        }
        self._notices = {
            str(row.get("noticeNo") or "").strip().upper(): deepcopy(row)
            for row in payload.get("notices", [])
            if isinstance(row, dict) and str(row.get("noticeNo") or "").strip()
        }

    def list_plan_revisions(self, family_no: str) -> list[dict]:
        plan = self._plans.get(str(family_no).upper())
        if not plan:
            return []
        return [
            {
                "familyNo": family_no.upper(),
                "revisionId": revision.get("revisionId"),
                "revisionNumber": revision.get("revisionNumber"),
            }
            for revision in deepcopy(plan.get("revisions", []))
        ]

    def get_plan_revision(self, family_no: str, revision_id: str) -> dict:
        plan = self._plans.get(str(family_no).upper())
        revision = next((
            row for row in (plan or {}).get("revisions", [])
            if str(row.get("revisionId")) == str(revision_id)
        ), None)
        if revision is None:
            raise ProcurementSourceError("PROCUREMENT_REVISION_INVALID")
        result = deepcopy(revision)
        result["familyNo"] = str(family_no).upper()
        return result

    def list_notice_revisions(self, notice_no: str) -> list[dict]:
        notice = self._notices.get(str(notice_no).upper())
        return deepcopy((notice or {}).get("revisions", []))

    def get_notice_revision(self, notice_no: str, revision_id: str) -> dict:
        revision = next((
            row for row in self.list_notice_revisions(notice_no)
            if str(row.get("revisionId")) == str(revision_id)
        ), None)
        if revision is None:
            raise ProcurementSourceError("PROCUREMENT_REVISION_INVALID")
        return revision

    def resolve_notice_package(self, notice_no: str, revision_id: str) -> dict | None:
        self.get_notice_revision(notice_no, revision_id)
        canonical_notice = str(notice_no or "").strip().upper()
        matches = []
        for family_no, plan in self._plans.items():
            for revision in plan.get("revisions", []):
                for package in revision.get("packages", []):
                    link = package.get("noticeLink") or {}
                    if str(link.get("noticeNo") or "").strip().upper() != canonical_notice:
                        continue
                    matches.append({
                        "planNo": family_no,
                        "planRevisionId": revision.get("revisionId"),
                        "planRevisionNumber": revision.get("revisionNumber"),
                        "planDetailRevisionId": package.get("planDetailRevisionId"),
                        "stablePackageId": package.get("stablePackageId"),
                        "symbol": package.get("symbol"),
                    })
        if not matches:
            return None
        identities = {
            (
                row["planNo"],
                str(row.get("stablePackageId") or "").strip()
                or str(row.get("symbol") or "").strip().casefold(),
            )
            for row in matches
        }
        if len(identities) != 1 or "" in next(iter(identities)):
            raise ProcurementSourceError("PROCUREMENT_MATCH_AMBIGUOUS")
        selected = max(
            matches,
            key=lambda row: (
                int(row.get("planRevisionNumber"))
                if str(row.get("planRevisionNumber") or "").isdigit()
                else -1,
                str(row.get("planRevisionNumber") or ""),
            ),
        )
        selected.pop("planRevisionNumber", None)
        return selected
