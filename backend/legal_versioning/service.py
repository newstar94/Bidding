"""Deep module for immutable legal publication and exact target binding."""

from __future__ import annotations

import hashlib
import json
import re

from backend.shared.logging_utils import log_audit

from .policy import (
    APPLICABILITY_POLICY_VERSION,
    extract_target_anchor,
    resolve_applicability,
)


class LegalVersioningError(ValueError):
    code = "LEGAL_VERSIONING_INVALID"
    status_code = 400

    def __init__(self, message=None, *, fields=None):
        super().__init__(message or self.code)
        self.fields = fields or {}


class LegalNotFoundError(LegalVersioningError):
    code = "LEGAL_VERSIONING_NOT_FOUND"
    status_code = 404


class LegalConflictError(LegalVersioningError):
    code = "LEGAL_VERSIONING_CONFLICT"
    status_code = 409

    def __init__(self, message=None, *, current=None, fields=None):
        super().__init__(message, fields=fields)
        self.current = current


def _canonical(value):
    return json.dumps(value, ensure_ascii=False, sort_keys=True, separators=(",", ":"))


def _hash(value):
    return hashlib.sha256(value.encode("utf-8")).hexdigest()


def _text(value, field, maximum, *, required=True):
    result = str(value or "").strip()
    if (required and not result) or len(result) > maximum:
        raise LegalVersioningError(fields={field: "INVALID_VALUE"})
    return result


def _stable_code(value):
    result = re.sub(r"[^a-z0-9-]+", "-", str(value or "").casefold()).strip("-")
    if not result or len(result) > 160:
        raise LegalVersioningError(fields={"stableCode": "INVALID_VALUE"})
    return result


