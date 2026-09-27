from copy import deepcopy
from datetime import datetime, timedelta, timezone
from types import SimpleNamespace

import pytest

import backend.procurement_import.routes as routes
from backend.procurement_import.domain import canonical_digest
from backend.procurement_import.service import PreviewStore


def _session():
    preview_bundle = {
        "importKind": "NOTICE",
        "notice": {"noticeNo": "IB2600000001"},
    }
    return {
        "id": "session-1",
        "previewId": "preview-1",
        "organizationId": "org-1",
        "userId": "user-1",
        "workspaceLease": "lease-1",
        "expiresAt": datetime.now(timezone.utc) + timedelta(days=1),
        "previewExpiresAt": datetime.now(timezone.utc) + timedelta(minutes=5),
        "previewBundleDigest": canonical_digest(preview_bundle),
        "previewBundle": preview_bundle,
        "canonicalBundle": {"enrichmentStatus": "COMPLETED"},
    }


def _load(monkeypatch, session, *, cache=None):

    class Repository:
        def __init__(self, _cursor):
            pass

        def get_by_preview_id(self, preview_id, **scope):
            assert preview_id == "preview-1"
            assert scope == {
                "organization_id": "org-1",
                "user_id": "user-1",
                "workspace_lease": "lease-1",
            }
            return deepcopy(session)

    class Connection:
        def cursor(self):
            return object()

        def rollback(self):
            pass

        def close(self):
            pass

    monkeypatch.setattr(routes, "PREVIEW_STORE", cache or PreviewStore(ttl_seconds=300))
    monkeypatch.setattr(routes, "ProcurementImportSessionRepository", Repository)
    monkeypatch.setattr(routes.database, "get_connection", lambda: Connection())

    return routes._load_preview(
        None,
        "preview-1",
        organization_id="org-1",
        user_id="user-1",
        workspace_lease="lease-1",
    )

def test_preview_apply_falls_back_to_scoped_durable_import_session(monkeypatch):
    loaded = _load(monkeypatch, _session())
    assert loaded.preview_id == "preview-1"
    assert loaded.canonical_bundle["notice"]["noticeNo"] == "IB2600000001"


def test_preview_session_lifetime_does_not_extend_preview_lifetime(monkeypatch):
    session = _session()
    session["previewExpiresAt"] = datetime.now(timezone.utc) - timedelta(seconds=1)
    with pytest.raises(LookupError, match="PROCUREMENT_PREVIEW_EXPIRED"):
        _load(monkeypatch, session)


def test_preview_rejects_changed_durable_snapshot(monkeypatch):
    session = _session()
    session["previewBundle"]["notice"]["noticeNo"] = "IB2600000002"
    with pytest.raises(ValueError, match="PROCUREMENT_PREVIEW_DIGEST_INVALID"):
        _load(monkeypatch, session)


def test_cache_only_preview_cannot_apply_after_prepare_failed_before_commit(monkeypatch):
    cache = SimpleNamespace(get=lambda *_args, **_kwargs: pytest.fail("cache must not authorize apply"))
    with pytest.raises(LookupError, match="PROCUREMENT_PREVIEW_EXPIRED"):
        _load(monkeypatch, None, cache=cache)
