"""Application service for capture, preview and explicit conflict resolution."""

from __future__ import annotations

from copy import deepcopy

from .authority import canonical_digest, issue_authority, verify_authority
from .merge_kernel import MISSING, inspect_three_way
from .policy_registry import POLICY_VERSION, get_conflict_policy


class ConflictResolutionError(ValueError):
    def __init__(self, code, *, status_code=400, fields=None):
        super().__init__(code)
        self.code = code
        self.status_code = status_code
        self.fields = fields or {}


class ConflictResolutionService:
    def __init__(self, repository, *, environ=None, now=None):
        self.repository = repository
        self.environ = environ
        self.now = now

    def capture(self, *, scope, request, server_record):
        policy = get_conflict_policy(request.get("entityType"))
        if policy is None or policy.table_name != request.get("tableName"):
            raise ConflictResolutionError("UNSUPPORTED_CONFLICT_ENTITY")
        base = request.get("baseSnapshot")
        local = request.get("localIntent")
        if not isinstance(base, dict) or not isinstance(local, dict) or not isinstance(server_record, dict):
            raise ConflictResolutionError("INVALID_CONFLICT_SNAPSHOT")
        current_version = server_record.get("rowVersion")
        if isinstance(current_version, bool) or not isinstance(current_version, int):
            raise ConflictResolutionError("INVALID_SERVER_ROW_VERSION")
        payload = {
            "schemaVersion": 1,
            "policyVersion": POLICY_VERSION,
            "base": deepcopy(base),
            "local": deepcopy(local),
            "capturedServer": deepcopy(server_record),
        }
        return self.repository.create(
            organization_id=scope["organizationId"],
            actor_user_id=scope["actorUserId"],
            workspace_fingerprint=scope["workspaceFingerprint"],
            batch_id=request["batchId"], mutation_id=request["mutationId"],
            entity_type=policy.entity_type, table_name=policy.table_name,
            record_id=request["recordId"],
            expected_row_version=request["expectedRowVersion"],
            server_row_version=current_version,
            payload=payload,
        )

    def preview(self, *, scope, draft_id, current_server_record):
        draft = self.repository.load(
            organization_id=scope["organizationId"], actor_user_id=scope["actorUserId"],
            workspace_fingerprint=scope["workspaceFingerprint"], draft_id=draft_id,
        )
        if draft is None:
            raise ConflictResolutionError("CONFLICT_DRAFT_NOT_FOUND", status_code=404)
        policy = get_conflict_policy(draft["entityType"])
        if policy is None or policy.table_name != draft["tableName"]:
            raise ConflictResolutionError("CONFLICT_POLICY_CHANGED", status_code=409)
        payload = draft["payload"]
        if payload.get("policyVersion") != POLICY_VERSION:
            raise ConflictResolutionError("CONFLICT_POLICY_CHANGED", status_code=409)
        current_version = current_server_record.get("rowVersion")
        if isinstance(current_version, bool) or not isinstance(current_version, int):
            raise ConflictResolutionError("INVALID_SERVER_ROW_VERSION")
        fields = sorted(set(payload["base"]) | set(payload["local"]) | set(current_server_record))
        inspections = []
        for field in fields:
            if field in {"id", "rowVersion"}:
                continue
            inspection = inspect_three_way(
                field,
                payload["base"].get(field, MISSING),
                payload["local"].get(field, MISSING),
                current_server_record.get(field, MISSING),
                approved_scalar=field in policy.scalar_fields,
                always_require_choice=field in policy.explicit_choice_fields,
            )
            inspections.append(inspection.as_dict())
        server_digest = canonical_digest(current_server_record)
        token = issue_authority(
            {
                "organizationId": scope["organizationId"],
                "actorUserId": scope["actorUserId"],
                "workspaceFingerprint": scope["workspaceFingerprint"],
                "draftId": draft_id,
                "entityType": policy.entity_type,
                "recordId": draft["recordId"],
                "serverRowVersion": current_version,
                "serverDigest": server_digest,
                "policyVersion": POLICY_VERSION,
            },
            now=self.now,
            environ=self.environ,
        )
        return {
            "draft": {key: value for key, value in draft.items() if key != "payload"},
            "base": payload["base"], "local": payload["local"],
            "server": deepcopy(current_server_record), "fields": inspections,
            "resolutionAuthority": token, "authorityExpiresInSeconds": 900,
            "autoReplay": False,
        }

    def build_resolution(self, *, scope, draft_id, current_server_record, authority, decisions, client_mutation_id):
        draft = self.repository.load(
            organization_id=scope["organizationId"], actor_user_id=scope["actorUserId"],
            workspace_fingerprint=scope["workspaceFingerprint"], draft_id=draft_id,
        )
        if draft is None:
            raise ConflictResolutionError("CONFLICT_DRAFT_NOT_FOUND", status_code=404)
        policy = get_conflict_policy(draft["entityType"])
        current_version = current_server_record.get("rowVersion")
        expected_claims = {
            "organizationId": scope["organizationId"], "actorUserId": scope["actorUserId"],
            "workspaceFingerprint": scope["workspaceFingerprint"], "draftId": draft_id,
            "entityType": draft["entityType"], "recordId": draft["recordId"],
            "serverRowVersion": current_version,
            "serverDigest": canonical_digest(current_server_record),
            "policyVersion": POLICY_VERSION,
        }
        try:
            verify_authority(authority, expected_claims, now=self.now, environ=self.environ)
        except ValueError as error:
            raise ConflictResolutionError(str(error), status_code=409) from error
        if not isinstance(decisions, dict):
            raise ConflictResolutionError("INVALID_RESOLUTION_DECISIONS")
        unknown = set(decisions) - set(policy.scalar_fields)
        if unknown:
            raise ConflictResolutionError(
                "INVALID_RESOLUTION_DECISIONS",
                fields={field: "UNSUPPORTED_FIELD" for field in sorted(unknown)},
            )
        base = draft["payload"]["base"]
        local = draft["payload"]["local"]
        resolved = deepcopy(current_server_record)
        missing = {}
        for field in sorted(policy.scalar_fields):
            inspection = inspect_three_way(
                field, base.get(field, MISSING), local.get(field, MISSING),
                current_server_record.get(field, MISSING), approved_scalar=True,
                always_require_choice=field in policy.explicit_choice_fields,
            )
            if inspection.status.startswith("UNSUPPORTED"):
                continue
            choice = decisions.get(field)
            if inspection.requires_choice and choice not in {"LOCAL", "SERVER"}:
                missing[field] = "CHOICE_REQUIRED"
                continue
            if choice is not None and choice not in {"LOCAL", "SERVER"}:
                missing[field] = "INVALID_CHOICE"
                continue
            if choice == "LOCAL":
                resolved[field] = deepcopy(local[field])
            elif choice == "SERVER":
                resolved[field] = deepcopy(current_server_record[field])
            elif inspection.status == "LOCAL_ONLY":
                resolved[field] = deepcopy(local[field])
        if missing:
            raise ConflictResolutionError("INCOMPLETE_RESOLUTION", fields=missing)
        resolved["id"] = draft["recordId"]
        resolved["expectedVersion"] = int(current_version)
        resolved.pop("rowVersion", None)
        return {
            policy.payload_key: [resolved],
            "clientMutationId": client_mutation_id,
        }
