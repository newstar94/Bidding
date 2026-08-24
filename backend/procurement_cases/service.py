"""Transactional command module for shared procurement cases."""

from __future__ import annotations

import hashlib
import json

from backend.shared.logging_utils import log_audit
from backend.sync.websocket import enqueue_websocket_event
from backend.activity.service import ActivityEvent, insert_activity_events
from backend.notifications.service import queue_user_notification
from backend.shared.date_utils import vietnam_now_sql

from .policy import CasePolicy, CasePolicyError


class ProcurementCaseError(ValueError):
    code = "PROCUREMENT_CASE_INVALID"
    status_code = 400

    def __init__(self, code=None, *, fields=None, current=None):
        super().__init__(code or self.code)
        self.code = code or self.code
        self.fields = fields or {}
        self.current = current


class ProcurementCaseNotFound(ProcurementCaseError):
    code = "PROCUREMENT_CASE_NOT_FOUND"
    status_code = 404


class ProcurementCaseConflict(ProcurementCaseError):
    code = "PROCUREMENT_CASE_CONFLICT"
    status_code = 409


def _text(value, field, maximum, *, required=True):
    result = str(value or "").strip()
    if (required and not result) or len(result) > maximum:
        raise ProcurementCaseError(fields={field: "INVALID_VALUE"})
    return result


def _hash(value):
    return hashlib.sha256(value.encode("utf-8")).hexdigest()


