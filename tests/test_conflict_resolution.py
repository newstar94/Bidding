from __future__ import annotations

import copy

import pytest
from cryptography.fernet import Fernet

from backend.db.schema import SCHEMA_DINH_NGHIA
from backend.db.upgrades import DB_SCHEMA_VERSION, UPGRADES
from backend.sync.conflict_resolution.authority import (
    AuthorityError,
    canonical_digest,
    issue_authority,
    verify_authority,
)
from backend.sync.conflict_resolution.merge_kernel import MISSING, inspect_three_way
from backend.sync.conflict_resolution.policy_registry import POLICY_VERSION, get_conflict_policy
from backend.sync.conflict_resolution.routes import conflict_resolution_routes
from backend.sync.conflict_resolution.service import (
    ConflictResolutionError,
    ConflictResolutionService,
)
from backend.sync.conflict_resolution.storage import ConflictDraftRepository, DraftStorageError


ENV = {
    "CONFLICT_RESOLUTION_SIGNING_KEY": "s" * 32,
    "CONFLICT_DRAFT_ENCRYPTION_KEY": Fernet.generate_key().decode("ascii"),
}
SCOPE = {
    "organizationId": "org-a",
    "actorUserId": "user-a",
    "workspaceFingerprint": "workspace-a",
}


class MemoryRepository:
    def __init__(self):
        self.drafts = {}

    def create(self, **values):
        draft_id = "draft-1"
        self.drafts[draft_id] = {
            "id": draft_id,
            "entityType": values["entity_type"],
            "tableName": values["table_name"],
            "recordId": values["record_id"],
            "expectedRowVersion": values["expected_row_version"],
            "serverRowVersion": values["server_row_version"],
            "status": "ACTIVE",
            "createdAt": 100,
            "updatedAt": 100,
            "expiresAt": 200,
            "payloadDigest": canonical_digest(values["payload"]),
            "payload": copy.deepcopy(values["payload"]),
        }
        return {key: value for key, value in self.drafts[draft_id].items() if key != "payload"}

    def load(self, **values):
        draft = self.drafts.get(values["draft_id"])
        return copy.deepcopy(draft) if draft else None


class NoopCursor:
    pass


def _request():
    return {
        "entityType": "goithau",
        "tableName": "goi_thau",
        "recordId": "package-1",
        "workspaceFingerprint": "workspace-a",
        "batchId": "batch-1",
        "mutationId": "mutation-1",
        "expectedRowVersion": 2,
        "baseSnapshot": {
            "id": "package-1",
            "rowVersion": 2,
            "tenGoiThau": "Base",
            "giaGoiThau": 100,
            "phanLoList": [{"id": "lot-1"}],
        },
        "localIntent": {
            "id": "package-1",
            "rowVersion": 2,
            "tenGoiThau": "Local",
            "giaGoiThau": 110,
            "phanLoList": [{"id": "lot-1"}, {"id": "lot-2"}],
        },
    }


def _server(version=3, title="Server"):
    return {
        "id": "package-1",
        "rowVersion": version,
        "tenGoiThau": title,
        "giaGoiThau": 100,
        "phanLoList": [{"id": "lot-1"}],
        "organizationId": "org-a",
    }


@pytest.mark.parametrize(
    ("base", "local", "server", "status", "suggested"),
    [
        ("A", "A", "A", "UNCHANGED", "A"),
        ("A", "B", "A", "LOCAL_ONLY", "B"),
        ("A", "A", "C", "SERVER_ONLY", "C"),
        ("A", "B", "B", "BOTH_SAME", "B"),
        ("A", "B", "C", "CONFLICT", MISSING),
        (None, "B", None, "LOCAL_ONLY", "B"),
    ],
)
def test_three_way_scalar_matrix(base, local, server, status, suggested):
    result = inspect_three_way("field", base, local, server, approved_scalar=True)
    assert result.status == status
    assert result.suggested_value is suggested or result.suggested_value == suggested


def test_three_way_rejects_missing_nested_and_unknown_fields():
    assert inspect_three_way("x", "A", MISSING, "A", approved_scalar=True).status == "UNSUPPORTED_DELETE"
    assert inspect_three_way("x", [], [], [], approved_scalar=True).status == "UNSUPPORTED_NESTED"
    assert inspect_three_way("id", "1", "2", "1", approved_scalar=False).status == "UNSUPPORTED_FIELD"


def test_authority_is_expiring_actor_workspace_and_snapshot_bound():
    claims = {
        "organizationId": "org-a",
        "actorUserId": "user-a",
        "workspaceFingerprint": "workspace-a",
        "draftId": "draft-1",
        "serverRowVersion": 3,
        "serverDigest": "d" * 64,
        "policyVersion": POLICY_VERSION,
    }
    token = issue_authority(claims, now=100, ttl_seconds=900, environ=ENV)
    assert verify_authority(token, claims, now=1000, environ=ENV)["draftId"] == "draft-1"
    with pytest.raises(AuthorityError, match="EXPIRED_AUTHORITY"):
        verify_authority(token, claims, now=1001, environ=ENV)
    with pytest.raises(AuthorityError, match="AUTHORITY_SCOPE_MISMATCH"):
        verify_authority(token, {**claims, "actorUserId": "user-b"}, now=200, environ=ENV)
    with pytest.raises(AuthorityError, match="INVALID_AUTHORITY"):
        verify_authority(token[:-1] + ("A" if token[-1] != "A" else "B"), claims, now=200, environ=ENV)


