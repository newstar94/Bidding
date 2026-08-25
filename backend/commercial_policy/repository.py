"""Persistence adapter kept internal to the commercial policy module."""

from __future__ import annotations

from hashlib import sha256
import json
import time
import uuid

from .document import canonical_json, checksum_document
from .errors import CommercialPolicyError, POLICY_STALE, REFERENCE_IN_USE


def new_id(prefix):
    return f"{prefix}-{uuid.uuid4().hex}"


def _dict(row):
    return dict(row) if row is not None else None


class CommercialRepository:
    def __init__(self, cursor, *, clock=None):
        self.cursor = cursor
        self.clock = clock or time.time

    def get_draft(self, draft_id, *, for_update=False):
        statement = """SELECT id, schema_version, base_release_id, status, revision,
                      document_json, checksum, validation_digest,
                      validation_revision, validation_json,
                      readiness_expires_at, created_by, updated_by,
                      created_at, updated_at
                 FROM commercial_drafts WHERE id = ?"""
        if for_update:
            statement = """SELECT id, schema_version, base_release_id, status, revision,
                      document_json, checksum, validation_digest,
                      validation_revision, validation_json,
                      readiness_expires_at, created_by, updated_by,
                      created_at, updated_at
                 FROM commercial_drafts WHERE id = ? FOR UPDATE"""
        row = self.cursor.execute(
            statement,
            (draft_id,),
        ).fetchone()
        if not row:
            return None
        result = _dict(row)
        result["document"] = json.loads(result.pop("document_json"))
        validation_json = result.pop("validation_json")
        result["validation"] = json.loads(validation_json) if validation_json else None
        return result

    def list_drafts(self):
        return [
            _dict(row) for row in self.cursor.execute(
                """SELECT id, base_release_id, status, revision, checksum,
                          validation_digest, validation_revision,
                          created_by, updated_by, created_at, updated_at
                     FROM commercial_drafts
                    WHERE status != 'archived'
                    ORDER BY updated_at DESC, id"""
            ).fetchall()
        ]

    def create_draft(self, document, actor_user_id, *, base_release_id=None):
        draft_id = new_id("commercial-draft")
        encoded = canonical_json(document)
        checksum = checksum_document(document)
        self.cursor.execute(
            """INSERT INTO commercial_drafts
                   (id, schema_version, base_release_id, status, revision,
                    document_json, checksum, created_by, updated_by)
               VALUES (?, ?, ?, 'draft', 1, ?, ?, ?, ?)""",
            (
                draft_id,
                int(document.get("schemaVersion") or 1),
                base_release_id,
                encoded,
                checksum,
                actor_user_id,
                actor_user_id,
            ),
        )
        return self.get_draft(draft_id)

    def save_draft(self, draft_id, expected_revision, document, actor_user_id):
        encoded = canonical_json(document)
        checksum = checksum_document(document)
        updated = self.cursor.execute(
            """UPDATE commercial_drafts
                  SET schema_version = ?, document_json = ?, checksum = ?,
                      revision = revision + 1, status = 'draft',
                      validation_digest = NULL, validation_revision = NULL,
                      validation_json = NULL, readiness_expires_at = NULL,
                      updated_by = ?, updated_at = CURRENT_TIMESTAMP
                WHERE id = ? AND revision = ? AND status != 'archived'""",
            (
                int(document.get("schemaVersion") or 1),
                encoded,
                checksum,
                actor_user_id,
                draft_id,
                int(expected_revision),
            ),
        )
        if updated.rowcount != 1:
            current = self.get_draft(draft_id)
            raise CommercialPolicyError(
                POLICY_STALE,
                "Bản nháp đã được thay đổi ở cửa sổ khác.",
                status_code=409,
                details={
                    "expectedRevision": int(expected_revision),
                    "currentRevision": current.get("revision") if current else None,
                    "currentChecksum": current.get("checksum") if current else None,
                },
            )
        return self.get_draft(draft_id)

    def store_validation(self, draft_id, revision, result, digest, expires_at):
        updated = self.cursor.execute(
            """UPDATE commercial_drafts
                  SET status = 'validated', validation_digest = ?,
                      validation_revision = ?, validation_json = ?,
                      readiness_expires_at = ?, updated_at = CURRENT_TIMESTAMP
                WHERE id = ? AND revision = ?""",
            (
                digest,
                int(revision),
                canonical_json(result),
                int(expires_at),
                draft_id,
                int(revision),
            ),
        )
        if updated.rowcount != 1:
            raise CommercialPolicyError(
                POLICY_STALE,
                "Bản nháp đã đổi trong khi đang kiểm tra.",
                status_code=409,
            )
        return self.get_draft(draft_id)

    def get_release(self, release_id):
        row = self.cursor.execute(  # noqa: S608 - placeholders are generated from fixed policy modes
            """SELECT id, version_label, schema_version, checksum,
                      snapshot_json, mode, scope_key, effective_from,
                      non_sellable, base_release_id, published_by, reason,
                      created_at
                 FROM commercial_releases WHERE id = ?""",
            (release_id,),
            ).fetchone()  # noqa: S608 - placeholders are generated from fixed policy modes
        if not row:
            return None
        result = _dict(row)
        result["snapshot"] = json.loads(result.pop("snapshot_json"))
        return result

    def effective_release(self, at=None, *, scope_key="global", include_shadow=False):
        at = int(self.clock() if at is None else at)
        statement = """SELECT release.id, release.version_label, release.schema_version,
                       release.checksum, release.snapshot_json, release.mode,
                       release.scope_key, release.effective_from,
                       release.non_sellable, release.base_release_id,
                       release.published_by, release.reason, release.created_at
                  FROM commercial_releases AS release
                 WHERE release.scope_key = ?
                   AND release.effective_from <= ?
                   AND release.non_sellable = 0
                   AND release.mode IN ('production', 'pilot')
                   AND NOT EXISTS (
                       SELECT 1 FROM commercial_release_timeline AS timeline
                        WHERE timeline.release_id = release.id
                          AND timeline.event_type = 'stop_sales'
                          AND timeline.effective_at <= ?
                   )
                 ORDER BY release.effective_from DESC, release.created_at DESC,
                          release.id DESC
                 LIMIT 1"""
        if include_shadow:
            statement = statement.replace(
                "release.mode IN ('production', 'pilot')",
                "release.mode IN ('production', 'pilot', 'shadow')",
            )
        row = self.cursor.execute(
            statement,
            (scope_key, at, at),
        ).fetchone()
        if not row:
            return None
        result = _dict(row)
        result["snapshot"] = json.loads(result.pop("snapshot_json"))
        return result

    def next_effective_at(self, at=None, *, scope_key="global"):
        at = int(self.clock() if at is None else at)
        row = self.cursor.execute(
            """SELECT MIN(next_at) FROM (
                    SELECT effective_from AS next_at
                      FROM commercial_releases
                     WHERE scope_key = ? AND effective_from > ? AND non_sellable = 0
                    UNION ALL
                    SELECT timeline.effective_at AS next_at
                      FROM commercial_release_timeline AS timeline
                     WHERE timeline.scope_key = ?
                       AND timeline.event_type = 'stop_sales'
                       AND timeline.effective_at > ?
                ) AS future_events""",
            (scope_key, at, scope_key, at),
        ).fetchone()
        return int(row[0]) if row and row[0] is not None else None

    def publish(self, draft, actor_user_id, *, effective_at, reason):
        document = draft["document"]
        release_id = new_id("commercial-release")
        version_label = f"release-{int(self.clock())}-{draft['revision']}"
        mode = str((document.get("rollout") or {}).get("mode") or "shadow")
        self.cursor.execute(
            """INSERT INTO commercial_releases
                   (id, version_label, schema_version, checksum, snapshot_json,
                    mode, scope_key, effective_from, non_sellable,
                    base_release_id, published_by, reason)
               VALUES (?, ?, ?, ?, ?, ?, 'global', ?, 0, ?, ?, ?)""",
            (
                release_id,
                version_label,
                int(document.get("schemaVersion") or 1),
                draft["checksum"],
                canonical_json(document),
                mode,
                int(effective_at),
                draft.get("base_release_id"),
                actor_user_id,
                reason,
            ),
        )
        event_type = "published" if int(effective_at) <= int(self.clock()) else "scheduled"
        self.cursor.execute(
            """INSERT INTO commercial_release_timeline
                   (id, release_id, event_type, scope_key, effective_at,
                    scope_json, reason, actor_user_id)
               VALUES (?, ?, ?, 'global', ?, '{}', ?, ?)""",
            (
                new_id("commercial-event"),
                release_id,
                event_type,
                int(effective_at),
                reason,
                actor_user_id,
            ),
        )
        self._project_release(release_id, document, int(effective_at))
        self.cursor.execute(
            "UPDATE commercial_drafts SET status = 'archived', updated_at = CURRENT_TIMESTAMP WHERE id = ?",
            (draft["id"],),
        )
        return self.get_release(release_id)

    def _project_release(self, release_id, document, effective_at):
        for name, payload in (document.get("policies") or {}).items():
            policy_payload = payload if isinstance(payload, dict) else {"value": payload}
            encoded = canonical_json(policy_payload)
            self.cursor.execute(
                """INSERT INTO commercial_policy_versions
                       (id, release_id, policy_kind, selector, schema_version,
                        payload_json, checksum)
                   VALUES (?, ?, ?, 'default', 1, ?, ?)""",
                (
                    new_id("commercial-policy"),
                    release_id,
                    str(name),
                    encoded,
                    sha256(encoded.encode("utf-8")).hexdigest(),
                ),
            )
        plan_ids = {}
        for offer in document.get("offers") or []:
            plan_id = new_id("billing-plan")
            plan_ids[offer["code"]] = plan_id
            capabilities = offer["exportCapabilities"]
            self.cursor.execute(
                """INSERT INTO billing_plan_versions
                       (id, release_id, logical_package_code, owner_kind, tier,
                        variant, member_quota, included_procurement_quota,
                        document_export_word, document_export_excel,
                        document_export_award_result_excel,
                        violation_check_enabled, sales_state, display_json)
                   VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)""",
                (
                    plan_id,
                    release_id,
                    offer["code"],
                    offer["ownerKind"],
                    offer["tier"],
                    offer["variant"],
                    offer["memberQuota"],
                    offer["includedProcurementQuota"],
                    int(capabilities["document.export.word"]),
                    int(capabilities["document.export.excel"]),
                    int(capabilities["document.export.award_result_excel"]),
                    int(bool(offer["violationCheckEnabled"])),
                    offer["salesState"],
                    canonical_json(offer.get("display") or {}),
                ),
            )
            sku_id = new_id("billing-sku")
            self.cursor.execute(
                """INSERT INTO billing_skus
                       (id, release_id, sku_code, item_type, plan_version_id,
                        quantity, repeatable, sales_state, display_order)
                   VALUES (?, ?, ?, 'base_plan', ?, 1, 0, ?, ?)""",
                (
                    sku_id,
                    release_id,
                    offer["code"],
                    plan_id,
                    offer["salesState"],
                    len(plan_ids),
                ),
            )
            price = offer["price"]
            self.cursor.execute(
                """INSERT INTO billing_prices
                       (id, release_id, sku_id, period, currency,
                        subtotal_amount, tax_amount, total_amount,
                        effective_at)
                   VALUES (?, ?, ?, ?, 'VND', ?, ?, ?, ?)""",
                (
                    new_id("billing-price"),
                    release_id,
                    sku_id,
                    price["period"],
                    price["subtotal"],
                    price["tax"],
                    price["total"],
                    effective_at,
                ),
            )
        for order, pack in enumerate(document.get("creditPacks") or [], start=100):
            sku_id = new_id("billing-sku")
            self.cursor.execute(
                """INSERT INTO billing_skus
                       (id, release_id, sku_code, item_type, quantity,
                        repeatable, sales_state, display_order)
                   VALUES (?, ?, ?, 'procurement_credit_pack', ?, 1,
                           'sellable', ?)""",
                (sku_id, release_id, pack["code"], pack["quantity"], order),
            )
            self.cursor.execute(
                """INSERT INTO billing_prices
                       (id, release_id, sku_id, period, currency,
                        subtotal_amount, tax_amount, total_amount,
                        effective_at)
                   VALUES (?, ?, ?, 'one_time', 'VND', ?, 0, ?, ?)""",
                (
                    new_id("billing-price"),
                    release_id,
                    sku_id,
                    pack["price"],
                    pack["price"],
                    effective_at,
                ),
            )

    def clone_release(self, release_id, actor_user_id):
        release = self.get_release(release_id)
        if not release:
            return None
        return self.create_draft(
            release["snapshot"], actor_user_id, base_release_id=release_id
        )

    def stop_sales(self, release_id, actor_user_id, *, effective_at, reason, scope):
        release = self.get_release(release_id)
        if not release:
            return None
        self.cursor.execute(
            """INSERT INTO commercial_release_timeline
                   (id, release_id, event_type, scope_key, effective_at,
                    scope_json, reason, actor_user_id)
               VALUES (?, ?, 'stop_sales', ?, ?, ?, ?, ?)""",
            (
                new_id("commercial-event"),
                release_id,
                release["scope_key"],
                int(effective_at),
                canonical_json(scope or {}),
                reason,
                actor_user_id,
            ),
        )
        return release

    def insert_outbox(self, event_type, aggregate_type, aggregate_id, payload):
        outbox_id = new_id("commercial-outbox")
        self.cursor.execute(
            """INSERT INTO commercial_outbox
                   (id, event_type, aggregate_type, aggregate_id,
                    payload_json, available_at)
               VALUES (?, ?, ?, ?, ?, ?)""",
            (
                outbox_id,
                event_type,
                aggregate_type,
                aggregate_id,
                canonical_json(payload),
                int(self.clock()),
            ),
        )
        return outbox_id

    def assert_reference_not_used(self, table, identifier):
        if table not in {"billing_plan_versions", "billing_skus", "billing_prices"}:
            raise ValueError("Unsupported commercial reference table.")
        row = self.cursor.execute(
            f"SELECT 1 FROM {table} WHERE id = ? LIMIT 1", (identifier,)  # noqa: S608 - table is allowlisted above
        ).fetchone()
        if row:
            raise CommercialPolicyError(
                REFERENCE_IN_USE,
                "Tham chiếu thương mại bất biến đang được sử dụng.",
                status_code=409,
            )
