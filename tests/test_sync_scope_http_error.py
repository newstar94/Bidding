import json
from types import SimpleNamespace

import pytest

from backend.auth.session_utils import OrgPermissionError, OrgScopeRequiredError
from backend.sync import service
from backend.sync import version_api
from backend.sync import read_service, pagination


@pytest.mark.parametrize("error,status,code", [
    (OrgScopeRequiredError("Chọn tổ chức"), 409, "ORG_SCOPE_REQUIRED"),
    (OrgPermissionError("private detail"), 403, "ORG_ACCESS_DENIED"),
])
def test_sync_actor_scope_error_is_distinct_from_access_denial(monkeypatch, error, status, code):
    def reject(*args, **kwargs):
        raise error
    monkeypatch.setattr(service, "_resolve_sync_actor_context", reject)
    request = SimpleNamespace(headers={}, state=SimpleNamespace())
    response = service.execute_sync_mutation(request, {})
    assert response.status_code == status
    payload = json.loads(response.body)
    assert payload["code"] == code
    assert "private detail" not in response.body.decode()


@pytest.mark.parametrize("error,status,code", [
    (OrgScopeRequiredError("Chọn tổ chức"), 409, "ORG_SCOPE_REQUIRED"),
    (OrgPermissionError("private detail"), 403, "ORG_ACCESS_DENIED"),
])
def test_sync_version_rejects_ambiguous_scope_before_reading_cursor(monkeypatch, error, status, code):
    monkeypatch.setattr(version_api, "verify_session", lambda _: (True, SimpleNamespace(user_id="user")))
    def reject(*args):
        raise error
    monkeypatch.setattr(version_api, "get_active_org", reject)
    response = version_api._read_current_sync_version(SimpleNamespace(headers={}, state=SimpleNamespace()))
    assert response.status_code == status
    assert json.loads(response.body)["code"] == code
    assert "private detail" not in response.body.decode()


@pytest.mark.parametrize("module,handler", [
    (read_service, "_read_sync_data_blocking"),
    (read_service, "_read_single_record_blocking"),
    (pagination, "_paginate_records_blocking"),
])
@pytest.mark.parametrize("error,status", [(OrgScopeRequiredError("scope"), 409), (OrgPermissionError("private"), 403)])
def test_sync_reads_preserve_scope_error_and_close_connection(monkeypatch, module, handler, error, status):
    events = []
    class Connection:
        def cursor(self): return self
        def execute(self, *args): return self
        def rollback(self): events.append("rollback")
        def close(self): events.append("close")
    monkeypatch.setattr(module.database, "get_connection", Connection)
    monkeypatch.setattr(module, "verify_session", lambda _: (True, SimpleNamespace(user_id="user")))
    def reject(*args, **kwargs): raise error
    monkeypatch.setattr(module, "get_active_org", reject)
    request = SimpleNamespace(query_params={"table": "goithau", "id": "package"}, headers={}, state=SimpleNamespace())
    response = getattr(module, handler)(request)
    assert response.status_code == status
    assert json.loads(response.body)["code"] == error.code
    if handler != "_read_single_record_blocking":
        assert "close" in events
    if handler == "_read_sync_data_blocking":
        assert events == ["rollback", "close"]
