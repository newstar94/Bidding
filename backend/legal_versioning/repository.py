"""PostgreSQL persistence for immutable legal catalog and typed bindings."""

from __future__ import annotations

import json

from backend.db.id_utils import generate_record_id


def _id(prefix):
    return f"{prefix}{generate_record_id('')}"


class LegalVersioningRepository:
    def __init__(self, cursor):
        self.cursor = cursor

    def create_instrument_draft(self, values):
        instrument_id = _id("lin-")
        draft_id = _id("lid-")
        self.cursor.execute(
            """INSERT INTO legal_instrument
                 (id, stable_code, title, document_type, document_number,
                  created_by_id)
               VALUES (?, ?, ?, ?, ?, ?)""",
            (
                instrument_id, values["stable_code"], values["title"],
                values["document_type"], values["document_number"],
                values["actor_user_id"],
            ),
        )
        self.cursor.execute(
            """INSERT INTO legal_instrument_draft
                 (id, instrument_id, source_uri, source_content, issued_date,
                  effective_from, effective_to, relation_manifest_json,
                  updated_by_id)
               VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)""",
            (
                draft_id, instrument_id, values["source_uri"],
                values["source_content"], values["issued_date"],
                values["effective_from"], values["effective_to"],
                values["relation_manifest_json"], values["actor_user_id"],
            ),
        )
        return self.get_instrument_draft(draft_id)

    def get_instrument_draft(self, draft_id, *, lock=False):
        suffix = " FOR UPDATE" if lock else ""
        row = self.cursor.execute(
            f"""SELECT draft.id, draft.instrument_id, draft.draft_revision,
                       instrument.stable_code, instrument.title,
                       instrument.document_type, instrument.document_number,
                       draft.source_uri, draft.source_content, draft.issued_date,
                       draft.effective_from, draft.effective_to,
                       draft.relation_manifest_json
                  FROM legal_instrument_draft AS draft
                  JOIN legal_instrument AS instrument ON instrument.id = draft.instrument_id
                 WHERE draft.id = ?{suffix}""",  # noqa: S608 - fixed query suffix.
            (draft_id,),
        ).fetchone()
        if not row:
            return None
        return {
            "id": row[0], "instrumentId": row[1], "draftRevision": int(row[2]),
            "stableCode": row[3], "title": row[4], "documentType": row[5],
            "documentNumber": row[6], "sourceUri": row[7],
            "sourceContent": row[8], "issuedDate": row[9],
            "effectiveFrom": row[10], "effectiveTo": row[11],
            "relations": json.loads(row[12]),
        }

    def publish_instrument_draft(
        self, *, draft_id, expected_revision, content_sha256,
        relation_manifest_json, relation_manifest_hash, actor_user_id,
    ):
        draft = self.get_instrument_draft(draft_id, lock=True)
        if draft is None:
            return None, "NOT_FOUND"
        if draft["draftRevision"] != expected_revision:
            return draft, "STALE"
        next_version = int(self.cursor.execute(
            """SELECT COALESCE(MAX(version_no), 0) + 1
                 FROM legal_instrument_version WHERE instrument_id = ?""",
            (draft["instrumentId"],),
        ).fetchone()[0])
        version_id = _id("liv-")
        self.cursor.execute(
            """INSERT INTO legal_instrument_version
                 (id, instrument_id, version_no, source_uri, source_content,
                  content_sha256, issued_date, effective_from, effective_to,
                  relation_manifest_json, relation_manifest_hash, published_by_id)
               SELECT ?, instrument_id, ?, source_uri, source_content, ?,
                      issued_date, effective_from, effective_to, ?, ?, ?
                 FROM legal_instrument_draft WHERE id = ?""",
            (
                version_id, next_version, content_sha256,
                relation_manifest_json, relation_manifest_hash,
                actor_user_id, draft_id,
            ),
        )
        self.cursor.execute("DELETE FROM legal_instrument_draft WHERE id = ?", (draft_id,))
        self.cursor.execute(
            """UPDATE legal_instrument SET row_version = row_version + 1,
                      updated_at = CURRENT_TIMESTAMP WHERE id = ?""",
            (draft["instrumentId"],),
        )
        return self.get_instrument_version(version_id), None

    def get_instrument_version(self, version_id):
        row = self.cursor.execute(
            """SELECT version.id, version.instrument_id, version.version_no,
                      instrument.stable_code, instrument.title,
                      instrument.document_type, instrument.document_number,
                      version.source_uri, version.source_content,
                      version.content_sha256, version.issued_date,
                      version.effective_from, version.effective_to,
                      version.relation_manifest_json,
                      version.relation_manifest_hash, version.published_by_id,
                      version.published_at
                 FROM legal_instrument_version AS version
                 JOIN legal_instrument AS instrument ON instrument.id = version.instrument_id
                WHERE version.id = ?""",
            (version_id,),
        ).fetchone()
        if not row:
            return None
        return {
            "id": row[0], "instrumentId": row[1], "versionNo": int(row[2]),
            "stableCode": row[3], "title": row[4], "documentType": row[5],
            "documentNumber": row[6], "sourceUri": row[7],
            "sourceContent": row[8], "contentSha256": row[9],
            "issuedDate": row[10], "effectiveFrom": row[11],
            "effectiveTo": row[12], "relations": json.loads(row[13]),
            "relationManifestHash": row[14], "publishedById": row[15],
            "publishedAt": row[16],
        }

    def create_profile_draft(self, values):
        profile_id = _id("lsp-")
        draft_id = _id("lpd-")
        self.cursor.execute(
            """INSERT INTO legal_source_profile
                 (id, stable_code, display_name, created_by_id)
               VALUES (?, ?, ?, ?)""",
            (profile_id, values["stable_code"], values["display_name"], values["actor_user_id"]),
        )
        self.cursor.execute(
            """INSERT INTO legal_source_profile_draft
                 (id, profile_id, effective_from, effective_to, priority,
                  manual_review_required, instrument_version_ids_json, updated_by_id)
               VALUES (?, ?, ?, ?, ?, ?, ?, ?)""",
            (
                draft_id, profile_id, values["effective_from"], values["effective_to"],
                values["priority"], int(values["manual_review_required"]),
                values["instrument_version_ids_json"], values["actor_user_id"],
            ),
        )
        return self.get_profile_draft(draft_id)

    def get_profile_draft(self, draft_id, *, lock=False):
        suffix = " FOR UPDATE" if lock else ""
        row = self.cursor.execute(
            f"""SELECT draft.id, draft.profile_id, draft.draft_revision,
                       profile.stable_code, profile.display_name,
                       draft.effective_from, draft.effective_to, draft.priority,
                       draft.manual_review_required,
                       draft.instrument_version_ids_json
                  FROM legal_source_profile_draft AS draft
                  JOIN legal_source_profile AS profile ON profile.id = draft.profile_id
                 WHERE draft.id = ?{suffix}""",  # noqa: S608 - fixed query suffix.
            (draft_id,),
        ).fetchone()
        if not row:
            return None
        return {
            "id": row[0], "profileId": row[1], "draftRevision": int(row[2]),
            "stableCode": row[3], "displayName": row[4],
            "effectiveFrom": row[5], "effectiveTo": row[6],
            "priority": int(row[7]), "manualReviewRequired": bool(row[8]),
            "instrumentVersionIds": json.loads(row[9]),
        }

    def publish_profile_draft(self, *, draft_id, expected_revision, manifest_hash, actor_user_id):
        draft = self.get_profile_draft(draft_id, lock=True)
        if draft is None:
            return None, "NOT_FOUND"
        if draft["draftRevision"] != expected_revision:
            return draft, "STALE"
        ids = draft["instrumentVersionIds"]
        if ids:
            rows = self.cursor.execute(
                "SELECT id FROM legal_instrument_version WHERE id = ANY(?)",
                (ids,),
            ).fetchall()
            if {row[0] for row in rows} != set(ids):
                return draft, "SOURCE_NOT_FOUND"
        next_version = int(self.cursor.execute(
            """SELECT COALESCE(MAX(version_no), 0) + 1
                 FROM legal_source_profile_version WHERE profile_id = ?""",
            (draft["profileId"],),
        ).fetchone()[0])
        version_id = _id("lpv-")
        self.cursor.execute(
            """INSERT INTO legal_source_profile_version
                 (id, profile_id, version_no, effective_from, effective_to,
                  priority, manual_review_required, manifest_hash, published_by_id)
               SELECT ?, profile_id, ?, effective_from, effective_to, priority,
                      manual_review_required, ?, ?
                 FROM legal_source_profile_draft WHERE id = ?""",
            (version_id, next_version, manifest_hash, actor_user_id, draft_id),
        )
        for order, source_id in enumerate(ids):
            self.cursor.execute(
                """INSERT INTO legal_source_profile_member
                     (id, profile_version_id, instrument_version_id, sort_order)
                   VALUES (?, ?, ?, ?)""",
                (_id("lpm-"), version_id, source_id, order),
            )
        self.cursor.execute("DELETE FROM legal_source_profile_draft WHERE id = ?", (draft_id,))
        self.cursor.execute(
            """UPDATE legal_source_profile SET row_version = row_version + 1,
                      updated_at = CURRENT_TIMESTAMP WHERE id = ?""",
            (draft["profileId"],),
        )
        return self.get_profile_version(version_id), None

    def get_profile_version(self, version_id):
        row = self.cursor.execute(
            """SELECT version.id, version.profile_id, version.version_no,
                      profile.stable_code, profile.display_name,
                      version.effective_from, version.effective_to,
                      version.priority, version.manual_review_required,
                      version.manifest_hash, version.published_by_id,
                      version.published_at
                 FROM legal_source_profile_version AS version
                 JOIN legal_source_profile AS profile ON profile.id = version.profile_id
                WHERE version.id = ?""",
            (version_id,),
        ).fetchone()
        if not row:
            return None
        members = self.cursor.execute(
            """SELECT instrument_version_id FROM legal_source_profile_member
                WHERE profile_version_id = ? ORDER BY sort_order""",
            (version_id,),
        ).fetchall()
        return {
            "id": row[0], "profileId": row[1], "versionNo": int(row[2]),
            "stableCode": row[3], "displayName": row[4],
            "effectiveFrom": row[5], "effectiveTo": row[6],
            "priority": int(row[7]), "manualReviewRequired": bool(row[8]),
            "manifestHash": row[9], "publishedById": row[10],
            "publishedAt": row[11],
            "instrumentVersionIds": [item[0] for item in members],
        }

    def list_profile_versions(self):
        rows = self.cursor.execute(
            "SELECT id FROM legal_source_profile_version ORDER BY effective_from, priority DESC, id"
        ).fetchall()
        return [self.get_profile_version(row[0]) for row in rows]

    def get_profile_sources(self, profile_version_id):
        profile = self.get_profile_version(profile_version_id)
        if profile is None:
            return None
        return {
            "profile": profile,
            "sources": [
                self.get_instrument_version(version_id)
                for version_id in profile["instrumentVersionIds"]
            ],
        }

    def ensure_policy_version(self, *, policy_code, version, config_json, config_hash, actor_user_id):
        row = self.cursor.execute(
            """SELECT id FROM legal_applicability_policy_version
                WHERE policy_code = ? AND version = ?""",
            (policy_code, version),
        ).fetchone()
        if row:
            return row[0]
        policy_id = _id("lap-")
        self.cursor.execute(
            """INSERT INTO legal_applicability_policy_version
                 (id, policy_code, version, config_json, config_hash, published_by_id)
               VALUES (?, ?, ?, ?, ?, ?)""",
            (policy_id, policy_code, version, config_json, config_hash, actor_user_id),
        )
        return policy_id

    def get_target(self, organization_id, target_type, target_id, *, lock=False):
        table = "ke_hoach_lcnt" if target_type == "plan" else "goi_thau"
        suffix = " FOR UPDATE" if lock else ""
        row = self.cursor.execute(
            f"SELECT * FROM {table} WHERE organization_id = ? AND id = ?{suffix}",  # noqa: S608 - allowlisted table/suffix.
            (organization_id, target_id),
        ).fetchone()
        return dict(row) if row else None

    def bind_target_cas(
        self, *, organization_id, target_type, target_id, expected_revision,
        target_row_version, policy_version_id, resolution, actor_user_id,
        evidence_json, evidence_hash, anchor_source,
    ):
        prefix = "plan" if target_type == "plan" else "package"
        target_column = "plan_id" if target_type == "plan" else "package_id"
        head_table = f"{prefix}_legal_binding_head"
        history_table = f"{prefix}_legal_binding"
        head = self.cursor.execute(
            f"""SELECT id, binding_revision FROM {head_table}
                 WHERE organization_id = ? AND {target_column} = ? FOR UPDATE""",  # noqa: S608 - allowlisted identifiers.
            (organization_id, target_id),
        ).fetchone()
        current_revision = int(head[1]) if head else 0
        if current_revision != expected_revision:
            return {"bindingRevision": current_revision}, "STALE"
        binding_id = _id("plb-" if target_type == "plan" else "pkb-")
        next_revision = current_revision + 1
        self.cursor.execute(
            f"""INSERT INTO {history_table}
                 (organization_id, id, {target_column}, binding_revision,
                  target_row_version, policy_version_id, profile_version_id,
                  status, reason, anchor_date, anchor_source, evidence_json,
                  evidence_hash, created_by_id)
               VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)""",  # noqa: S608 - allowlisted identifiers.
            (
                organization_id, binding_id, target_id, next_revision,
                target_row_version, policy_version_id,
                resolution.get("profileVersionId"), resolution["status"],
                resolution["reason"], resolution.get("anchorDate"),
                anchor_source, evidence_json, evidence_hash, actor_user_id,
            ),
        )
        if head:
            self.cursor.execute(
                f"""UPDATE {head_table} SET current_binding_id = ?,
                           binding_revision = ?, updated_at = CURRENT_TIMESTAMP
                     WHERE organization_id = ? AND {target_column} = ?""",  # noqa: S608
                (binding_id, next_revision, organization_id, target_id),
            )
        else:
            self.cursor.execute(
                f"""INSERT INTO {head_table}
                     (organization_id, id, {target_column}, current_binding_id,
                      binding_revision) VALUES (?, ?, ?, ?, ?)""",  # noqa: S608
                (organization_id, _id("lbh-"), target_id, binding_id, next_revision),
            )
        return self.get_binding(organization_id, target_type, target_id), None

    def get_binding(self, organization_id, target_type, target_id):
        prefix = "plan" if target_type == "plan" else "package"
        target_column = "plan_id" if target_type == "plan" else "package_id"
        row = self.cursor.execute(
            f"""SELECT binding.id, binding.binding_revision,
                       binding.target_row_version, binding.policy_version_id,
                       binding.profile_version_id, binding.status, binding.reason,
                       binding.anchor_date, binding.anchor_source,
                       binding.evidence_json, binding.evidence_hash,
                       binding.created_by_id, binding.created_at
                  FROM {prefix}_legal_binding_head AS head
                  JOIN {prefix}_legal_binding AS binding
                    ON binding.organization_id = head.organization_id
                   AND binding.id = head.current_binding_id
                 WHERE head.organization_id = ? AND head.{target_column} = ?""",  # noqa: S608
            (organization_id, target_id),
        ).fetchone()
        if not row:
            return None
        return {
            "id": row[0], "bindingRevision": int(row[1]),
            "targetRowVersion": int(row[2]), "policyVersionId": row[3],
            "profileVersionId": row[4], "status": row[5], "reason": row[6],
            "anchorDate": row[7], "anchorSource": row[8],
            "evidence": json.loads(row[9]), "evidenceHash": row[10],
            "createdById": row[11], "createdAt": row[12],
        }
