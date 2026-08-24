"""PostgreSQL repository for the immutable Word-template catalog."""

from __future__ import annotations

import hashlib
import json

from backend.db.id_utils import generate_record_id


def _id(prefix: str) -> str:
    return f"{prefix}{generate_record_id('')}"


def _dict(row, columns=()):
    if row is None:
        return None
    if hasattr(row, "keys"):
        return {key: row[key] for key in row.keys()}
    return dict(zip(columns, row))


_TEMPLATE_COLUMNS = (
    "id", "organization_id", "owner_type", "stable_code", "display_name",
    "legacy_alias", "draft_version_id", "published_version_id", "row_version",
    "created_by_id", "created_at", "updated_at", "retired_at",
)
_VERSION_COLUMNS = (
    "id", "organization_id", "template_id", "version_no", "storage_key",
    "sha256", "byte_size", "original_filename", "creation_manifest_json",
    "manifest_hash", "sanitizer_version", "source_version_id", "created_by_id",
    "created_at",
)
_PREFLIGHT_COLUMNS = (
    "id", "organization_id", "template_version_id", "template_sha256",
    "parser_version", "mapping_base_version", "mapping_snapshot_hash",
    "required_registry_version", "context_policy_version", "report_json",
    "report_hash", "result", "run_by_id", "run_at",
)


