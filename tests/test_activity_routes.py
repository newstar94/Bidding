import asyncio
import json
from types import SimpleNamespace

from backend.activity import routes


def test_retired_procurement_case_activity_target_is_rejected_before_database_access(
    monkeypatch,
):
    monkeypatch.setattr(
        routes,
        "verify_session",
        lambda _request: (True, SimpleNamespace(user_id="user-1")),
    )
    request = SimpleNamespace(
        path_params={"target_type": "procurement_case", "target_id": "case-1"},
        query_params={},
    )

    response = asyncio.run(routes.list_activity_timeline_api(request))

    assert response.status_code == 400
    assert json.loads(response.body)["code"] == "ACTIVITY_TARGET_INVALID"
