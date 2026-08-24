"""Legacy inventory, cutover resolver and durable alias projection adapter."""

from __future__ import annotations

import asyncio
import hashlib
import os
import re
import uuid
from pathlib import Path

from backend.documents import custom_exporter
from backend.shared.workspace_scope import personal_scope_owner_id
from backend.shared.idle_backoff import idle_poll_backoff_from_env
from backend.shared.logging_utils import log_audit, log_error

from .preflight import TemplatePreflight
from .repository import WordTemplateCatalogRepository
from .service import WordTemplateCatalog
from .storage import ImmutableTemplateStorage


CATALOG_MODES = frozenset({"shadow", "cutover"})


def catalog_enabled(environ=None) -> bool:
    environment = os.environ if environ is None else environ
    return str(environment.get("WORD_TEMPLATE_CATALOG_ENABLED", "false")).strip().casefold() == "true"


def catalog_mode(environ=None) -> str:
    environment = os.environ if environ is None else environ
    mode = str(environment.get("WORD_TEMPLATE_CATALOG_MODE", "shadow")).strip().casefold()
    if mode not in CATALOG_MODES:
        raise RuntimeError("WORD_TEMPLATE_CATALOG_MODE must be shadow or cutover.")
    return mode


def _safe_alias(value: str) -> str:
    alias = str(value or "").strip()
    if (
        not alias
        or len(alias) > 255
        or not alias.casefold().endswith(".docx")
        or Path(alias).name != alias
        or re.search(r'[<>:"/\\|?*\x00-\x1f]', alias)
    ):
        raise ValueError("Legacy Word-template alias is invalid.")
    return alias


def _stable_code(filename: str, digest: str) -> str:
    stem = Path(filename).stem.casefold().replace("_", "-")
    stem = re.sub(r"[^a-z0-9-]+", "-", stem).strip("-") or "legacy-template"
    return f"{stem[:140]}-{digest[:12]}"


class LegacyTemplateInventory:
    """Mirror the exact legacy authority into catalog rows during shadow mode."""

    def __init__(self, repository, storage, *, audit=None):
        self.repository = repository
        self.storage = storage
        self.catalog = WordTemplateCatalog(
            repository, storage, **({"audit": audit} if audit else {})
        )
        self.preflight = TemplatePreflight(repository, storage)

    def inventory_scope(
        self, *, organization_id: str, owner_type: str, owner_id: str,
        actor_user_id: str, request=None,
    ):
        if catalog_mode() != "shadow":
            raise RuntimeError("Legacy inventory is allowed only in shadow mode.")
        scope_dir = Path(
            custom_exporter.get_scope_template_dir(
                owner_type, owner_id, create=False
            )
        ).resolve()
        assignments = custom_exporter.get_template_assignments(
            owner_id, owner_type=owner_type
        )
        revision = custom_exporter.get_template_config_revision(
            owner_id, owner_type=owner_type
        )
        assigned_types_by_alias = {}
        for document_type, aliases in assignments.items():
            for alias in aliases:
                assigned_types_by_alias.setdefault(alias.casefold(), []).append(
                    document_type
                )

        report = {
            "schemaVersion": 1,
            "mode": "shadow",
            "organizationId": organization_id,
            "configRevision": revision,
            "templates": [],
            "assignments": [],
            "parity": True,
        }
        by_alias = {}
        self.repository.ensure_assignment_config(
            organization_id=organization_id,
            owner_type=owner_type,
            revision=revision,
            actor_user_id=actor_user_id,
        )
        if scope_dir.exists():
            for path in sorted(scope_dir.iterdir(), key=lambda item: item.name.casefold()):
                if path.is_symlink() or not path.is_file() or path.suffix.casefold() != ".docx":
                    continue
                alias = _safe_alias(path.name)
                content = path.read_bytes()
                digest = hashlib.sha256(content).hexdigest()
                template = self.repository.get_by_alias(organization_id, alias)
                created = False
                if template is None:
                    template = self.catalog.create_template(
                        organization_id=organization_id,
                        owner_type=owner_type,
                        stable_code=_stable_code(alias, digest),
                        display_name=path.stem,
                        legacy_alias=alias,
                        original_filename=alias,
                        sanitized_content=content,
                        actor_user_id=actor_user_id,
                        request=request,
                        metadata={
                            "source": "LEGACY_SHADOW_INVENTORY",
                            "legacyConfigRevision": revision,
                        },
                    )
                    created = True
                version_id = template["publishedVersionId"] or template["draftVersionId"]
                version = self.repository.get_version(organization_id, version_id)
                parity = bool(version and version["sha256"] == digest)
                if (
                    created
                    and parity
                    and template["publishedVersionId"] is None
                ):
                    preflight = self.preflight.run(
                        organization_id=organization_id,
                        version_id=version_id,
                        actor_user_id=actor_user_id,
                        document_types=assigned_types_by_alias.get(alias.casefold()),
                    )
                    if preflight["result"] == "PASS":
                        template = self.catalog.publish(
                            organization_id=organization_id,
                            template_id=template["id"],
                            version_id=version_id,
                            accepted_preflight_run_id=preflight["id"],
                            expected_row_version=template["rowVersion"],
                            actor_user_id=actor_user_id,
                            reason="Legacy shadow inventory",
                            request=request,
                            config_revision=revision,
                        )
                    else:
                        parity = False
                by_alias[alias.casefold()] = template
                report["templates"].append({
                    "templateId": template["id"], "legacyAlias": alias,
                    "legacySha256": digest, "catalogSha256": version["sha256"],
                    "publishedVersionId": template["publishedVersionId"],
                    "parity": parity,
                })
                report["parity"] = report["parity"] and parity

        for document_type, aliases in sorted(assignments.items()):
            templates = [by_alias.get(alias.casefold()) for alias in aliases]
            complete = bool(templates) and all(
                template and template["publishedVersionId"] for template in templates
            )
            if complete:
                self.repository.replace_shadow_assignments(
                    organization_id=organization_id,
                    owner_type=owner_type,
                    document_type=document_type,
                    template_ids=[template["id"] for template in templates],
                )
            report["assignments"].append({
                "documentType": document_type,
                "legacyAliases": list(aliases),
                "catalogTemplateIds": [
                    template["id"] for template in templates if template
                ],
                "parity": complete,
            })
            report["parity"] = report["parity"] and complete
        return report


