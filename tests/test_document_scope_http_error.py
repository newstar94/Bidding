import asyncio
import json
from types import SimpleNamespace

import pytest

from backend.auth.session_utils import OrgPermissionError, OrgScopeRequiredError
from backend.documents import package_document_routes as routes


@pytest.mark.parametrize("handler", ["list_package_documents_api", "download_package_document_api", "delete_package_document_api", "upload_package_document_api"])
@pytest.mark.parametrize("error,status,code", [
    (OrgScopeRequiredError("Chọn tổ chức"), 409, "ORG_SCOPE_REQUIRED"),
    (OrgPermissionError("private detail"), 403, "ORG_ACCESS_DENIED"),
])
def test_document_scope_response(monkeypatch, handler, error, status, code):
    monkeypatch.setattr(routes, "verify_session", lambda _: (True, SimpleNamespace(user_id="user")))
    def reject(*args):
        raise error
    monkeypatch.setattr(routes, "get_active_org", reject)
    request = SimpleNamespace(path_params={"package_id": "package", "document_type": "BID_EVALUATION_REPORT"},
                              query_params={}, headers={"Idempotency-Key": "scope-regression-12345"})
    response = asyncio.run(getattr(routes, handler)(request))
    assert response.status_code == status
    assert json.loads(response.body)["code"] == code
    assert "private detail" not in response.body.decode()
