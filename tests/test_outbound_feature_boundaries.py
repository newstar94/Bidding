from starlette.applications import Starlette
from starlette.routing import Route
from starlette.testclient import TestClient

from backend.bulk_operations.routes import prepare_api
from backend.procurement_cases.routes import list_cases_api
from backend.work_calendar.routes import (
    preview_calendar_api,
    start_connection_api,
    work_calendar_routes,
)


def test_case_calendar_and_bulk_flags_fail_closed_without_changing_permissions(monkeypatch):
    app = Starlette(routes=[
        Route("/cases", list_cases_api, methods=["GET"]),
        Route("/calendar", preview_calendar_api, methods=["POST"]),
        Route("/bulk", prepare_api, methods=["POST"]),
    ])
    client = TestClient(app)
    monkeypatch.setenv("PROCUREMENT_CASE_ENABLED", "false")
    monkeypatch.setenv("WORK_CALENDAR_ICS_ENABLED", "false")
    monkeypatch.setenv("BULK_EXPORT_ENABLED", "false")
    assert client.get("/cases").status_code == 404
    assert client.post("/calendar", json={"sourceItems": []}).status_code == 404
    assert client.post("/bulk", json={}).status_code == 404

    monkeypatch.setenv("PROCUREMENT_CASE_ENABLED", "true")
    monkeypatch.setenv("WORK_CALENDAR_ICS_ENABLED", "true")
    monkeypatch.setenv("BULK_EXPORT_ENABLED", "true")
    assert client.get("/cases").status_code == 403
    assert client.post("/calendar", json={"sourceItems": []}).status_code == 403
    assert client.post("/bulk", json={}).status_code == 403


def test_calendar_connector_master_and_provider_kill_switches_fail_closed(monkeypatch):
    app = Starlette(routes=[
        Route("/connect", start_connection_api, methods=["POST"]),
    ])
    client = TestClient(app)
    payload = {"provider": "GOOGLE", "calendarId": "primary"}
    monkeypatch.setenv("WORK_CALENDAR_ICS_ENABLED", "true")
    monkeypatch.setenv("WORK_CALENDAR_CONNECTORS_ENABLED", "false")
    monkeypatch.setenv("WORK_CALENDAR_GOOGLE_ENABLED", "true")
    assert client.post("/connect", json=payload).status_code == 404

    monkeypatch.setenv("WORK_CALENDAR_CONNECTORS_ENABLED", "true")
    monkeypatch.setenv("WORK_CALENDAR_GOOGLE_ENABLED", "false")
    assert client.post("/connect", json=payload).status_code == 404

    monkeypatch.setenv("WORK_CALENDAR_GOOGLE_ENABLED", "true")
    assert client.post("/connect", json=payload).status_code == 403


def test_work_calendar_routes_publish_one_way_connector_contract():
    routes = {route.path: route.methods for route in work_calendar_routes(Route)}
    assert routes["/api/work-calendar/connections"] == {"GET", "HEAD"}
    assert routes["/api/work-calendar/connections/start"] == {"POST"}
    assert routes[
        "/api/work-calendar/connections/{provider}/callback"
    ] == {"GET", "HEAD"}
    assert routes[
        "/api/work-calendar/connections/{connection_id}/revoke"
    ] == {"POST"}
    assert routes["/api/work-calendar/deliveries/enqueue"] == {"POST"}
    assert routes["/api/work-calendar/deliveries"] == {"GET", "HEAD"}
    assert routes[
        "/api/work-calendar/deliveries/{delivery_id}/retry"
    ] == {"POST"}