class CatalogPublicationResolver:
    """Resolve explicit assignment sets only after the atomic cutover switch."""

    def __init__(self, repository, storage, *, environ=None):
        self.repository = repository
        self.storage = storage
        self.environ = environ

    def resolve(self, organization_id: str, document_type: str, *, context_key="default"):
        if not catalog_enabled(self.environ) or catalog_mode(self.environ) != "cutover":
            return None
        assignments = self.repository.resolve_assignments(
            organization_id, document_type, context_key=context_key
        )
        if not assignments or any(not item["resolvedVersionId"] for item in assignments):
            return []
        return [
            {
                "templateId": item["templateId"],
                "templateVersionId": item["resolvedVersionId"],
                "sha256": item["sha256"],
                "byteSize": item["byteSize"],
                "legacyAlias": item["legacyAlias"],
                # Internal only; HTTP adapters must never serialize this key.
                "content": self.storage.read(
                    organization_id, item["storageKey"], item["sha256"]
                ),
            }
            for item in assignments
        ]


class LegacyAliasProjectionWorker:
    """Project DB-authoritative published bytes to legacy aliases after cutover."""

    def __init__(self, database, storage=None, *, environ=None):
        self.database = database
        self.storage = storage or ImmutableTemplateStorage()
        self.environ = environ

    def process_next(self) -> bool:
        if not catalog_enabled(self.environ) or catalog_mode(self.environ) != "cutover":
            return False
        job = self._claim()
        if job is None:
            return False
        try:
            self._project(job)
        except Exception as error:  # noqa: BLE001 - durable job records bounded error code.
            self._finish(job, error_code=type(error).__name__)
            return True
        self._finish(job)
        return True

    def recover_stale(self, *, stale_seconds=300):
        connection = self.database.get_connection()
        try:
            connection.execute("BEGIN")
            count = WordTemplateCatalogRepository(
                connection.cursor()
            ).recover_stale_projections(stale_seconds=stale_seconds)
            connection.commit()
            return count
        except Exception:
            connection.rollback()
            raise
        finally:
            connection.close()

    def _claim(self):
        connection = self.database.get_connection()
        try:
            connection.execute("BEGIN")
            job = WordTemplateCatalogRepository(
                connection.cursor()
            ).claim_projection()
            connection.commit()
            return job
        except Exception:
            connection.rollback()
            raise
        finally:
            connection.close()

    def _finish(self, job, *, error_code=None):
        connection = self.database.get_connection()
        try:
            connection.execute("BEGIN")
            repository = WordTemplateCatalogRepository(connection.cursor())
            if error_code:
                repository.retry_projection(
                    job["organizationId"], job["id"], error_code,
                    delay_seconds=min(3600, 2 ** min(job["attemptCount"], 10)),
                )
            else:
                repository.complete_projection(job["organizationId"], job["id"])
            connection.commit()
        except Exception:
            connection.rollback()
            raise
        finally:
            connection.close()

    def _project(self, job):
        if job["eventType"] == "ASSIGNMENT":
            return self._project_assignments(job)
        if job["eventType"] != "PUBLICATION":
            raise ValueError("Unsupported Word-template projection event.")
        content = self.storage.read(
            job["organizationId"], job["storageKey"], job["sha256"]
        )
        if hashlib.sha256(content).hexdigest() != job["desiredChecksum"]:
            raise RuntimeError("Projection desired checksum does not match version.")
        owner_id = (
            personal_scope_owner_id(job["organizationId"])
            if job["ownerType"] == "personal"
            else job["organizationId"]
        )
        if not owner_id:
            raise ValueError("Projection owner scope is invalid.")
        alias = _safe_alias(job["desiredAlias"])
        scope_dir = Path(
            custom_exporter.get_scope_template_dir(
                job["ownerType"], owner_id, create=True
            )
        ).resolve()
        destination = (scope_dir / alias).resolve()
        destination.relative_to(scope_dir)
        temporary = scope_dir / f".{alias}.{uuid.uuid4().hex}.projection"
        with custom_exporter.template_scope_file_lock(
            owner_id, owner_type=job["ownerType"]
        ):
            try:
                with temporary.open("xb") as handle:
                    handle.write(content)
                    handle.flush()
                    os.fsync(handle.fileno())
                os.replace(temporary, destination)
            finally:
                temporary.unlink(missing_ok=True)

    @staticmethod
    def _project_assignments(job):
        payload = job.get("payload") or {}
        assignments = payload.get("assignmentSets")
        if not isinstance(assignments, dict):
            raise ValueError("Assignment projection payload is invalid.")
        owner_id = (
            personal_scope_owner_id(job["organizationId"])
            if job["ownerType"] == "personal"
            else job["organizationId"]
        )
        if not owner_id:
            raise ValueError("Assignment projection owner scope is invalid.")
        revision = custom_exporter.get_template_config_revision(
            owner_id, owner_type=job["ownerType"]
        )
        custom_exporter.set_template_assignments(
            assignments,
            owner_id,
            owner_type=job["ownerType"],
            expected_revision=revision,
        )