class ProcurementCaseService:
    def __init__(self, repository, *, audit=log_audit):
        self.repository = repository
        self._audit = audit

    def _idempotent(self, organization_id, actor_user_id, key, name, payload, operation):
        key = _text(key, "idempotencyKey", 160)
        request_json = json.dumps(payload, ensure_ascii=False, sort_keys=True, separators=(",", ":"), default=str)
        request_hash = _hash(f"{name}:{request_json}")
        self.repository.acquire_command_lock(organization_id, actor_user_id, key)
        prior = self.repository.command_result(organization_id, actor_user_id, key)
        if prior:
            if prior["commandName"] != name or prior["requestHash"] != request_hash:
                raise ProcurementCaseConflict("PROCUREMENT_CASE_IDEMPOTENCY_REUSED")
            return prior["result"]
        case_id, result = operation()
        self.repository.record_command(
            organization_id, case_id, actor_user_id, key, name, request_hash, result
        )
        return result

    def create_case(
        self, *, organization_id, package, case_no, case_type, direction,
        category, other_description, subject, due_at, actor_user_id,
        idempotency_key, request=None,
    ):
        payload = {
            "packageVersionId": package["id"], "caseNo": case_no,
            "caseType": case_type, "direction": direction, "category": category,
            "otherDescription": other_description, "subject": subject, "dueAt": due_at,
        }

        def apply():
            try:
                state, policy_version = CasePolicy.validate_create(
                    case_type, direction, category, other_description
                )
            except CasePolicyError as error:
                raise ProcurementCaseError(error.code, fields=error.fields) from error
            result = self.repository.create_case({
                "organization_id": organization_id,
                "package_root_id": package["rootId"],
                "package_version_id": package["id"],
                "case_no": _text(case_no, "caseNo", 160),
                "case_type": case_type, "direction": direction or None,
                "category": category or None,
                "other_description": _text(
                    other_description, "otherDescription", 1000, required=False
                ) or None,
                "subject": _text(subject, "subject", 1000),
                "state": state, "policy_version": policy_version,
                "due_at": _text(due_at, "dueAt", 40, required=False) or None,
                "actor_user_id": actor_user_id,
            })
            self._audit_required(
                "procurement_case.created", actor_user_id, result["id"], request,
                {"caseType": case_type, "packageVersionId": package["id"]},
            )
            return result["id"], self.present(organization_id, result)

        return self._idempotent(
            organization_id, actor_user_id, idempotency_key,
            "CREATE_CASE", payload, apply,
        )

    def save_response(
        self, *, organization_id, case_id, expected_row_version,
        package_version_id, content, actor_user_id, idempotency_key, request=None,
    ):
        payload = {
            "caseId": case_id, "expectedRowVersion": expected_row_version,
            "packageVersionId": package_version_id, "content": content,
        }

        def apply():
            case = self._locked(organization_id, case_id, expected_row_version)
            if package_version_id != case["currentPackageVersionId"]:
                raise ProcurementCaseConflict("PROCUREMENT_CASE_PACKAGE_VERSION_STALE")
            if case["state"] in {"ISSUED", "CLOSED", "WITHDRAWN", "REJECTED"}:
                raise ProcurementCaseError("CASE_RESPONSE_EDIT_NOT_ALLOWED")
            content_value = _text(content, "content", 1_000_000)
            revision = self.repository.append_response(
                organization_id, case_id, package_version_id,
                content_value, _hash(content_value), actor_user_id,
            )
            next_state = case["state"]
            if case["caseType"] == "CLARIFICATION" and case["state"] != "DRAFT":
                next_state = "DRAFT"
            if case["caseType"] == "PETITION" and case["state"] not in {"RECEIVED", "ASSIGNED"}:
                next_state = "DRAFT_RESPONSE"
            if not self.repository.update_case_cas(
                organization_id, case_id, expected_row_version, {"state": next_state}
            ):
                raise ProcurementCaseConflict(current=self.repository.get_case(organization_id, case_id))
            if next_state != case["state"]:
                self.repository.append_transition(
                    organization_id, case_id, case["state"], next_state,
                    "EDIT_RESPONSE", package_version_id, revision["id"],
                    actor_user_id, "APPROVAL_STALE_AFTER_EDIT",
                )
            self._audit_required(
                "procurement_case.response_revision_saved", actor_user_id,
                case_id, request,
                {"responseRevisionId": revision["id"], "revisionNo": revision["revisionNo"]},
            )
            result = self.present(
                organization_id, self.repository.get_case(organization_id, case_id)
            )
            return case_id, result

        return self._idempotent(
            organization_id, actor_user_id, idempotency_key,
            "SAVE_RESPONSE", payload, apply,
        )

    def transition(
        self, *, organization_id, case_id, expected_row_version, action,
        package_version_id, actor_user_id, idempotency_key, reason=None,
        responsible_user_id=None, responsible_unit=None, request=None,
    ):
        payload = {
            "caseId": case_id, "expectedRowVersion": expected_row_version,
            "action": action, "packageVersionId": package_version_id,
            "reason": reason, "responsibleUserId": responsible_user_id,
            "responsibleUnit": responsible_unit,
        }

        def apply():
            case = self._locked(organization_id, case_id, expected_row_version)
            if package_version_id != case["currentPackageVersionId"]:
                raise ProcurementCaseConflict("PROCUREMENT_CASE_PACKAGE_VERSION_STALE")
            latest = self.repository.latest_response(organization_id, case_id)
            try:
                next_state = CasePolicy.transition(
                    case["caseType"], case["state"], action,
                    has_response=latest is not None,
                )
            except CasePolicyError as error:
                raise ProcurementCaseError(error.code, fields=error.fields) from error
            if action == "ISSUE":
                approved = next((
                    item for item in reversed(self.repository.transitions(organization_id, case_id))
                    if item["action"] == "APPROVE"
                ), None)
                if not approved or approved["responseRevisionId"] != latest["id"]:
                    raise ProcurementCaseError("CASE_APPROVED_RESPONSE_STALE")
            if action == "ASSIGN":
                if not responsible_user_id and not str(responsible_unit or "").strip():
                    raise ProcurementCaseError("CASE_RESPONSIBILITY_REQUIRED")
                self.repository.add_responsibility(
                    organization_id, case_id, responsible_user_id,
                    _text(responsible_unit, "responsibleUnit", 500, required=False) or None,
                    actor_user_id,
                )
                if responsible_user_id:
                    queue_user_notification(
                        self.repository.cursor, user_id=responsible_user_id,
                        organization_id=organization_id,
                        kind="procurement_case_assigned",
                        title="Bạn được giao xử lý hồ sơ",
                        message=f"Hồ sơ {case['caseNo']} đã được phân công cho bạn.",
                        email_subject="BiddingFlow: phân công hồ sơ",
                        target_type="procurement_case", target_id=case_id,
                        route="/trung-tam-ho-so", severity="info",
                    )
            if not self.repository.update_case_cas(
                organization_id, case_id, expected_row_version, {"state": next_state}
            ):
                raise ProcurementCaseConflict(current=self.repository.get_case(organization_id, case_id))
            response_id = latest["id"] if latest and action in {
                "DRAFT_RESPONSE", "SUBMIT_REVIEW", "APPROVE", "ISSUE"
            } else None
            self.repository.append_transition(
                organization_id, case_id, case["state"], next_state, action,
                package_version_id, response_id, actor_user_id,
                _text(reason, "reason", 2000, required=False) or None,
            )
            self._audit_required(
                f"procurement_case.{action.casefold()}", actor_user_id,
                case_id, request,
                {"fromState": case["state"], "toState": next_state,
                 "responseRevisionId": response_id},
            )
            result = self.present(
                organization_id, self.repository.get_case(organization_id, case_id)
            )
            return case_id, result

        return self._idempotent(
            organization_id, actor_user_id, idempotency_key,
            action, payload, apply,
        )

    def set_due_date(
        self, *, organization_id, case_id, expected_row_version, due_at,
        package_version_id, actor_user_id, idempotency_key, request=None,
    ):
        payload = {"caseId": case_id, "expectedRowVersion": expected_row_version, "dueAt": due_at, "packageVersionId": package_version_id}

        def apply():
            case = self._locked(organization_id, case_id, expected_row_version)
            if package_version_id != case["currentPackageVersionId"]:
                raise ProcurementCaseConflict("PROCUREMENT_CASE_PACKAGE_VERSION_STALE")
            due_value = _text(due_at, "dueAt", 40)
            if not self.repository.update_case_cas(
                organization_id, case_id, expected_row_version,
                {"due_at": due_value, "due_provenance": "MANUAL", "deadline_status": "NOT_EVALUATED"},
            ):
                raise ProcurementCaseConflict(current=self.repository.get_case(organization_id, case_id))
            self._audit_required(
                "procurement_case.due_date_set", actor_user_id, case_id,
                request, {"dueProvenance": "MANUAL", "deadlineStatus": "NOT_EVALUATED"},
            )
            result = self.present(organization_id, self.repository.get_case(organization_id, case_id))
            return case_id, result

        return self._idempotent(
            organization_id, actor_user_id, idempotency_key,
            "SET_DUE_DATE", payload, apply,
        )

    def add_party(
        self, *, organization_id, case_id, expected_row_version,
        package_version_id, role, display_name, contact, actor_user_id,
        idempotency_key, request=None,
    ):
        payload = {
            "caseId": case_id, "expectedRowVersion": expected_row_version,
            "packageVersionId": package_version_id, "role": role,
            "displayName": display_name, "contact": contact,
        }

        def apply():
            case = self._locked(organization_id, case_id, expected_row_version)
            self._require_current_package(case, package_version_id)
            if not isinstance(contact, dict):
                raise ProcurementCaseError(fields={"contact": "EXPECTED_OBJECT"})
            if len(json.dumps(contact, ensure_ascii=False)) > 20_000:
                raise ProcurementCaseError(fields={"contact": "TOO_LARGE"})
            party_id = self.repository.add_party(
                organization_id, case_id, _text(role, "role", 100),
                _text(display_name, "displayName", 1000), contact,
            )
            self._bump(organization_id, case_id, expected_row_version)
            self._audit_required(
                "procurement_case.party_added", actor_user_id, case_id,
                request, {"partyId": party_id},
            )
            return case_id, self.present(
                organization_id, self.repository.get_case(organization_id, case_id)
            )

        return self._idempotent(
            organization_id, actor_user_id, idempotency_key, "ADD_PARTY",
            payload, apply,
        )

    def add_legal_basis(
        self, *, organization_id, case_id, expected_row_version,
        package_version_id, response_revision_id, profile_version_id,
        instrument_version_id, note, actor_user_id, idempotency_key,
        request=None,
    ):
        payload = {
            "caseId": case_id, "expectedRowVersion": expected_row_version,
            "packageVersionId": package_version_id,
            "responseRevisionId": response_revision_id,
            "profileVersionId": profile_version_id,
            "instrumentVersionId": instrument_version_id, "note": note,
        }

        def apply():
            case = self._locked(organization_id, case_id, expected_row_version)
            self._require_current_package(case, package_version_id)
            profile_id = _text(
                profile_version_id, "profileVersionId", 200, required=False
            ) or None
            instrument_id = _text(
                instrument_version_id, "instrumentVersionId", 200,
                required=False,
            ) or None
            note_value = _text(note, "note", 4000, required=False) or None
            if not (profile_id and instrument_id) and not note_value:
                raise ProcurementCaseError("CASE_LEGAL_BASIS_REQUIRED")
            if profile_id or instrument_id:
                if not (profile_id and instrument_id):
                    raise ProcurementCaseError("CASE_LEGAL_BASIS_EXACT_REQUIRED")
                profile_ok, instrument_ok, member_ok = (
                    self.repository.legal_references(profile_id, instrument_id)
                )
                if not profile_ok or not instrument_ok:
                    raise ProcurementCaseError("CASE_LEGAL_VERSION_NOT_FOUND")
                if not member_ok:
                    raise ProcurementCaseError("CASE_LEGAL_SOURCE_NOT_IN_PROFILE")
                verification = "VERIFIED"
            else:
                verification = "UNVERIFIED_NOTE"
            if response_revision_id:
                revisions = self.repository.response_revisions(
                    organization_id, case_id
                )
                if response_revision_id not in {item["id"] for item in revisions}:
                    raise ProcurementCaseError("CASE_RESPONSE_REVISION_NOT_FOUND")
            basis_id = self.repository.add_legal_basis(
                organization_id, case_id, response_revision_id or None,
                profile_id, instrument_id, note_value, verification,
                actor_user_id,
            )
            self._bump(organization_id, case_id, expected_row_version)
            self._audit_required(
                "procurement_case.legal_basis_added", actor_user_id, case_id,
                request, {"legalBasisId": basis_id,
                          "verificationStatus": verification},
            )
            return case_id, self.present(
                organization_id, self.repository.get_case(organization_id, case_id)
            )

        return self._idempotent(
            organization_id, actor_user_id, idempotency_key, "ADD_LEGAL_BASIS",
            payload, apply,
        )

    def observe_source(
        self, *, organization_id, case_id, expected_row_version,
        package_version_id, provider, upstream_identity, upstream_revision,
        canonical, actor_user_id, idempotency_key, request=None,
    ):
        payload = {
            "caseId": case_id, "expectedRowVersion": expected_row_version,
            "packageVersionId": package_version_id, "provider": provider,
            "upstreamIdentity": upstream_identity,
            "upstreamRevision": upstream_revision, "canonical": canonical,
        }

        def apply():
            case = self._locked(organization_id, case_id, expected_row_version)
            self._require_current_package(case, package_version_id)
            if not isinstance(canonical, dict):
                raise ProcurementCaseError(fields={"canonical": "EXPECTED_OBJECT"})
            canonical_json = json.dumps(
                canonical, ensure_ascii=False, sort_keys=True,
                separators=(",", ":"), default=str,
            )
            if len(canonical_json) > 200_000:
                raise ProcurementCaseError(fields={"canonical": "TOO_LARGE"})
            source_hash = _hash(canonical_json)
            observation = self.repository.add_source_observation(
                organization_id, case_id, case["caseType"],
                _text(provider, "provider", 160),
                _text(upstream_identity, "upstreamIdentity", 500),
                _text(upstream_revision, "upstreamRevision", 500),
                source_hash, canonical,
            )
            if observation["sourceSha256"] != source_hash:
                raise ProcurementCaseConflict("CASE_SOURCE_REVISION_MISMATCH")
            if observation["linkedCaseId"] != case_id:
                raise ProcurementCaseConflict("CASE_SOURCE_ALREADY_LINKED")
            if not observation["replayed"]:
                self._bump(organization_id, case_id, expected_row_version)
                self._audit_required(
                    "procurement_case.source_observed", actor_user_id, case_id,
                    request, {"observationId": observation["id"],
                              "sourceSha256": observation["sourceSha256"]},
                )
            return case_id, self.present(
                organization_id, self.repository.get_case(organization_id, case_id)
            )

        return self._idempotent(
            organization_id, actor_user_id, idempotency_key, "OBSERVE_SOURCE",
            payload, apply,
        )

    def add_attachment(
        self, *, organization_id, case_id, expected_row_version,
        package_version_id, response_revision_id, filename, storage_key,
        media_type, byte_size, sha256, actor_user_id, idempotency_key,
        request=None,
    ):
        payload = {
            "caseId": case_id, "expectedRowVersion": expected_row_version,
            "packageVersionId": package_version_id,
            "responseRevisionId": response_revision_id, "filename": filename,
            "storageKey": storage_key, "mediaType": media_type,
            "byteSize": byte_size, "sha256": sha256,
        }

        def apply():
            case = self._locked(organization_id, case_id, expected_row_version)
            self._require_current_package(case, package_version_id)
            if case["state"] in {"CLOSED", "WITHDRAWN", "REJECTED"}:
                raise ProcurementCaseError("CASE_ATTACHMENT_NOT_ALLOWED")
            if response_revision_id and response_revision_id not in {
                item["id"] for item in self.repository.response_revisions(
                    organization_id, case_id
                )
            }:
                raise ProcurementCaseError("CASE_RESPONSE_REVISION_NOT_FOUND")
            attachment_id = self.repository.add_attachment(
                organization_id, case_id, response_revision_id or None,
                _text(filename, "filename", 255),
                _text(storage_key, "storageKey", 1000),
                _text(media_type, "mediaType", 200), int(byte_size),
                _text(sha256, "sha256", 64), actor_user_id,
            )
            self._bump(organization_id, case_id, expected_row_version)
            self._audit_required(
                "procurement_case.attachment_added", actor_user_id, case_id,
                request, {"attachmentId": attachment_id, "byteSize": int(byte_size),
                          "sha256": sha256},
            )
            return case_id, self.present(
                organization_id, self.repository.get_case(organization_id, case_id)
            )

        return self._idempotent(
            organization_id, actor_user_id, idempotency_key, "ADD_ATTACHMENT",
            payload, apply,
        )

    def present(self, organization_id, case):
        if case is None:
            raise ProcurementCaseNotFound()
        value = {**case, "organizationId": organization_id}
        value = self.repository.hydrate(value)
        latest = value["responses"][0] if value["responses"] else None
        value["availableActions"] = CasePolicy.available_actions(
            value["caseType"], value["state"], has_response=latest is not None
        )
        value["currentResponseRevisionId"] = latest["id"] if latest else None
        value["legalBasisStatus"] = (
            "VERIFIED" if any(
                item["verificationStatus"] == "VERIFIED"
                for item in value["legalBases"]
            ) else "NOT_EVALUATED"
        )
        # A source link is not itself a legal conclusion. This remains
        # deterministic until an approved legal-review rule says otherwise.
        value["legalConclusion"] = "NOT_EVALUATED"
        return value

    def _locked(self, organization_id, case_id, expected_row_version):
        case = self.repository.get_case(organization_id, case_id, lock=True)
        if case is None:
            raise ProcurementCaseNotFound()
        if int(case["rowVersion"]) != int(expected_row_version):
            raise ProcurementCaseConflict(current=case)
        return case

    @staticmethod
    def _require_current_package(case, package_version_id):
        if package_version_id != case["currentPackageVersionId"]:
            raise ProcurementCaseConflict("PROCUREMENT_CASE_PACKAGE_VERSION_STALE")

    def _bump(self, organization_id, case_id, expected_row_version):
        if not self.repository.update_case_cas(
            organization_id, case_id, expected_row_version, {}
        ):
            raise ProcurementCaseConflict(
                current=self.repository.get_case(organization_id, case_id)
            )

    def _audit_required(self, action, actor, case_id, request, metadata):
        organization_id = self.repository._organization_id(case_id)
        self._audit(
            action, actor_user_id=actor, target_type="procurement_case",
            target_id=case_id, request=request, metadata=metadata,
            cursor=self.repository.cursor, required=True,
        )
        insert_activity_events(
            self.repository.cursor, organization_id=organization_id,
            owner_type=self.repository.activity_scope(organization_id, case_id),
            actor_user_id=actor, occurred_at=vietnam_now_sql(),
            events=[ActivityEvent(
                target_type="procurement_case", target_id=case_id,
                target_root_id=case_id, action=action, metadata=metadata,
            )],
        )
        enqueue_websocket_event(
            self.repository.cursor, "broadcast",
            organization_id=organization_id,
            payload={"event": "db_changed"},
        )
