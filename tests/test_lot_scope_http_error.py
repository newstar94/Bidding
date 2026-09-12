import asyncio
import json
from types import SimpleNamespace

import pytest

from backend import lot_lifecycle_routes as routes
from backend.auth.session_utils import OrgPermissionError, OrgScopeRequiredError


@pytest.mark.parametrize("error,status,payload", [
    (OrgScopeRequiredError("Chọn tổ chức"), 409,
     {"error": "Chọn tổ chức", "code": "ORG_SCOPE_REQUIRED"}),
    (OrgPermissionError("private detail"), 403,
     {"error": "Không có quyền truy cập tổ chức."}),
])
@pytest.mark.parametrize("handler", ["get_lot_lifecycle_api", "create_lot_batch_api", "finalize_lot_batch_api"])
def test_lifecycle_read_preserves_scope_and_permission_error_contract(monkeypatch, error, status, payload, handler):
    monkeypatch.setattr(routes, "verify_session", lambda _: (True, SimpleNamespace(user_id="user")))
    def reject(*_):
        raise error
    monkeypatch.setattr(routes, "get_active_org", reject)
    async def read_json(_):
        if handler == "create_lot_batch_api":
            return {"lotIds": ["lot"], "approvalMode": "CONSOLIDATED_APPROVAL"}, None
        return {"lotIds": ["lot"], "approvalMode": "CONSOLIDATED_APPROVAL", "outcomes": {"lot": "AWARDED"}, "packageAward": {}}, None
    monkeypatch.setattr(routes, "read_json_object", read_json)
    response = asyncio.run(getattr(routes, handler)(SimpleNamespace(
        path_params={"package_id": "package", "batch_id": "batch"},
        headers={"Idempotency-Key": "scope-regression-12345"},
    )))
    assert response.status_code == status
    assert json.loads(response.body) == payload
