"""Deep module for Word-template identity, immutable versions and publication."""

from __future__ import annotations

import hashlib
import json
import re
from datetime import datetime, timedelta, timezone

from backend.shared.logging_utils import log_audit


SANITIZER_VERSION = "document-worker.sanitize-docx.v1"
MANIFEST_SCHEMA_VERSION = 1
PREFLIGHT_MAX_AGE = timedelta(days=30)


class CatalogError(ValueError):
    code = "WORD_TEMPLATE_CATALOG_INVALID"
    status_code = 400

    def __init__(self, message=None, *, fields=None):
        super().__init__(message or self.code)
        self.fields = fields or {}


class CatalogNotFoundError(CatalogError):
    code = "WORD_TEMPLATE_CATALOG_NOT_FOUND"
    status_code = 404


class CatalogConflictError(CatalogError):
    code = "WORD_TEMPLATE_CATALOG_CONFLICT"
    status_code = 409

    def __init__(self, message=None, *, current=None, fields=None):
        super().__init__(message, fields=fields)
        self.current = current


def _canonical_json(value) -> str:
    return json.dumps(value, ensure_ascii=False, sort_keys=True, separators=(",", ":"))


def _stable_code(value: str) -> str:
    code = str(value or "").strip().casefold().replace("_", "-")
    code = re.sub(r"[^a-z0-9-]+", "-", code).strip("-")
    code = re.sub(r"-{2,}", "-", code)
    if not code or len(code) > 160:
        raise CatalogError(fields={"stableCode": "INVALID_VALUE"})
    return code


def _bounded_text(value, field, maximum, *, required=True):
    text = str(value or "").strip()
    if (required and not text) or len(text) > maximum:
        raise CatalogError(fields={field: "INVALID_VALUE"})
    return text