class LegalVersioningService:
    def __init__(self, repository, *, audit=log_audit):
        self.repository = repository
        self._audit = audit

    def create_instrument_draft(
        self, *, stable_code, title, document_type, document_number,
        source_uri, source_content, issued_date, effective_from,
        effective_to, relations, actor_user_id, request=None,
    ):
        relation_json = _canonical(relations or [])
        result = self.repository.create_instrument_draft({
            "stable_code": _stable_code(stable_code),
            "title": _text(title, "title", 500),
            "document_type": _text(document_type, "documentType", 100),
            "document_number": _text(document_number, "documentNumber", 200),
            "source_uri": _text(source_uri, "sourceUri", 2000),
            "source_content": _text(source_content, "sourceContent", 16_777_216),
            "issued_date": _text(issued_date, "issuedDate", 10),
            "effective_from": _text(effective_from, "effectiveFrom", 10),
            "effective_to": _text(effective_to, "effectiveTo", 10, required=False) or None,
            "relation_manifest_json": relation_json,
            "actor_user_id": actor_user_id,
        })
        self._audit_required(
            "legal.instrument_draft_created", actor_user_id,
            "legal_instrument", result["instrumentId"], request,
            {"draftId": result["id"]},
        )
        return self._without_source_content(result)

    def publish_instrument(
        self, *, draft_id, expected_draft_revision, actor_user_id, request=None,
    ):
        draft = self.repository.get_instrument_draft(draft_id)
        if draft is None:
            raise LegalNotFoundError()
        content_hash = _hash(draft["sourceContent"])
        relation_json = _canonical(draft["relations"])
        version, error = self.repository.publish_instrument_draft(
            draft_id=draft_id,
            expected_revision=self._revision(expected_draft_revision),
            content_sha256=content_hash,
            relation_manifest_json=relation_json,
            relation_manifest_hash=_hash(relation_json),
            actor_user_id=actor_user_id,
        )
        self._repository_error(error, version)
        self._audit_required(
            "legal.instrument_version_published", actor_user_id,
            "legal_instrument", version["instrumentId"], request,
            {"versionId": version["id"], "contentSha256": content_hash},
        )
        return self._without_source_content(version)

    def create_profile_draft(
        self, *, stable_code, display_name, effective_from, effective_to,
        priority, manual_review_required, instrument_version_ids,
        actor_user_id, request=None,
    ):
        ids = [str(value or "").strip() for value in instrument_version_ids or ()]
        if not ids or any(not value for value in ids) or len(ids) != len(set(ids)):
            raise LegalVersioningError(fields={"instrumentVersionIds": "INVALID_VALUE"})
        result = self.repository.create_profile_draft({
            "stable_code": _stable_code(stable_code),
            "display_name": _text(display_name, "displayName", 500),
            "effective_from": _text(effective_from, "effectiveFrom", 10),
            "effective_to": _text(effective_to, "effectiveTo", 10, required=False) or None,
            "priority": int(priority or 0),
            "manual_review_required": bool(manual_review_required),
            "instrument_version_ids_json": _canonical(ids),
            "actor_user_id": actor_user_id,
        })
        self._audit_required(
            "legal.profile_draft_created", actor_user_id,
            "legal_source_profile", result["profileId"], request,
            {"draftId": result["id"], "sourceCount": len(ids)},
        )
        return result

    def publish_profile(
        self, *, draft_id, expected_draft_revision, actor_user_id, request=None,
    ):
        draft = self.repository.get_profile_draft(draft_id)
        if draft is None:
            raise LegalNotFoundError()
        manifest = {
            "schemaVersion": 1,
            "instrumentVersionIds": draft["instrumentVersionIds"],
            "effectiveFrom": str(draft["effectiveFrom"]),
            "effectiveTo": str(draft["effectiveTo"]) if draft["effectiveTo"] else None,
            "priority": draft["priority"],
            "manualReviewRequired": draft["manualReviewRequired"],
        }
        version, error = self.repository.publish_profile_draft(
            draft_id=draft_id,
            expected_revision=self._revision(expected_draft_revision),
            manifest_hash=_hash(_canonical(manifest)),
            actor_user_id=actor_user_id,
        )
        self._repository_error(error, version)
        self._audit_required(
            "legal.profile_version_published", actor_user_id,
            "legal_source_profile", version["profileId"], request,
            {"profileVersionId": version["id"], "manifestHash": version["manifestHash"]},
        )
        return version

    def resolve_and_bind(
        self, *, organization_id, target_type, target_id,
        expected_binding_revision, expected_target_row_version,
        actor_user_id, request=None,
    ):
        if target_type not in {"plan", "package"}:
            raise LegalVersioningError(fields={"targetType": "INVALID_VALUE"})
        target = self.repository.get_target(
            organization_id, target_type, target_id, lock=True
        )
        if target is None:
            raise LegalNotFoundError()
        actual_row_version = int(target.get("row_version") or 1)
        if actual_row_version != self._revision(expected_target_row_version):
            raise LegalConflictError(current={"targetRowVersion": actual_row_version})
        facts = extract_target_anchor(target_type, target)
        profiles = self.repository.list_profile_versions()
        resolution = resolve_applicability(facts, profiles)
        policy_config = _canonical({
            "anchorByTarget": {
                "plan": "ke_hoach_lcnt.ngay_phe_duyet",
                "package": "goi_thau.thoi_gian_dang_tai",
            },
            "noLatestFallback": True,
        })
        policy_id = self.repository.ensure_policy_version(
            policy_code="legal-applicability",
            version=APPLICABILITY_POLICY_VERSION,
            config_json=policy_config,
            config_hash=_hash(policy_config),
            actor_user_id=actor_user_id,
        )
        evidence = {
            "schemaVersion": 1,
            "targetFacts": facts,
            "candidateProfileVersionIds": resolution["candidateProfileVersionIds"],
            "resolutionReason": resolution["reason"],
        }
        evidence_json = _canonical(evidence)
        binding, error = self.repository.bind_target_cas(
            organization_id=organization_id, target_type=target_type,
            target_id=target_id,
            expected_revision=max(0, int(expected_binding_revision)),
            target_row_version=actual_row_version,
            policy_version_id=policy_id,
            resolution=resolution,
            actor_user_id=actor_user_id,
            evidence_json=evidence_json,
            evidence_hash=_hash(evidence_json),
            anchor_source=facts["anchorSource"],
        )
        self._repository_error(error, binding)
        self._audit_required(
            "legal.target_binding_recorded", actor_user_id,
            f"{target_type}_legal_binding", binding["id"], request,
            {
                "organizationId": organization_id, "targetId": target_id,
                "bindingRevision": binding["bindingRevision"],
                "status": binding["status"],
                "profileVersionId": binding["profileVersionId"],
            },
        )
        return binding

    def get_binding(self, organization_id, target_type, target_id):
        result = self.repository.get_binding(organization_id, target_type, target_id)
        if result is None:
            return {
                "bindingRevision": 0, "status": "UNRESOLVED",
                "reason": "LEGACY_NOT_BACKFILLED", "profileVersionId": None,
            }
        return result

    def get_exact_sources(self, profile_version_id):
        result = self.repository.get_profile_sources(profile_version_id)
        if result is None:
            raise LegalNotFoundError()
        for source in result["sources"]:
            if (
                _hash(source["sourceContent"]) != source["contentSha256"]
                or _hash(_canonical(source["relations"]))
                != source["relationManifestHash"]
            ):
                raise RuntimeError("Immutable legal source hash verification failed.")
        return result

    def _audit_required(self, action, actor, target_type, target_id, request, metadata):
        self._audit(
            action, actor_user_id=actor, target_type=target_type,
            target_id=target_id, request=request, metadata=metadata,
            cursor=self.repository.cursor, required=True,
        )

    @staticmethod
    def _revision(value):
        if isinstance(value, bool) or not isinstance(value, int) or value < 1:
            raise LegalVersioningError(fields={"revision": "INVALID_VALUE"})
        return value

    @staticmethod
    def _repository_error(error, current):
        if error in {"NOT_FOUND", "SOURCE_NOT_FOUND"}:
            raise LegalNotFoundError()
        if error == "STALE":
            raise LegalConflictError(current=current)
        if error:
            raise RuntimeError(f"Unexpected legal repository result: {error}")

    @staticmethod
    def _without_source_content(value):
        result = dict(value)
        result.pop("sourceContent", None)
        return result
