"""Deep module assembling one bounded deterministic compliance snapshot."""

from __future__ import annotations

import hashlib
import json

from backend.compliance.engine import evaluate_bundle


class ComplianceContext:
    def __init__(self, repository):
        self.repository = repository

    def get_snapshot(self, target_hint):
        snapshot = self.repository.load_authorized_snapshot(
            target_hint.get("targetType"),
            target_hint.get("targetId"),
            target_hint.get("versionId"),
        )
        if snapshot is None:
            return None
        binding, raw_sources = self.repository.load_legal(snapshot)
        documents = self.repository.load_documents(snapshot)
        evaluated = evaluate_bundle(snapshot, binding, raw_sources, documents)
        record = snapshot.get("record") or {}
        sources = [{
            key: source.get(key) for key in (
                "id", "instrumentId", "versionNo", "documentType",
                "documentNumber", "title", "sourceUri", "contentSha256",
                "issuedDate", "effectiveFrom", "effectiveTo",
            )
        } for source in raw_sources]
        legal_binding = {
            "bindingId": (binding or {}).get("id"),
            "bindingRevision": (binding or {}).get("bindingRevision", 0),
            "status": (binding or {}).get("status", "UNRESOLVED"),
            "reason": (binding or {}).get("reason", "LEGACY_NOT_BACKFILLED"),
            "sourceProfileVersionId": (binding or {}).get("profileVersionId"),
            "policyVersionId": (binding or {}).get("policyVersionId"),
            "sources": sources,
        }
        version_context = {
            "rootId": record.get("rootId") or record.get("id"),
            "version": record.get("phienBan"),
            "rowVersion": record.get("rowVersion"),
            "isLatest": record.get("isLatest"),
        }
        digest_payload = {
            "targetId": record.get("id"),
            "rowVersion": record.get("rowVersion"),
            "bindingId": legal_binding["bindingId"],
            "bindingRevision": legal_binding["bindingRevision"],
            "bundle": evaluated["bundle"],
            "documents": evaluated["documents"],
        }
        snapshot_version = hashlib.sha256(json.dumps(
            digest_payload, ensure_ascii=False, sort_keys=True,
            separators=(",", ":"), default=str,
        ).encode("utf-8")).hexdigest()
        return {
            "target": {
                "type": snapshot["entityType"],
                "id": str(target_hint.get("targetId") or ""),
                "exactVersionId": str(record.get("id") or ""),
            },
            "snapshotVersion": snapshot_version,
            "record": record,
            "legalBinding": legal_binding,
            "complianceBundle": evaluated["bundle"],
            "findings": evaluated["findings"],
            "workflow": {"status": record.get("trangThai") or record.get("pheDuyet")},
            "timeline": evaluated["timeline"],
            "documents": evaluated["documents"],
            "versionContext": version_context,
            "notEvaluated": evaluated["notEvaluated"],
        }
