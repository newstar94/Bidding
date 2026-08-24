"""PostgreSQL persistence adapter for shared ProcurementCase."""

from __future__ import annotations

import json

from backend.db.id_utils import generate_record_id
from backend.shared.idempotency import acquire_idempotency_lock


def _id(prefix):
    return f"{prefix}{generate_record_id('')}"


class ProcurementCaseRepository:
    def __init__(self, cursor):
        self.cursor = cursor

    def package(self, organization_id, package_id, *, lock=False):
        suffix = " FOR UPDATE" if lock else ""
        row = self.cursor.execute(
            f"""SELECT id, COALESCE(id_goc, id), row_version, phien_ban,
                       ten_goi_thau, archived_at
                  FROM goi_thau WHERE organization_id = ? AND id = ?{suffix}""",  # noqa: S608
            (organization_id, package_id),
        ).fetchone()
        if not row or row[5] is not None:
            return None
        return {
            "id": row[0], "rootId": row[1], "rowVersion": int(row[2]),
            "version": int(row[3]), "name": row[4],
        }

    def create_case(self, values):
        case_id = _id("case-")
        target_id = _id("cpt-")
        self.cursor.execute(
            """INSERT INTO procurement_case
                 (organization_id, id, case_no, case_type, direction, category,
                  other_description, subject, state, policy_version, due_at,
                  due_provenance, deadline_status, created_by_id)
               VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)""",
            (
                values["organization_id"], case_id, values["case_no"],
                values["case_type"], values["direction"], values["category"],
                values["other_description"], values["subject"], values["state"],
                values["policy_version"], values["due_at"],
                "MANUAL" if values["due_at"] else None,
                "NOT_EVALUATED", values["actor_user_id"],
            ),
        )
        self.cursor.execute(
            """INSERT INTO procurement_case_package_target
                 (organization_id, id, case_id, package_lineage_root_id,
                  current_package_version_id)
               VALUES (?, ?, ?, ?, ?)""",
            (
                values["organization_id"], target_id, case_id,
                values["package_root_id"], values["package_version_id"],
            ),
        )
        self.append_transition(
            values["organization_id"], case_id, None, values["state"],
            "CREATE", values["package_version_id"], None,
            values["actor_user_id"], None,
        )
        return self.get_case(values["organization_id"], case_id)

    def get_case(self, organization_id, case_id, *, lock=False):
        suffix = " FOR UPDATE OF case_row" if lock else ""
        row = self.cursor.execute(
            f"""SELECT case_row.id, case_row.case_no, case_row.case_type,
                       case_row.direction, case_row.category,
                       case_row.other_description, case_row.subject,
                       case_row.state, case_row.policy_version,
                       case_row.row_version, case_row.due_at,
                       case_row.due_provenance, case_row.deadline_status,
                       case_row.created_by_id, case_row.created_at,
                       case_row.updated_at, target.package_lineage_root_id,
                       COALESCE(latest_package.id, target.current_package_version_id)
                  FROM procurement_case AS case_row
                  JOIN procurement_case_package_target AS target
                    ON target.organization_id = case_row.organization_id
                   AND target.case_id = case_row.id
             LEFT JOIN LATERAL (
                       SELECT candidate.id
                         FROM goi_thau AS candidate
                        WHERE candidate.organization_id = target.organization_id
                          AND COALESCE(candidate.id_goc, candidate.id) = target.package_lineage_root_id
                          AND candidate.is_latest = 1
                          AND candidate.archived_at IS NULL
                        ORDER BY CAST(candidate.phien_ban AS INTEGER) DESC, candidate.id
                        LIMIT 1
                  ) AS latest_package ON TRUE
                 WHERE case_row.organization_id = ? AND case_row.id = ?{suffix}""",  # noqa: S608
            (organization_id, case_id),
        ).fetchone()
        if not row:
            return None
        return {
            "id": row[0], "caseNo": row[1], "caseType": row[2],
            "direction": row[3], "category": row[4],
            "otherDescription": row[5], "subject": row[6], "state": row[7],
            "policyVersion": row[8], "rowVersion": int(row[9]),
            "dueAt": row[10], "dueProvenance": row[11],
            "deadlineStatus": row[12], "createdById": row[13],
            "createdAt": row[14], "updatedAt": row[15],
            "packageRootId": row[16], "currentPackageVersionId": row[17],
        }

    def hydrate(self, case):
        result = dict(case)
        organization_id = result.pop("organizationId", None)
        if organization_id is None:
            organization_id = self._organization_id(case["id"])
        case_id = case["id"]
        result["organizationId"] = organization_id
        result["responses"] = self.response_revisions(organization_id, case_id)
        result["transitions"] = self.transitions(organization_id, case_id)
        result["responsibilities"] = self._responsibilities(organization_id, case_id)
        result["parties"] = self._parties(organization_id, case_id)
        result["legalBases"] = self._legal_bases(organization_id, case_id)
        result["attachments"] = self._attachments(organization_id, case_id)
        result["sourceObservations"] = self.source_observations(
            organization_id, case_id
        )
        return result

    def _organization_id(self, case_id):
        row = self.cursor.execute(
            "SELECT organization_id FROM procurement_case WHERE id = ? LIMIT 1",
            (case_id,),
        ).fetchone()
        return row[0] if row else None

    def activity_scope(self, organization_id, case_id):
        row = self.cursor.execute(
            """SELECT package_row.owner_type
                 FROM procurement_case_package_target AS target
                 JOIN goi_thau AS package_row
                   ON package_row.organization_id = target.organization_id
                  AND package_row.id = target.current_package_version_id
                WHERE target.organization_id = ? AND target.case_id = ?""",
            (organization_id, case_id),
        ).fetchone()
        return str(row[0] or "organization") if row else "organization"

    def list_cases(self, organization_id, predicate, parameters, *, case_type=None, state=None, limit=100):
        filters = [predicate]
        values = list(parameters)
        if case_type:
            filters.append("case_row.case_type = ?")
            values.append(case_type)
        if state:
            filters.append("case_row.state = ?")
            values.append(state)
        values.extend((organization_id, int(limit)))
        rows = self.cursor.execute(
            f"""SELECT case_row.id, case_row.case_no, case_row.case_type,
                       case_row.direction, case_row.category,
                       case_row.other_description, case_row.subject,
                       case_row.state, case_row.policy_version,
                       case_row.row_version, case_row.due_at,
                       case_row.due_provenance, case_row.deadline_status,
                       case_row.created_by_id, case_row.created_at,
                       case_row.updated_at, target.package_lineage_root_id,
                       target.current_package_version_id, package_row.ten_goi_thau
                  FROM procurement_case AS case_row
                  JOIN procurement_case_package_target AS target
                    ON target.organization_id = case_row.organization_id
                   AND target.case_id = case_row.id
                  JOIN goi_thau AS package_row
                    ON package_row.organization_id = target.organization_id
                   AND package_row.id = COALESCE((
                       SELECT candidate.id FROM goi_thau AS candidate
                        WHERE candidate.organization_id = target.organization_id
                          AND COALESCE(candidate.id_goc, candidate.id) = target.package_lineage_root_id
                          AND candidate.is_latest = 1
                          AND candidate.archived_at IS NULL
                        ORDER BY CAST(candidate.phien_ban AS INTEGER) DESC, candidate.id
                        LIMIT 1
                   ), target.current_package_version_id)
                 WHERE {' AND '.join(filters)}
                   AND case_row.organization_id = ?
                 ORDER BY case_row.updated_at DESC, case_row.id LIMIT ?""",  # noqa: S608 - predicate is canonical; filters closed.
            tuple(values),
        ).fetchall()
        return [{
            "id": row[0], "caseNo": row[1], "caseType": row[2],
            "direction": row[3], "category": row[4],
            "otherDescription": row[5], "subject": row[6], "state": row[7],
            "policyVersion": row[8], "rowVersion": int(row[9]),
            "dueAt": row[10], "dueProvenance": row[11],
            "deadlineStatus": row[12], "createdById": row[13],
            "createdAt": row[14], "updatedAt": row[15],
            "packageRootId": row[16], "currentPackageVersionId": row[17],
            "packageName": row[18],
        } for row in rows]

    def acquire_command_lock(self, organization_id, actor_user_id, key):
        acquire_idempotency_lock(
            self.cursor, "procurement_case", organization_id, actor_user_id, key
        )

    def latest_response(self, organization_id, case_id):
        rows = self.response_revisions(organization_id, case_id, limit=1)
        return rows[0] if rows else None

    def response_revisions(self, organization_id, case_id, *, limit=200):
        rows = self.cursor.execute(
            """SELECT id, revision_no, package_version_id, content,
                      content_sha256, created_by_id, created_at
                 FROM procurement_case_response_revision
                WHERE organization_id = ? AND case_id = ?
                ORDER BY revision_no DESC LIMIT ?""",
            (organization_id, case_id, int(limit)),
        ).fetchall()
        return [{
            "id": row[0], "revisionNo": int(row[1]),
            "packageVersionId": row[2], "content": row[3],
            "contentSha256": row[4], "createdById": row[5],
            "createdAt": row[6],
        } for row in rows]

    def append_response(self, organization_id, case_id, package_version_id, content, content_hash, actor_user_id):
        revision = int(self.cursor.execute(
            """SELECT COALESCE(MAX(revision_no), 0) + 1
                 FROM procurement_case_response_revision
                WHERE organization_id = ? AND case_id = ?""",
            (organization_id, case_id),
        ).fetchone()[0])
        response_id = _id("crr-")
        self.cursor.execute(
            """INSERT INTO procurement_case_response_revision
                 (organization_id, id, case_id, revision_no, package_version_id,
                  content, content_sha256, created_by_id)
               VALUES (?, ?, ?, ?, ?, ?, ?, ?)""",
            (
                organization_id, response_id, case_id, revision,
                package_version_id, content, content_hash, actor_user_id,
            ),
        )
        return self.latest_response(organization_id, case_id)

    def update_case_cas(self, organization_id, case_id, expected_revision, values):
        assignments = [f"{key} = ?" for key in values]
        parameters = [*values.values(), organization_id, case_id, expected_revision]
        value_clause = (", ".join(assignments) + ",") if assignments else ""
        result = self.cursor.execute(
            f"""UPDATE procurement_case SET {value_clause}
                       row_version = row_version + 1,
                       updated_at = CURRENT_TIMESTAMP
                  WHERE organization_id = ? AND id = ? AND row_version = ?""",  # noqa: S608 - columns are service-owned constants.
            tuple(parameters),
        )
        return int(result.rowcount or 0) == 1

    def append_transition(self, organization_id, case_id, from_state, to_state, action, package_version_id, response_revision_id, actor_user_id, reason):
        sequence = int(self.cursor.execute(
            """SELECT COALESCE(MAX(sequence_no), 0) + 1
                 FROM procurement_case_transition
                WHERE organization_id = ? AND case_id = ?""",
            (organization_id, case_id),
        ).fetchone()[0])
        self.cursor.execute(
            """INSERT INTO procurement_case_transition
                 (organization_id, id, case_id, sequence_no, from_state,
                  to_state, action, package_version_id, response_revision_id,
                  reason, actor_user_id)
               VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)""",
            (
                organization_id, _id("ctr-"), case_id, sequence, from_state,
                to_state, action, package_version_id, response_revision_id,
                reason, actor_user_id,
            ),
        )

    def transitions(self, organization_id, case_id):
        rows = self.cursor.execute(
            """SELECT id, sequence_no, from_state, to_state, action,
                      package_version_id, response_revision_id, reason,
                      actor_user_id, created_at
                 FROM procurement_case_transition
                WHERE organization_id = ? AND case_id = ?
                ORDER BY sequence_no""",
            (organization_id, case_id),
        ).fetchall()
        return [{
            "id": row[0], "sequenceNo": int(row[1]), "fromState": row[2],
            "toState": row[3], "action": row[4], "packageVersionId": row[5],
            "responseRevisionId": row[6], "reason": row[7],
            "actorUserId": row[8], "createdAt": row[9],
        } for row in rows]

    def command_result(self, organization_id, actor_user_id, key):
        row = self.cursor.execute(
            """SELECT command_name, request_hash, result_json
                 FROM procurement_case_command
                WHERE organization_id = ? AND actor_user_id = ?
                  AND idempotency_key = ?""",
            (organization_id, actor_user_id, key),
        ).fetchone()
        return ({"commandName": row[0], "requestHash": row[1], "result": json.loads(row[2])} if row else None)

    def record_command(self, organization_id, case_id, actor_user_id, key, name, request_hash, result):
        self.cursor.execute(
            """INSERT INTO procurement_case_command
                 (organization_id, id, case_id, actor_user_id, idempotency_key,
                  command_name, request_hash, result_json)
               VALUES (?, ?, ?, ?, ?, ?, ?, ?)""",
            (
                organization_id, _id("cmd-"), case_id, actor_user_id, key,
                name, request_hash,
                json.dumps(result, ensure_ascii=False, sort_keys=True, separators=(",", ":"), default=str),
            ),
        )

    def add_responsibility(self, organization_id, case_id, responsible_user_id, responsible_unit, actor_user_id):
        self.cursor.execute(
            """INSERT INTO procurement_case_responsibility
                 (organization_id, id, case_id, responsible_user_id,
                  responsible_unit, assigned_by_id)
               VALUES (?, ?, ?, ?, ?, ?)""",
            (organization_id, _id("cpr-"), case_id, responsible_user_id, responsible_unit, actor_user_id),
        )

    def add_party(self, organization_id, case_id, role, display_name, contact):
        party_id = _id("cpy-")
        self.cursor.execute(
            """INSERT INTO procurement_case_party
                 (organization_id, id, case_id, party_role, display_name, contact_json)
               VALUES (?, ?, ?, ?, ?, ?)""",
            (organization_id, party_id, case_id, role, display_name,
             json.dumps(contact, ensure_ascii=False, sort_keys=True,
                        separators=(",", ":"))),
        )
        return party_id

    def legal_references(self, profile_version_id, instrument_version_id):
        profile = self.cursor.execute(
            "SELECT id FROM legal_source_profile_version WHERE id = ?",
            (profile_version_id,),
        ).fetchone() if profile_version_id else None
        instrument = self.cursor.execute(
            "SELECT id FROM legal_instrument_version WHERE id = ?",
            (instrument_version_id,),
        ).fetchone() if instrument_version_id else None
        member = None
        if profile and instrument:
            member = self.cursor.execute(
                """SELECT 1 FROM legal_source_profile_member
                    WHERE profile_version_id = ? AND instrument_version_id = ?""",
                (profile_version_id, instrument_version_id),
            ).fetchone()
        return bool(profile), bool(instrument), bool(member)

    def add_legal_basis(self, organization_id, case_id, response_revision_id,
                        profile_version_id, instrument_version_id, note,
                        verification_status, actor_user_id):
        basis_id = _id("clb-")
        self.cursor.execute(
            """INSERT INTO procurement_case_legal_basis
                 (organization_id, id, case_id, response_revision_id,
                  profile_version_id, instrument_version_id, note,
                  verification_status, created_by_id)
               VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)""",
            (organization_id, basis_id, case_id, response_revision_id,
             profile_version_id, instrument_version_id, note,
             verification_status, actor_user_id),
        )
        return basis_id

    def add_source_observation(self, organization_id, case_id, case_type,
                               provider, upstream_identity, upstream_revision,
                               source_sha256, canonical):
        existing = self.cursor.execute(
            """SELECT id, source_sha256, canonical_json, linked_case_id
                 FROM procurement_case_source_observation
                WHERE organization_id = ? AND provider = ?
                  AND upstream_identity = ? AND upstream_revision = ?""",
            (organization_id, provider, upstream_identity, upstream_revision),
        ).fetchone()
        canonical_json = json.dumps(
            canonical, ensure_ascii=False, sort_keys=True, separators=(",", ":")
        )
        if existing:
            return {
                "id": existing[0], "sourceSha256": existing[1],
                "canonical": json.loads(existing[2]), "linkedCaseId": existing[3],
                "replayed": True,
            }
        observation_id = _id("cso-")
        self.cursor.execute(
            """INSERT INTO procurement_case_source_observation
                 (organization_id, id, case_type, provider, upstream_identity,
                  upstream_revision, source_sha256, canonical_json, linked_case_id)
               VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)""",
            (organization_id, observation_id, case_type, provider,
             upstream_identity, upstream_revision, source_sha256,
             canonical_json, case_id),
        )
        return {
            "id": observation_id, "sourceSha256": source_sha256,
            "canonical": canonical, "linkedCaseId": case_id, "replayed": False,
        }

    def add_attachment(self, organization_id, case_id, response_revision_id,
                       filename, storage_key, media_type, byte_size, sha256,
                       actor_user_id):
        attachment_id = _id("cat-")
        self.cursor.execute(
            """INSERT INTO procurement_case_attachment
                 (organization_id, id, case_id, response_revision_id, filename,
                  storage_key, media_type, byte_size, sha256, created_by_id)
               VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)""",
            (organization_id, attachment_id, case_id, response_revision_id,
             filename, storage_key, media_type, byte_size, sha256, actor_user_id),
        )
        return attachment_id

    def attachment(self, organization_id, case_id, attachment_id):
        row = self.cursor.execute(
            """SELECT id, filename, storage_key, media_type, byte_size, sha256
                 FROM procurement_case_attachment
                WHERE organization_id = ? AND case_id = ? AND id = ?""",
            (organization_id, case_id, attachment_id),
        ).fetchone()
        return ({"id": row[0], "filename": row[1], "storageKey": row[2],
                 "mediaType": row[3], "byteSize": int(row[4]),
                 "sha256": row[5]} if row else None)

    def source_observations(self, organization_id, case_id):
        rows = self.cursor.execute(
            """SELECT id, case_type, provider, upstream_identity,
                      upstream_revision, source_sha256, canonical_json, observed_at
                 FROM procurement_case_source_observation
                WHERE organization_id = ? AND linked_case_id = ?
                ORDER BY observed_at, id""",
            (organization_id, case_id),
        ).fetchall()
        return [{
            "id": row[0], "caseType": row[1], "provider": row[2],
            "upstreamIdentity": row[3], "upstreamRevision": row[4],
            "sourceSha256": row[5], "canonical": json.loads(row[6]),
            "observedAt": row[7],
        } for row in rows]

    def legacy_entries(self, organization_id, predicate, parameters, *, limit=100):
        rows = self.cursor.execute(
            f"""SELECT legacy.id, legacy.goi_thau_id, legacy.loai,
                       legacy.thoi_gian, legacy.noi_dung, legacy.sort_order,
                       legacy.updated_at, package_row.ten_goi_thau,
                       COALESCE(package_row.id_goc, package_row.id)
                  FROM goi_thau_lam_ro AS legacy
                  JOIN goi_thau AS package_row
                    ON package_row.organization_id = legacy.organization_id
                   AND package_row.id = legacy.goi_thau_id
                 WHERE {predicate} AND legacy.organization_id = ?
                 ORDER BY legacy.updated_at DESC, legacy.id LIMIT ?""",  # noqa: S608
            (*parameters, organization_id, int(limit)),
        ).fetchall()
        return [{
            "id": row[0], "packageVersionId": row[1], "kind": row[2],
            "occurredAt": row[3], "content": row[4], "sortOrder": row[5],
            "updatedAt": row[6], "packageName": row[7],
            "packageRootId": row[8], "status": "LEGACY_UNLINKED",
            "readOnly": True,
        } for row in rows]

    def _responsibilities(self, organization_id, case_id):
        rows = self.cursor.execute(
            """SELECT id, responsible_user_id, responsible_unit,
                      assigned_by_id, assigned_at
                 FROM procurement_case_responsibility
                WHERE organization_id = ? AND case_id = ? ORDER BY assigned_at""",
            (organization_id, case_id),
        ).fetchall()
        return [{"id": r[0], "responsibleUserId": r[1], "responsibleUnit": r[2], "assignedById": r[3], "assignedAt": r[4]} for r in rows]

    def _parties(self, organization_id, case_id):
        rows = self.cursor.execute(
            "SELECT id, party_role, display_name, contact_json, created_at FROM procurement_case_party WHERE organization_id = ? AND case_id = ? ORDER BY created_at",
            (organization_id, case_id),
        ).fetchall()
        return [{"id": r[0], "role": r[1], "displayName": r[2], "contact": json.loads(r[3]), "createdAt": r[4]} for r in rows]

    def _legal_bases(self, organization_id, case_id):
        rows = self.cursor.execute(
            "SELECT id, response_revision_id, profile_version_id, instrument_version_id, note, verification_status, created_at FROM procurement_case_legal_basis WHERE organization_id = ? AND case_id = ? ORDER BY created_at",
            (organization_id, case_id),
        ).fetchall()
        return [{"id": r[0], "responseRevisionId": r[1], "profileVersionId": r[2], "instrumentVersionId": r[3], "note": r[4], "verificationStatus": r[5], "createdAt": r[6]} for r in rows]

    def _attachments(self, organization_id, case_id):
        rows = self.cursor.execute(
            "SELECT id, response_revision_id, filename, media_type, byte_size, sha256, created_at FROM procurement_case_attachment WHERE organization_id = ? AND case_id = ? ORDER BY created_at",
            (organization_id, case_id),
        ).fetchall()
        return [{"id": r[0], "responseRevisionId": r[1], "filename": r[2], "mediaType": r[3], "byteSize": int(r[4]), "sha256": r[5], "createdAt": r[6]} for r in rows]
