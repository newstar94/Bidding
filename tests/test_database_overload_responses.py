import asyncio
from types import SimpleNamespace

import pytest

from backend.activity import routes as activity_routes
from backend.lot_lifecycle_routes import get_lot_lifecycle_api
from backend.notifications import routes as notification_routes
from backend.shared.async_io import BlockingIOBusyError, BlockingIOTimeoutError


@pytest.mark.parametrize("exception", [BlockingIOBusyError, BlockingIOTimeoutError])
@pytest.mark.parametrize("module, handler_name", [
    (notification_routes, "list_notifications_api"),
    (activity_routes, "list_activity_timeline_api"),
])
def test_read_lane_overload_has_retryable_api_response(monkeypatch, module, handler_name, exception):
    async def fail(*_args, **_kwargs):
        raise exception("simulated")
    monkeypatch.setattr(module, "run_database_read", fail)
    request = SimpleNamespace(query_params={}, path_params={"target_type": "goithau", "target_id": "p"})
    response = asyncio.run(getattr(module, handler_name)(request))
    assert response.status_code == 503
    assert response.headers["Retry-After"] == "1"
    assert response.body.startswith(b"{")


@pytest.mark.parametrize("exception", [BlockingIOBusyError, BlockingIOTimeoutError])
def test_lot_lifecycle_read_overload_has_retryable_api_response(monkeypatch, exception):
    async def fail(*_args, **_kwargs):
        raise exception("simulated")
    monkeypatch.setattr("backend.lot_lifecycle_routes.run_database_read", fail)
    request = SimpleNamespace(path_params={"package_id": "p"})
    response = asyncio.run(get_lot_lifecycle_api(request))
    assert response.status_code == 503
    assert response.headers["Retry-After"] == "1"


@pytest.mark.parametrize("exception", [BlockingIOBusyError, BlockingIOTimeoutError])
def test_notification_write_overload_has_retryable_api_response(monkeypatch, exception):
    async def fail(*_args, **_kwargs):
        raise exception("simulated")
    monkeypatch.setattr(notification_routes, "run_database_write", fail)
    request = SimpleNamespace(query_params={}, path_params={"notification_id": "n"})
    response = asyncio.run(notification_routes.mark_notification_read_api(request))
    assert response.status_code == 503
    assert response.headers["Retry-After"] == "1"