class WordTemplateCatalog:
    def __init__(self, repository, storage, *, now=None, audit=log_audit):
        self.repository = repository
        self.storage = storage
        self._now = now or (lambda: datetime.now(timezone.utc))
        self._audit = audit

    def list_templates(self, organization_id, *, include_retired=False):
        return self.repository.list_templates(
            organization_id, include_retired=include_retired
        )

    def list_versions(self, organization_id, template_id):
        template = self.repository.get_template(organization_id, template_id)
        if template is None:
            raise CatalogNotFoundError()
        versions = self.repository.list_versions(organization_id, template_id)
        for version in versions:
            version["lifecycle"] = self._lifecycle(template, version["id"])
        return {"template": template, "versions": versions}

    def get_version(self, organization_id, version_id, *, include_content=False):
        version = self.repository.get_version(organization_id, version_id)
        if version is None:
            raise CatalogNotFoundError()
        template = self.repository.get_template(organization_id, version["templateId"])
        result = dict(version)
        result["lifecycle"] = self._lifecycle(template, version_id)
        if include_content:
            result["content"] = self.storage.read(
                organization_id, version["storageKey"], version["sha256"]
            )
        return result

    def create_template(
        self, *, organization_id, owner_type, stable_code, display_name,
        legacy_alias, original_filename, sanitized_content, actor_user_id,
        request=None, metadata=None,
    ):
        content = self._store(organization_id, sanitized_content)
        manifest_json, manifest_hash = self._manifest(
            action="CREATE", metadata=metadata, source_version_id=None,
        )
        template = self.repository.create_template_with_draft(
            organization_id=organization_id,
            owner_type=_bounded_text(owner_type, "ownerType", 20),
            stable_code=_stable_code(stable_code),
            display_name=_bounded_text(display_name, "displayName", 255),
            legacy_alias=_bounded_text(legacy_alias, "legacyAlias", 255),
            created_by_id=actor_user_id,
            version=self._version_values(
                content, original_filename, actor_user_id,
                manifest_json, manifest_hash, source_version_id=None,
            ),
        )
        self._audit_required(
            "document.word_template_catalog_created", organization_id,
            actor_user_id, template["id"], request,
            {"versionId": template["draftVersionId"], "sha256": content[1]},
        )
        return template

    def create_draft_version(
        self, *, organization_id, template_id, expected_row_version,
        original_filename, sanitized_content, actor_user_id, request=None,
        metadata=None,
    ):
        content = self._store(organization_id, sanitized_content)
        manifest_json, manifest_hash = self._manifest(
            action="CREATE_DRAFT", metadata=metadata, source_version_id=None,
        )
        template, error = self.repository.create_draft_version(
            organization_id=organization_id, template_id=template_id,
            expected_row_version=self._row_version(expected_row_version),
            version=self._version_values(
                content, original_filename, actor_user_id,
                manifest_json, manifest_hash, source_version_id=None,
            ),
        )
        self._raise_repository_error(error, template)
        self._audit_required(
            "document.word_template_draft_created", organization_id,
            actor_user_id, template_id, request,
            {"versionId": template["draftVersionId"], "sha256": content[1]},
        )
        return template

    def restore_as_draft(
        self, *, organization_id, template_id, source_version_id,
        expected_row_version, actor_user_id, reason, request=None,
    ):
        source = self.repository.get_version(organization_id, source_version_id)
        if source is None or source["templateId"] != template_id:
            raise CatalogNotFoundError()
        content_bytes = self.storage.read(
            organization_id, source["storageKey"], source["sha256"]
        )
        content = self._store(organization_id, content_bytes)
        reason = _bounded_text(reason, "reason", 2000)
        manifest_json, manifest_hash = self._manifest(
            action="RESTORE_AS_DRAFT", metadata={"reason": reason},
            source_version_id=source_version_id,
        )
        template, error = self.repository.create_draft_version(
            organization_id=organization_id, template_id=template_id,
            expected_row_version=self._row_version(expected_row_version),
            version=self._version_values(
                content, source["originalFilename"], actor_user_id,
                manifest_json, manifest_hash,
                source_version_id=source_version_id,
            ),
        )
        self._raise_repository_error(error, template)
        event_id = self.repository.record_restore_event(
            organization_id=organization_id, template_id=template_id,
            source_version_id=source_version_id,
            draft_version_id=template["draftVersionId"],
            actor_user_id=actor_user_id, reason=reason, audit_reference=None,
        )
        self._audit_required(
            "document.word_template_restored_as_draft", organization_id,
            actor_user_id, template_id, request,
            {
                "sourceVersionId": source_version_id,
                "draftVersionId": template["draftVersionId"],
                "publicationEventId": event_id,
            },
        )
        return template

    def get_standardization_candidate(
        self, *, organization_id, version_id, accepted_preflight_run_id,
        profile, include_content=False,
    ):
        version = self.get_version(
            organization_id,
            version_id,
            include_content=include_content,
        )
        run = self.repository.get_preflight(
            organization_id,
            str(accepted_preflight_run_id or "").strip(),
        )
        standardization = self._accepted_standardization(
            version=version,
            run=run,
            profile=profile,
        )
        return {
            "version": version,
            "preflight": run,
            "standardization": standardization,
        }

    def create_standardized_draft(
        self, *, organization_id, template_id, source_version_id,
        accepted_preflight_run_id, expected_row_version, profile,
        standardized_content, actor_user_id, reason, request=None,
    ):
        candidate = self.get_standardization_candidate(
            organization_id=organization_id,
            version_id=source_version_id,
            accepted_preflight_run_id=accepted_preflight_run_id,
            profile=profile,
        )
        source = candidate["version"]
        if source["templateId"] != template_id:
            raise CatalogNotFoundError()
        reason = _bounded_text(reason, "reason", 2000)
        if not isinstance(standardized_content, bytes) or not standardized_content:
            raise CatalogError(fields={"standardizedContent": "INVALID_VALUE"})
        output_sha256 = hashlib.sha256(standardized_content).hexdigest()
        expected = self._row_version(expected_row_version)
        current_template, error = self.repository.validate_template_cas(
            organization_id,
            template_id,
            expected,
        )
        self._raise_repository_error(error, current_template)
        standardization = candidate["standardization"]
        if output_sha256 == source["sha256"]:
            self._audit_required(
                "document.word_template_standardization_noop",
                organization_id,
                actor_user_id,
                template_id,
                request,
                {
                    "sourceVersionId": source_version_id,
                    "acceptedPreflightRunId": accepted_preflight_run_id,
                    "profile": candidate["standardization"]["profile"],
                    "sha256": source["sha256"],
                },
            )
            return {
                "template": current_template,
                "created": False,
                "sourceVersionId": source_version_id,
            }

        existing = self.repository.find_standardized_version(
            organization_id=organization_id,
            template_id=template_id,
            source_version_id=source_version_id,
            output_sha256=output_sha256,
            accepted_preflight_run_id=accepted_preflight_run_id,
            profile=standardization["profile"],
            analysis_hash=standardization["analysisHash"],
        )
        if (
            existing is not None
            and existing["id"] == current_template.get("draftVersionId")
        ):
            self._audit_required(
                "document.word_template_standardization_replayed",
                organization_id,
                actor_user_id,
                template_id,
                request,
                {
                    "sourceVersionId": source_version_id,
                    "draftVersionId": existing["id"],
                    "acceptedPreflightRunId": accepted_preflight_run_id,
                    "profile": standardization["profile"],
                    "outputSha256": output_sha256,
                },
            )
            return {
                "template": current_template,
                "created": False,
                "replayed": True,
                "sourceVersionId": source_version_id,
                "draftVersionId": existing["id"],
            }

        content = self._store(organization_id, standardized_content)
        metadata = {
            "reason": reason,
            "standardization": {
                "acceptedPreflightRunId": accepted_preflight_run_id,
                "acceptedPreflightReportHash": candidate["preflight"]["reportHash"],
                "analysisHash": standardization["analysisHash"],
                "engineVersion": standardization["engineVersion"],
                "profile": standardization["profile"],
                "ruleSet": standardization["ruleSet"],
                "sourceTemplateSha256": source["sha256"],
                "outputTemplateSha256": output_sha256,
                "summary": standardization["summary"],
                "changes": standardization.get("plannedChanges") or [],
            },
        }
        manifest_json, manifest_hash = self._manifest(
            action="STANDARDIZE",
            metadata=metadata,
            source_version_id=source_version_id,
        )
        filename = self._standardized_filename(source["originalFilename"])
        template, error = self.repository.create_draft_version(
            organization_id=organization_id,
            template_id=template_id,
            expected_row_version=expected,
            version=self._version_values(
                content,
                filename,
                actor_user_id,
                manifest_json,
                manifest_hash,
                source_version_id=source_version_id,
            ),
        )
        self._raise_repository_error(error, template)
        self._audit_required(
            "document.word_template_standardized",
            organization_id,
            actor_user_id,
            template_id,
            request,
            {
                "sourceVersionId": source_version_id,
                "draftVersionId": template["draftVersionId"],
                "acceptedPreflightRunId": accepted_preflight_run_id,
                "profile": standardization["profile"],
                "ruleSetVersion": standardization["ruleSet"]["version"],
                "sourceSha256": source["sha256"],
                "outputSha256": output_sha256,
                "changeCount": len(standardization.get("plannedChanges") or []),
            },
        )
        return {
            "template": template,
            "created": True,
            "sourceVersionId": source_version_id,
            "draftVersionId": template["draftVersionId"],
        }

    def publish(
        self, *, organization_id, template_id, version_id,
        accepted_preflight_run_id, expected_row_version, actor_user_id,
        reason, request=None, config_revision=None,
    ):
        version = self.repository.get_version(organization_id, version_id)
        if version is None or version["templateId"] != template_id:
            raise CatalogNotFoundError()
        run = self.repository.get_preflight(
            organization_id, accepted_preflight_run_id
        )
        if (
            run is None
            or run["templateVersionId"] != version_id
            or run["templateSha256"] != version["sha256"]
            or run["result"] != "PASS"
            or not self._preflight_is_fresh(run["runAt"])
        ):
            raise CatalogConflictError(
                fields={"acceptedPreflightRunId": "NOT_ACCEPTABLE"}
            )
        reason = _bounded_text(reason, "reason", 2000)
        template, error = self.repository.publish(
            organization_id=organization_id, template_id=template_id,
            version_id=version_id, preflight_run_id=accepted_preflight_run_id,
            expected_row_version=self._row_version(expected_row_version),
            actor_user_id=actor_user_id, reason=reason,
            config_revision=config_revision, audit_reference=None,
        )
        self._raise_repository_error(error, template)
        self._audit_required(
            "document.word_template_published", organization_id,
            actor_user_id, template_id, request,
            {
                "versionId": version_id,
                "acceptedPreflightRunId": accepted_preflight_run_id,
                "sha256": version["sha256"],
                "rowVersion": template["rowVersion"],
            },
        )
        return template

    def get_usage(self, organization_id, *, template_id=None, version_id=None):
        usage = self.repository.usage(
            organization_id, template_id=template_id, version_id=version_id
        )
        if usage is None:
            raise CatalogNotFoundError()
        return usage

    def record_generated_provenance(
        self, *, organization_id, artifact_id, template_version_id,
        template_sha256, record_type, record_id, record_row_version,
        artifact_sha256, actor_user_id,
    ):
        version = self.repository.get_version(organization_id, template_version_id)
        if version is None:
            raise CatalogNotFoundError()
        if version["sha256"] != template_sha256:
            raise CatalogConflictError(fields={"templateSha256": "MISMATCH"})
        for field, value in (
            ("artifactId", artifact_id),
            ("artifactSha256", artifact_sha256),
        ):
            _bounded_text(value, field, 255 if field == "artifactId" else 64)
        if not re.fullmatch(r"[0-9a-f]{64}", str(artifact_sha256).casefold()):
            raise CatalogError(fields={"artifactSha256": "INVALID_VALUE"})
        return self.repository.record_generated_provenance(
            organization_id=organization_id,
            artifact_id=artifact_id,
            template_version_id=template_version_id,
            template_sha256=template_sha256,
            record_type=str(record_type or "").strip() or None,
            record_id=str(record_id or "").strip() or None,
            record_row_version=record_row_version,
            artifact_sha256=str(artifact_sha256).casefold(),
            created_by_id=actor_user_id,
        )

    def _audit_required(
        self, action, organization_id, actor_user_id, template_id, request, metadata,
    ):
        self._audit(
            action, actor_user_id=actor_user_id,
            organization_id=organization_id, target_type="word_template",
            target_id=template_id, request=request, metadata=metadata,
            cursor=self.repository.cursor, required=True,
        )

    def _store(self, organization_id, content):
        return self.storage.put(organization_id, content)

    @staticmethod
    def _manifest(*, action, metadata, source_version_id):
        manifest = {
            "schemaVersion": MANIFEST_SCHEMA_VERSION,
            "action": action,
            "sourceVersionId": source_version_id,
            "metadata": dict(metadata or {}),
        }
        rendered = _canonical_json(manifest)
        return rendered, hashlib.sha256(rendered.encode("utf-8")).hexdigest()

    @staticmethod
    def _version_values(
        content, original_filename, actor_user_id, manifest_json,
        manifest_hash, *, source_version_id,
    ):
        storage_key, sha256, byte_size = content
        return {
            "storage_key": storage_key, "sha256": sha256,
            "byte_size": byte_size,
            "original_filename": _bounded_text(
                original_filename, "originalFilename", 255
            ),
            "creation_manifest_json": manifest_json,
            "manifest_hash": manifest_hash,
            "sanitizer_version": SANITIZER_VERSION,
            "source_version_id": source_version_id,
            "created_by_id": actor_user_id,
        }

    @staticmethod
    def _row_version(value):
        if isinstance(value, bool) or not isinstance(value, int) or value < 1:
            raise CatalogError(fields={"expectedRowVersion": "INVALID_VALUE"})
        return value

    @staticmethod
    def _raise_repository_error(error, current):
        if error == "NOT_FOUND" or error == "VERSION_NOT_FOUND":
            raise CatalogNotFoundError()
        if error == "STALE":
            raise CatalogConflictError(current=current)
        if error:
            raise RuntimeError(f"Unexpected catalog repository result: {error}")

    def _preflight_is_fresh(self, value):
        if isinstance(value, datetime):
            timestamp = value
        else:
            timestamp = datetime.fromisoformat(str(value).replace("Z", "+00:00"))
        if timestamp.tzinfo is None:
            timestamp = timestamp.replace(tzinfo=timezone.utc)
        return timestamp >= self._now() - PREFLIGHT_MAX_AGE

    def _accepted_standardization(self, *, version, run, profile):
        selected_profile = str(profile or "").strip().casefold()
        standardization = (
            run.get("report", {}).get("standardization")
            if isinstance(run, dict) else None
        )
        if (
            run is None
            or run.get("templateVersionId") != version["id"]
            or run.get("templateSha256") != version["sha256"]
            or not run.get("runAt")
            or not self._preflight_is_fresh(run.get("runAt"))
            or not isinstance(standardization, dict)
            or standardization.get("templateSha256") != version["sha256"]
            or standardization.get("profile") != selected_profile
            or standardization.get("mode") != "preview_fix"
            or standardization.get("invariants", {}).get("status") != "PASS"
            or not re.fullmatch(
                r"[0-9a-f]{64}",
                str(standardization.get("analysisHash") or ""),
            )
        ):
            raise CatalogConflictError(
                fields={"acceptedPreflightRunId": "STANDARDIZATION_NOT_ACCEPTABLE"}
            )
        return standardization

    @staticmethod
    def _standardized_filename(value):
        filename = str(value or "template.docx").strip()
        stem = filename[:-5] if filename.casefold().endswith(".docx") else filename
        suffix = "-chuan-hoa.docx"
        return f"{stem[:255 - len(suffix)]}{suffix}"

    @staticmethod
    def _lifecycle(template, version_id):
        if template["publishedVersionId"] == version_id:
            return "PUBLISHED"
        if template["draftVersionId"] == version_id:
            return "DRAFT"
        return "RETIRED"