async def run_legacy_alias_projection_worker(database) -> None:
    """Drain the durable projection outbox only while catalog cutover is active."""

    backoff = idle_poll_backoff_from_env(
        "WORD_TEMPLATE_PROJECTION_POLL_SECONDS",
        "WORD_TEMPLATE_PROJECTION_MAX_POLL_SECONDS",
        default_initial=2.0,
    )
    worker = LegacyAliasProjectionWorker(database)
    recovered = False
    while True:
        try:
            if not catalog_enabled() or catalog_mode() != "cutover":
                processed = False
                recovered = False
            else:
                if not recovered:
                    await asyncio.to_thread(worker.recover_stale)
                    recovered = True
                processed = await asyncio.to_thread(worker.process_next)
        except asyncio.CancelledError:
            raise
        except Exception as error:  # noqa: BLE001 - background worker must survive.
            log_error(error, "word_template_projection_worker", level="WARN")
            processed = False
        if processed:
            backoff.reset()
        await asyncio.sleep(0.1 if processed else backoff.next_delay())


def _purge_catalog_retention(database):
    connection = database.get_connection()
    try:
        connection.execute("BEGIN")
        repository = WordTemplateCatalogRepository(connection.cursor())
        result = repository.purge_expired_retention()
        if any(result.values()):
            log_audit(
                "document.word_template_retention_applied",
                target_type="word_template_catalog",
                metadata=result,
                cursor=repository.cursor,
                required=True,
            )
        connection.commit()
        return result
    except Exception:
        connection.rollback()
        raise
    finally:
        connection.close()


async def run_word_template_retention_janitor(database) -> None:
    while True:
        try:
            if catalog_enabled():
                await asyncio.to_thread(_purge_catalog_retention, database)
        except asyncio.CancelledError:
            raise
        except Exception as error:  # noqa: BLE001 - janitor retries next interval.
            log_error(error, "word_template_retention_janitor", level="WARN")
        try:
            interval = int(os.environ.get(
                "WORD_TEMPLATE_RETENTION_INTERVAL_SECONDS", "21600"
            ))
        except ValueError:
            interval = 21600
        await asyncio.sleep(max(300, min(86400, interval)))