class WordTemplateCatalogRepository:
    def __init__(self, cursor):
        self.cursor = cursor

    def list_templates(self, organization_id: str, *, include_retired=False):
        predicate = "" if include_retired else "AND retired_at IS NULL"
        rows = self.cursor.execute(
            f"""SELECT {', '.join(_TEMPLATE_COLUMNS)}
                  FROM word_template
                 WHERE organization_id = ? {predicate}
                 ORDER BY lower(display_name), id""",  # noqa: S608
            (organization_id,),  # noqa: S608 - columns/predicate are module constants.
        ).fetchall()
        return [self._template(row) for row in rows]

    def get_template(self, organization_id: str, template_id: str, *, lock=False):
        suffix = " FOR UPDATE" if lock else ""
        row = self.cursor.execute(
            f"""SELECT {', '.join(_TEMPLATE_COLUMNS)}
                  FROM word_template
                 WHERE organization_id = ? AND id = ?{suffix}""",  # noqa: S608
            (organization_id, template_id),  # noqa: S608 - columns/suffix are constants.
        ).fetchone()
        return self._template(row)

    def get_by_alias(self, organization_id: str, legacy_alias: str):
        row = self.cursor.execute(
            f"""SELECT {', '.join(_TEMPLATE_COLUMNS)}
                  FROM word_template
                 WHERE organization_id = ? AND lower(legacy_alias) = lower(?)""",  # noqa: S608
            (organization_id, legacy_alias),  # noqa: S608 - columns are constants.
        ).fetchone()
        return self._template(row)

    def list_versions(self, organization_id: str, template_id: str):
        rows = self.cursor.execute(
            f"""SELECT {', '.join(_VERSION_COLUMNS)}
                  FROM word_template_version
                 WHERE organization_id = ? AND template_id = ?
                 ORDER BY version_no DESC""",  # noqa: S608
            (organization_id, template_id),  # noqa: S608 - columns are constants.
        ).fetchall()
        return [self._version(row) for row in rows]

    def get_version(self, organization_id: str, version_id: str):
        row = self.cursor.execute(
            f"""SELECT {', '.join(_VERSION_COLUMNS)}
                  FROM word_template_version
                 WHERE organization_id = ? AND id = ?""",  # noqa: S608
            (organization_id, version_id),
        ).fetchone()
        return self._version(row)

    def validate_template_cas(
        self, organization_id: str, template_id: str, expected_row_version: int,
    ):
        template = self.get_template(organization_id, template_id, lock=True)
        if template is None:
            return None, "NOT_FOUND"
        if template["rowVersion"] != expected_row_version:
            return template, "STALE"
        return template, None

    def find_standardized_version(
        self, *, organization_id, template_id, source_version_id,
        output_sha256, accepted_preflight_run_id, profile, analysis_hash,
    ):
        rows = self.cursor.execute(
            f"""SELECT {', '.join(_VERSION_COLUMNS)}
                  FROM word_template_version
                 WHERE organization_id = ? AND template_id = ?
                   AND source_version_id = ? AND sha256 = ?
                 ORDER BY version_no DESC""",  # noqa: S608
            (
                organization_id, template_id, source_version_id, output_sha256,
            ),  # noqa: S608 - columns are module constants.
        ).fetchall()
        for row in rows:
            version = self._version(row)
            manifest = version.get("creationManifest") or {}
            standardization = (
                manifest.get("metadata", {}).get("standardization", {})
                if isinstance(manifest, dict) else {}
            )
            if (
                manifest.get("action") == "STANDARDIZE"
                and standardization.get("acceptedPreflightRunId")
                == accepted_preflight_run_id
                and standardization.get("profile") == profile
                and standardization.get("analysisHash") == analysis_hash
            ):
                return version
        return None

    def create_template_with_draft(
        self, *, organization_id, owner_type, stable_code, display_name,
        legacy_alias, created_by_id, version,
    ):
        template_id = _id("wtpl-")
        version_id = _id("wtv-")
        self.cursor.execute(
            """INSERT INTO word_template
                 (organization_id, id, owner_type, stable_code, display_name,
                  legacy_alias, created_by_id)
               VALUES (?, ?, ?, ?, ?, ?, ?)""",
            (
                organization_id, template_id, owner_type, stable_code,
                display_name, legacy_alias, created_by_id,
            ),
        )
        self._insert_version(
            organization_id=organization_id,
            template_id=template_id,
            version_id=version_id,
            version_no=1,
            **version,
        )
        self.cursor.execute(
            """UPDATE word_template SET draft_version_id = ?
                WHERE organization_id = ? AND id = ?""",
            (version_id, organization_id, template_id),
        )
        return self.get_template(organization_id, template_id)

    def create_draft_version(
        self, *, organization_id, template_id, expected_row_version, version,
    ):
        template = self.get_template(organization_id, template_id, lock=True)
        if template is None:
            return None, "NOT_FOUND"
        if template["rowVersion"] != expected_row_version:
            return template, "STALE"
        next_no = self.cursor.execute(
            """SELECT COALESCE(MAX(version_no), 0) + 1
                 FROM word_template_version
                WHERE organization_id = ? AND template_id = ?""",
            (organization_id, template_id),
        ).fetchone()[0]
        version_id = _id("wtv-")
        self._insert_version(
            organization_id=organization_id,
            template_id=template_id,
            version_id=version_id,
            version_no=int(next_no),
            **version,
        )
        updated = self.cursor.execute(
            """UPDATE word_template
                  SET draft_version_id = ?, row_version = row_version + 1,
                      updated_at = CURRENT_TIMESTAMP, retired_at = NULL
                WHERE organization_id = ? AND id = ? AND row_version = ?""",
            (version_id, organization_id, template_id, expected_row_version),
        )
        if updated.rowcount != 1:
            raise RuntimeError("Template draft CAS changed while holding its row lock.")
        return self.get_template(organization_id, template_id), None

    def _insert_version(
        self, *, organization_id, template_id, version_id, version_no,
        storage_key, sha256, byte_size, original_filename,
        creation_manifest_json, manifest_hash, sanitizer_version,
        source_version_id, created_by_id,
    ):
        self.cursor.execute(
            """INSERT INTO word_template_version
                 (organization_id, id, template_id, version_no, storage_key,
                  sha256, byte_size, original_filename, creation_manifest_json,
                  manifest_hash, sanitizer_version, source_version_id, created_by_id)
               VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)""",
            (
                organization_id, version_id, template_id, version_no, storage_key,
                sha256, byte_size, original_filename, creation_manifest_json,
                manifest_hash, sanitizer_version, source_version_id, created_by_id,
            ),
        )

    def get_preflight(self, organization_id: str, run_id: str):
        row = self.cursor.execute(
            f"""SELECT {', '.join(_PREFLIGHT_COLUMNS)}
                  FROM word_template_preflight_run
                 WHERE organization_id = ? AND id = ?""",  # noqa: S608
            (organization_id, run_id),  # noqa: S608 - columns are constants.
        ).fetchone()
        return self._preflight(row)

    def insert_preflight(self, *, organization_id, values):
        run_id = _id("wtpf-")
        self.cursor.execute(
            """INSERT INTO word_template_preflight_run
                 (organization_id, id, template_version_id, template_sha256,
                  parser_version, mapping_base_version, mapping_snapshot_hash,
                  required_registry_version, context_policy_version, report_json,
                  report_hash, result, run_by_id)
               VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)""",
            (
                organization_id, run_id, values["template_version_id"],
                values["template_sha256"], values["parser_version"],
                values["mapping_base_version"], values["mapping_snapshot_hash"],
                values["required_registry_version"], values["context_policy_version"],
                values["report_json"], values["report_hash"], values["result"],
                values["run_by_id"],
            ),
        )
        return self.get_preflight(organization_id, run_id)

    def publish(
        self, *, organization_id, template_id, version_id, preflight_run_id,
        expected_row_version, actor_user_id, reason, config_revision,
        audit_reference,
    ):
        template = self.get_template(organization_id, template_id, lock=True)
        if template is None:
            return None, "NOT_FOUND"
        if template["rowVersion"] != expected_row_version:
            return template, "STALE"
        version = self.get_version(organization_id, version_id)
        if version is None or version["templateId"] != template_id:
            return template, "VERSION_NOT_FOUND"
        previous = template["publishedVersionId"]
        updated = self.cursor.execute(
            """UPDATE word_template
                  SET published_version_id = ?,
                      draft_version_id = CASE WHEN draft_version_id = ? THEN NULL ELSE draft_version_id END,
                      row_version = row_version + 1,
                      updated_at = CURRENT_TIMESTAMP,
                      retired_at = NULL
                WHERE organization_id = ? AND id = ? AND row_version = ?""",
            (
                version_id, version_id, organization_id, template_id,
                expected_row_version,
            ),
        )
        if updated.rowcount != 1:
            raise RuntimeError("Template publish CAS changed while holding its row lock.")
        event_id = _id("wtpe-")
        self.cursor.execute(
            """INSERT INTO word_template_publication_event
                 (organization_id, id, template_id, from_version_id, to_version_id,
                  action, accepted_preflight_run_id, actor_user_id, reason,
                  config_revision, audit_reference)
               VALUES (?, ?, ?, ?, ?, 'PUBLISH', ?, ?, ?, ?, ?)""",
            (
                organization_id, event_id, template_id, previous, version_id,
                preflight_run_id, actor_user_id, reason, config_revision,
                audit_reference,
            ),
        )
        self.enqueue_projection(
            organization_id=organization_id,
            template_id=template_id,
            version_id=version_id,
            event_type="PUBLICATION",
            desired_alias=template["legacyAlias"],
            desired_checksum=version["sha256"],
            payload={"schemaVersion": 1, "publicationEventId": event_id},
        )
        return self.get_template(organization_id, template_id), None

    def record_restore_event(
        self, *, organization_id, template_id, source_version_id,
        draft_version_id, actor_user_id, reason, audit_reference,
    ):
        event_id = _id("wtpe-")
        self.cursor.execute(
            """INSERT INTO word_template_publication_event
                 (organization_id, id, template_id, from_version_id, to_version_id,
                  action, actor_user_id, reason, audit_reference)
               VALUES (?, ?, ?, ?, ?, 'RESTORE', ?, ?, ?)""",
            (
                organization_id, event_id, template_id, source_version_id,
                draft_version_id, actor_user_id, reason, audit_reference,
            ),
        )
        return event_id

    def enqueue_projection(
        self, *, organization_id, template_id, version_id, event_type,
        desired_alias, desired_checksum, payload,
    ):
        self.cursor.execute(
            """INSERT INTO word_template_projection_outbox
                 (organization_id, id, template_id, template_version_id,
                  event_type, desired_alias, desired_checksum, payload_json)
               VALUES (?, ?, ?, ?, ?, ?, ?, ?)
               ON CONFLICT (organization_id, template_id, event_type, desired_checksum)
               DO NOTHING""",
            (
                organization_id, _id("wtpo-"), template_id, version_id,
                event_type, desired_alias, desired_checksum,
                json.dumps(payload, ensure_ascii=False, sort_keys=True),
            ),
        )

    def replace_shadow_assignments(
        self, *, organization_id, owner_type, document_type, template_ids,
        context_key="default",
    ):
        """Mirror one legacy assignment set while legacy remains authority."""

        self.cursor.execute(
            """DELETE FROM word_publication_assignment_v2
                WHERE organization_id = ? AND document_type = ? AND context_key = ?""",
            (organization_id, document_type, context_key),
        )
        for sort_order, template_id in enumerate(template_ids):
            self.cursor.execute(
                """INSERT INTO word_publication_assignment_v2
                     (organization_id, id, owner_type, document_type, context_key,
                      template_id, resolution_mode, sort_order)
                   VALUES (?, ?, ?, ?, ?, ?, 'FOLLOW_PUBLISHED', ?)""",
                (
                    organization_id, _id("wtas-"), owner_type, document_type,
                    context_key, template_id, sort_order,
                ),
            )

    def ensure_assignment_config(
        self, *, organization_id, owner_type, revision=0, actor_user_id=None,
    ):
        self.cursor.execute(
            """INSERT INTO word_template_assignment_config
                 (organization_id, id, owner_type, revision, updated_by_id)
               VALUES (?, ?, ?, ?, ?)
               ON CONFLICT (organization_id) DO NOTHING""",
            (
                organization_id, _id("wtac-"), owner_type,
                max(0, int(revision)), actor_user_id,
            ),
        )
        row = self.cursor.execute(
            """SELECT id, owner_type, revision, updated_by_id, updated_at
                 FROM word_template_assignment_config
                WHERE organization_id = ?""",
            (organization_id,),
        ).fetchone()
        return {
            "id": row[0], "ownerType": row[1], "revision": int(row[2]),
            "updatedById": row[3], "updatedAt": row[4],
        }

    def list_assignment_sets(self, organization_id):
        rows = self.cursor.execute(
            """SELECT assignment.document_type, assignment.template_id,
                      assignment.resolution_mode, assignment.pinned_version_id,
                      assignment.sort_order, template.legacy_alias,
                      template.published_version_id
                 FROM word_publication_assignment_v2 AS assignment
                 JOIN word_template AS template
                   ON template.organization_id = assignment.organization_id
                  AND template.id = assignment.template_id
                WHERE assignment.organization_id = ?
                  AND assignment.context_key = 'default'
                ORDER BY assignment.document_type, assignment.sort_order,
                         assignment.id""",
            (organization_id,),
        ).fetchall()
        result = {}
        for row in rows:
            result.setdefault(row[0], []).append({
                "templateId": row[1], "resolutionMode": row[2],
                "pinnedVersionId": row[3], "sortOrder": int(row[4]),
                "legacyAlias": row[5], "publishedVersionId": row[6],
            })
        return result

    def replace_assignments_cas(
        self, *, organization_id, owner_type, template_ids_by_document,
        aliases_by_document, expected_revision, actor_user_id,
    ):
        config = self.ensure_assignment_config(
            organization_id=organization_id, owner_type=owner_type,
            actor_user_id=actor_user_id,
        )
        row = self.cursor.execute(
            """SELECT revision FROM word_template_assignment_config
                WHERE organization_id = ? FOR UPDATE""",
            (organization_id,),
        ).fetchone()
        current_revision = int(row[0])
        if current_revision != int(expected_revision):
            return config, "STALE"
        self.cursor.execute(
            """DELETE FROM word_publication_assignment_v2
                WHERE organization_id = ? AND context_key = 'default'""",
            (organization_id,),
        )
        for document_type, template_ids in template_ids_by_document.items():
            for sort_order, template_id in enumerate(template_ids):
                self.cursor.execute(
                    """INSERT INTO word_publication_assignment_v2
                         (organization_id, id, owner_type, document_type,
                          context_key, template_id, resolution_mode, sort_order)
                       VALUES (?, ?, ?, ?, 'default', ?, 'FOLLOW_PUBLISHED', ?)""",
                    (
                        organization_id, _id("wtas-"), owner_type,
                        document_type, template_id, sort_order,
                    ),
                )
        next_revision = current_revision + 1
        self.cursor.execute(
            """UPDATE word_template_assignment_config
                  SET revision = ?, updated_by_id = ?, updated_at = CURRENT_TIMESTAMP
                WHERE organization_id = ?""",
            (next_revision, actor_user_id, organization_id),
        )
        payload = {
            "schemaVersion": 1, "ownerType": owner_type,
            "assignmentSets": aliases_by_document,
            "assignmentRevision": next_revision,
        }
        payload_json = json.dumps(
            payload, ensure_ascii=False, sort_keys=True, separators=(",", ":")
        )
        digest = hashlib.sha256(payload_json.encode("utf-8")).hexdigest()
        self.cursor.execute(
            """INSERT INTO word_template_projection_outbox
                 (organization_id, id, template_id, template_version_id,
                  event_type, desired_alias, desired_checksum, payload_json)
               VALUES (?, ?, NULL, NULL, 'ASSIGNMENT', '__assignments__', ?, ?)
               ON CONFLICT DO NOTHING""",
            (organization_id, _id("wtpo-"), digest, payload_json),
        )
        return self.ensure_assignment_config(
            organization_id=organization_id, owner_type=owner_type,
        ), None

    def resolve_assignments(
        self, organization_id: str, document_type: str, *, context_key="default",
    ):
        rows = self.cursor.execute(
            """SELECT assignment.id, assignment.template_id,
                      assignment.resolution_mode, assignment.pinned_version_id,
                      assignment.sort_order, assignment.row_version,
                      template.published_version_id,
                      version.storage_key, version.sha256, version.byte_size,
                      template.legacy_alias
                 FROM word_publication_assignment_v2 AS assignment
                 JOIN word_template AS template
                   ON template.organization_id = assignment.organization_id
                  AND template.id = assignment.template_id
                 LEFT JOIN word_template_version AS version
                   ON version.organization_id = assignment.organization_id
                  AND version.id = CASE
                        WHEN assignment.resolution_mode = 'PIN_VERSION'
                        THEN assignment.pinned_version_id
                        ELSE template.published_version_id
                      END
                WHERE assignment.organization_id = ?
                  AND assignment.document_type = ?
                  AND assignment.context_key = ?
                  AND template.retired_at IS NULL
                ORDER BY assignment.sort_order, assignment.id""",
            (organization_id, document_type, context_key),
        ).fetchall()
        return [
            {
                "assignmentId": row[0], "templateId": row[1],
                "resolutionMode": row[2], "pinnedVersionId": row[3],
                "sortOrder": int(row[4]), "rowVersion": int(row[5]),
                "publishedVersionId": row[6], "storageKey": row[7],
                "sha256": row[8], "byteSize": row[9], "legacyAlias": row[10],
                "resolvedVersionId": row[3] if row[2] == "PIN_VERSION" else row[6],
            }
            for row in rows
        ]

    def claim_projection(self):
        row = self.cursor.execute(
            """SELECT outbox.id, outbox.organization_id, outbox.template_id,
                      outbox.template_version_id, outbox.event_type,
                      outbox.desired_alias, outbox.desired_checksum,
                      outbox.attempt_count,
                      COALESCE(template.owner_type, config.owner_type),
                      version.storage_key, version.sha256, outbox.payload_json
                 FROM word_template_projection_outbox AS outbox
                 LEFT JOIN word_template AS template
                   ON template.organization_id = outbox.organization_id
                  AND template.id = outbox.template_id
                 LEFT JOIN word_template_assignment_config AS config
                   ON config.organization_id = outbox.organization_id
                 LEFT JOIN word_template_version AS version
                   ON version.organization_id = outbox.organization_id
                  AND version.id = outbox.template_version_id
                WHERE outbox.status IN ('PENDING', 'RETRY')
                  AND outbox.available_at <= CURRENT_TIMESTAMP
                ORDER BY outbox.available_at, outbox.created_at, outbox.id
                FOR UPDATE OF outbox SKIP LOCKED
                LIMIT 1"""
        ).fetchone()
        if row is None:
            return None
        self.cursor.execute(
            """UPDATE word_template_projection_outbox
                  SET status = 'PROCESSING', locked_at = CURRENT_TIMESTAMP,
                      attempt_count = attempt_count + 1,
                      updated_at = CURRENT_TIMESTAMP
                WHERE organization_id = ? AND id = ?""",
            (row[1], row[0]),
        )
        return {
            "id": row[0], "organizationId": row[1], "templateId": row[2],
            "templateVersionId": row[3], "eventType": row[4],
            "desiredAlias": row[5], "desiredChecksum": row[6],
            "attemptCount": int(row[7]) + 1, "ownerType": row[8],
            "storageKey": row[9], "sha256": row[10],
            "payload": json.loads(row[11]),
        }

    def complete_projection(self, organization_id: str, projection_id: str):
        self.cursor.execute(
            """UPDATE word_template_projection_outbox
                  SET status = 'COMPLETED', locked_at = NULL,
                      last_error_code = NULL, updated_at = CURRENT_TIMESTAMP
                WHERE organization_id = ? AND id = ? AND status = 'PROCESSING'""",
            (organization_id, projection_id),
        )

    def retry_projection(
        self, organization_id: str, projection_id: str, error_code: str,
        *, delay_seconds=30,
    ):
        self.cursor.execute(
            """UPDATE word_template_projection_outbox
                  SET status = CASE WHEN attempt_count >= 10 THEN 'FAILED' ELSE 'RETRY' END,
                      locked_at = NULL, last_error_code = ?,
                      available_at = CURRENT_TIMESTAMP + (? * INTERVAL '1 second'),
                      updated_at = CURRENT_TIMESTAMP
                WHERE organization_id = ? AND id = ? AND status = 'PROCESSING'""",
            (
                str(error_code or "PROJECTION_FAILED")[:128],
                max(1, min(3600, int(delay_seconds))),
                organization_id, projection_id,
            ),
        )

    def recover_stale_projections(self, *, stale_seconds=300):
        result = self.cursor.execute(
            """UPDATE word_template_projection_outbox
                  SET status = 'RETRY', locked_at = NULL,
                      last_error_code = 'STALE_LEASE_RECOVERED',
                      available_at = CURRENT_TIMESTAMP,
                      updated_at = CURRENT_TIMESTAMP
                WHERE status = 'PROCESSING'
                  AND locked_at < CURRENT_TIMESTAMP - (? * INTERVAL '1 second')""",
            (max(60, min(86400, int(stale_seconds))),),
        )
        return int(result.rowcount or 0)

    def purge_expired_retention(self, *, draft_days=90, preflight_days=30):
        """Delete only unreferenced abandoned drafts and expired preflights."""

        preflights = self.cursor.execute(
            """DELETE FROM word_template_preflight_run AS run
                WHERE run.run_at < CURRENT_TIMESTAMP - (? * INTERVAL '1 day')
                  AND NOT EXISTS (
                        SELECT 1 FROM word_template_publication_event AS event
                         WHERE event.organization_id = run.organization_id
                           AND event.accepted_preflight_run_id = run.id
                  )""",
            (max(1, int(preflight_days)),),
        )
        versions = self.cursor.execute(
            """DELETE FROM word_template_version AS version
                WHERE version.created_at < CURRENT_TIMESTAMP - (? * INTERVAL '1 day')
                  AND NOT EXISTS (
                        SELECT 1 FROM word_template AS template
                         WHERE template.organization_id = version.organization_id
                           AND (template.draft_version_id = version.id
                                OR template.published_version_id = version.id)
                  )
                  AND NOT EXISTS (
                        SELECT 1 FROM word_template_publication_event AS event
                         WHERE event.organization_id = version.organization_id
                           AND (event.from_version_id = version.id
                                OR event.to_version_id = version.id)
                  )
                  AND NOT EXISTS (
                        SELECT 1 FROM word_template_version AS child
                         WHERE child.organization_id = version.organization_id
                           AND child.source_version_id = version.id
                  )
                  AND NOT EXISTS (
                        SELECT 1 FROM word_template_preflight_run AS run
                         WHERE run.organization_id = version.organization_id
                           AND run.template_version_id = version.id
                  )
                  AND NOT EXISTS (
                        SELECT 1 FROM word_publication_assignment_v2 AS assignment
                         WHERE assignment.organization_id = version.organization_id
                           AND assignment.pinned_version_id = version.id
                  )
                  AND NOT EXISTS (
                        SELECT 1 FROM generated_document_provenance AS provenance
                         WHERE provenance.organization_id = version.organization_id
                           AND provenance.template_version_id = version.id
                  )
                  AND NOT EXISTS (
                        SELECT 1 FROM word_template_projection_outbox AS outbox
                         WHERE outbox.organization_id = version.organization_id
                           AND outbox.template_version_id = version.id
                  )""",
            (max(1, int(draft_days)),),
        )
        return {
            "preflightRunsDeleted": int(preflights.rowcount or 0),
            "draftVersionsDeleted": int(versions.rowcount or 0),
        }

    def record_generated_provenance(
        self, *, organization_id, artifact_id, template_version_id,
        template_sha256, record_type, record_id, record_row_version,
        artifact_sha256, created_by_id,
    ):
        provenance_id = _id("wtdp-")
        self.cursor.execute(
            """INSERT INTO generated_document_provenance
                 (organization_id, id, artifact_id, template_version_id,
                  template_sha256, record_type, record_id, record_row_version,
                  artifact_sha256, created_by_id)
               VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
               ON CONFLICT (organization_id, artifact_id) DO NOTHING""",
            (
                organization_id, provenance_id, artifact_id, template_version_id,
                template_sha256, record_type, record_id, record_row_version,
                artifact_sha256, created_by_id,
            ),
        )
        row = self.cursor.execute(
            """SELECT id, template_version_id, template_sha256, artifact_sha256
                 FROM generated_document_provenance
                WHERE organization_id = ? AND artifact_id = ?""",
            (organization_id, artifact_id),
        ).fetchone()
        if (
            row[1] != template_version_id
            or row[2] != template_sha256
            or row[3] != artifact_sha256
        ):
            raise RuntimeError(
                "Generated-document artifact identity has conflicting provenance."
            )
        return {
            "id": row[0], "artifactId": artifact_id,
            "templateVersionId": row[1], "templateSha256": row[2],
            "artifactSha256": row[3],
        }

    def usage(self, organization_id: str, *, template_id=None, version_id=None):
        if not template_id and not version_id:
            raise ValueError("Template or version identity is required.")
        template = None
        if template_id:
            template = self.get_template(organization_id, template_id)
        elif version_id:
            version = self.get_version(organization_id, version_id)
            template = (
                self.get_template(organization_id, version["templateId"])
                if version else None
            )
        if template is None:
            return None
        assignment_rows = self.cursor.execute(
            """SELECT id, document_type, context_key, resolution_mode,
                      pinned_version_id, row_version, sort_order
                 FROM word_publication_assignment_v2
                WHERE organization_id = ? AND template_id = ?
                ORDER BY document_type, context_key""",
            (organization_id, template["id"]),
        ).fetchall()
        assignments = []
        for row in assignment_rows:
            matches = (
                version_id is None
                or row[3] == "FOLLOW_PUBLISHED"
                and template["publishedVersionId"] == version_id
                or row[3] == "PIN_VERSION" and row[4] == version_id
            )
            if matches:
                assignments.append({
                    "id": row[0], "documentType": row[1], "contextKey": row[2],
                    "resolutionMode": row[3], "pinnedVersionId": row[4],
                "rowVersion": int(row[5]), "sortOrder": int(row[6]),
                "usageState": "CURRENT",
                })
        provenance_rows = self.cursor.execute(
            """SELECT artifact_id, template_version_id, record_type, record_id,
                      record_row_version, artifact_sha256, created_at
                 FROM generated_document_provenance
                WHERE organization_id = ? AND template_version_id IN (
                      SELECT id FROM word_template_version
                       WHERE organization_id = ? AND template_id = ?)
                  AND (? IS NULL OR template_version_id = ?)
                ORDER BY created_at DESC
                LIMIT 500""",
            (
                organization_id, organization_id, template["id"],
                version_id, version_id,
            ),
        ).fetchall()
        provenance = [
            {
                "artifactId": row[0], "templateVersionId": row[1],
                "recordType": row[2], "recordId": row[3],
                "recordRowVersion": row[4], "artifactSha256": row[5],
                "createdAt": row[6], "usageState": "HISTORICAL",
            }
            for row in provenance_rows
        ]
        return {
            "templateId": template["id"], "versionId": version_id,
            "assignments": assignments, "generatedArtifacts": provenance,
            "unknownProviders": [],
        }

    @staticmethod
    def _template(row):
        value = _dict(row, _TEMPLATE_COLUMNS)
        if value is None:
            return None
        return {
            "id": value["id"], "organizationId": value["organization_id"],
            "ownerType": value["owner_type"], "stableCode": value["stable_code"],
            "displayName": value["display_name"], "legacyAlias": value["legacy_alias"],
            "draftVersionId": value["draft_version_id"],
            "publishedVersionId": value["published_version_id"],
            "rowVersion": int(value["row_version"]),
            "createdById": value["created_by_id"], "createdAt": value["created_at"],
            "updatedAt": value["updated_at"], "retiredAt": value["retired_at"],
        }

    @staticmethod
    def _version(row):
        value = _dict(row, _VERSION_COLUMNS)
        if value is None:
            return None
        return {
            "id": value["id"], "organizationId": value["organization_id"],
            "templateId": value["template_id"], "versionNo": int(value["version_no"]),
            "storageKey": value["storage_key"], "sha256": value["sha256"],
            "byteSize": int(value["byte_size"]),
            "originalFilename": value["original_filename"],
            "creationManifest": json.loads(value["creation_manifest_json"]),
            "manifestHash": value["manifest_hash"],
            "sanitizerVersion": value["sanitizer_version"],
            "sourceVersionId": value["source_version_id"],
            "createdById": value["created_by_id"], "createdAt": value["created_at"],
        }

    @staticmethod
    def _preflight(row):
        value = _dict(row, _PREFLIGHT_COLUMNS)
        if value is None:
            return None
        return {
            "id": value["id"], "organizationId": value["organization_id"],
            "templateVersionId": value["template_version_id"],
            "templateSha256": value["template_sha256"],
            "parserVersion": value["parser_version"],
            "mappingBaseVersion": value["mapping_base_version"],
            "mappingSnapshotHash": value["mapping_snapshot_hash"],
            "requiredRegistryVersion": value["required_registry_version"],
            "contextPolicyVersion": value["context_policy_version"],
            "report": json.loads(value["report_json"]), "reportHash": value["report_hash"],
            "result": value["result"], "runById": value["run_by_id"],
            "runAt": value["run_at"],
        }