def test_capture_preview_and_resolution_preserve_full_authorized_values():
    repository = MemoryRepository()
    service = ConflictResolutionService(repository, environ=ENV, now=100)
    created = service.capture(scope=SCOPE, request=_request(), server_record=_server())
    assert created["serverRowVersion"] == 3

    preview = service.preview(
        scope=SCOPE, draft_id="draft-1", current_server_record=_server()
    )
    assert preview["base"]["giaGoiThau"] == 100
    assert preview["local"]["giaGoiThau"] == 110
    assert preview["server"]["tenGoiThau"] == "Server"
    by_field = {item["field"]: item for item in preview["fields"]}
    assert by_field["tenGoiThau"]["status"] == "CONFLICT"
    assert by_field["giaGoiThau"]["requiresChoice"] is True
    assert by_field["phanLoList"]["status"] == "UNSUPPORTED_FIELD"
    assert preview["autoReplay"] is False

    mutation = service.build_resolution(
        scope=SCOPE,
        draft_id="draft-1",
        current_server_record=_server(),
        authority=preview["resolutionAuthority"],
        decisions={"tenGoiThau": "LOCAL", "giaGoiThau": "LOCAL"},
        client_mutation_id="resolution-123",
    )
    record = mutation["goithau"][0]
    assert record["tenGoiThau"] == "Local"
    assert record["giaGoiThau"] == 110
    assert record["expectedVersion"] == 3
    assert "rowVersion" not in record
    assert record["organizationId"] == "org-a"


def test_resolution_requires_explicit_financial_choice_and_rejects_second_race():
    repository = MemoryRepository()
    service = ConflictResolutionService(repository, environ=ENV, now=100)
    service.capture(scope=SCOPE, request=_request(), server_record=_server())
    preview = service.preview(scope=SCOPE, draft_id="draft-1", current_server_record=_server())
    with pytest.raises(ConflictResolutionError) as missing:
        service.build_resolution(
            scope=SCOPE, draft_id="draft-1", current_server_record=_server(),
            authority=preview["resolutionAuthority"], decisions={"tenGoiThau": "LOCAL"},
            client_mutation_id="resolution-123",
        )
    assert missing.value.code == "INCOMPLETE_RESOLUTION"
    assert missing.value.fields == {"giaGoiThau": "CHOICE_REQUIRED"}

    with pytest.raises(ConflictResolutionError) as raced:
        service.build_resolution(
            scope=SCOPE, draft_id="draft-1", current_server_record=_server(4, "Second writer"),
            authority=preview["resolutionAuthority"],
            decisions={"tenGoiThau": "LOCAL", "giaGoiThau": "LOCAL"},
            client_mutation_id="resolution-123",
        )
    assert raced.value.status_code == 409
    assert raced.value.code == "AUTHORITY_SCOPE_MISMATCH"


def test_encrypted_payload_detects_wrong_key_and_digest():
    repository = ConflictDraftRepository(NoopCursor(), environ=ENV, now=100)
    ciphertext, digest = repository._encrypt({"cccd": "012345678901", "bank": "Full value"})
    assert "012345678901" not in ciphertext
    assert repository._decrypt(ciphertext, digest)["cccd"] == "012345678901"
    with pytest.raises(DraftStorageError, match="CORRUPT_DRAFT"):
        repository._decrypt(ciphertext, "0" * 64)
    with pytest.raises(DraftStorageError, match="CORRUPT_DRAFT"):
        ConflictDraftRepository(
            NoopCursor(),
            environ={**ENV, "CONFLICT_DRAFT_ENCRYPTION_KEY": Fernet.generate_key().decode("ascii")},
            now=100,
        )._decrypt(ciphertext, digest)


def test_conflict_center_schema_policy_and_routes_are_closed():
    table = SCHEMA_DINH_NGHIA["conflict_resolution_drafts"]
    assert table["primary_keys"] == ["organization_id", "id"]
    assert "payload_ciphertext" in table["columns"]
    assert UPGRADES[-1].version == DB_SCHEMA_VERSION
    assert any(
        upgrade.version == 64 and upgrade.name == "add_conflict_resolution_drafts"
        for upgrade in UPGRADES
    )
    assert get_conflict_policy("kehoach").table_name == "ke_hoach_lcnt"
    assert get_conflict_policy("goithau").table_name == "goi_thau"
    assert get_conflict_policy("nha_thau") is None

    class Route:
        def __init__(self, path, endpoint, methods):
            self.path = path
            self.endpoint = endpoint
            self.methods = methods

    routes = conflict_resolution_routes(Route)
    assert {(route.path, tuple(route.methods)) for route in routes} == {
        ("/api/conflict-drafts", ("POST",)),
        ("/api/conflict-drafts", ("GET",)),
        ("/api/conflict-drafts/{draft_id}/preview", ("POST",)),
        ("/api/conflict-drafts/{draft_id}/resolve", ("POST",)),
        ("/api/conflict-drafts/{draft_id}", ("DELETE",)),
    }
