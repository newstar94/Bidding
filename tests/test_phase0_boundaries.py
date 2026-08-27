import asyncio
import json
import threading
from types import SimpleNamespace

from backend import app as app_module
from backend.sync.conflict_projection import project_conflict_record


def _response_payload(response):
    return json.loads(response.body.decode("utf-8"))


def _request(*, startup_complete=True, ready=True, readiness_reason=None):
    return SimpleNamespace(
        app=SimpleNamespace(
            state=SimpleNamespace(
                startup_complete=startup_complete,
                ready=ready,
                readiness_reason=readiness_reason,
                event_loop_lag_ms=0.0,
            )
        )
    )


def test_index_session_bootstrap_does_not_block_event_loop(monkeypatch):
    release_bootstrap = threading.Event()
    bootstrap_observed_release = []

    def blocking_session_bootstrap(_request):
        bootstrap_observed_release.append(release_bootstrap.wait(timeout=0.25))
        return {"valid": False, "reason": "missing_auth"}

    monkeypatch.setattr(app_module, "IS_PRODUCTION", False)
    monkeypatch.setattr(
        app_module,
        "_build_index_response_payload",
        lambda: ("__BF_SESSION_BOOTSTRAP__", '"test-etag"'),
    )
    monkeypatch.setattr(
        app_module,
        "build_session_bootstrap",
        blocking_session_bootstrap,
    )

    async def run_index_with_heartbeat():
        request = SimpleNamespace(
            cookies={},
            headers={},
            url=SimpleNamespace(path="/tong-quan-admin"),
        )
        index_task = asyncio.create_task(app_module.index(request))
        await asyncio.sleep(0)
        release_bootstrap.set()
        await index_task

    asyncio.run(run_index_with_heartbeat())

    assert bootstrap_observed_release == [True]


def test_health_ready_reports_bounded_startup_and_audit_reasons(monkeypatch):
    async def database_ok(*_args, **_kwargs):
        return None

    monkeypatch.setattr(app_module, "run_database_read", database_ok)

    startup_response = asyncio.run(
        app_module.health_ready_api(_request(startup_complete=False))
    )
    invalid_response = asyncio.run(
        app_module.health_ready_api(
            _request(ready=False, readiness_reason="AUDIT_CHAIN_INVALID")
        )
    )
    verifier_response = asyncio.run(
        app_module.health_ready_api(
            _request(ready=False, readiness_reason="AUDIT_VERIFIER_ERROR")
        )
    )

    assert startup_response.status_code == 503
    assert _response_payload(startup_response) == {
        "status": "not_ready",
        "reason": "STARTUP_INCOMPLETE",
    }
    assert invalid_response.status_code == 503
    assert _response_payload(invalid_response) == {
        "status": "not_ready",
        "reason": "AUDIT_CHAIN_INVALID",
    }
    assert verifier_response.status_code == 503
    assert _response_payload(verifier_response) == {
        "status": "not_ready",
        "reason": "AUDIT_VERIFIER_ERROR",
    }


def test_health_ready_reports_database_failure_without_internal_details(monkeypatch):
    async def database_fails(*_args, **_kwargs):
        raise RuntimeError("postgresql://secret@db/internal SQL")

    monkeypatch.setattr(app_module, "run_database_read", database_fails)

    response = asyncio.run(app_module.health_ready_api(_request()))
    payload = _response_payload(response)

    assert response.status_code == 503
    assert payload == {
        "status": "not_ready",
        "reason": "DATABASE_UNAVAILABLE",
    }
    assert "secret" not in response.body.decode("utf-8")
    assert "SQL" not in response.body.decode("utf-8")


def test_health_ready_and_live_remain_distinct(monkeypatch):
    async def database_ok(*_args, **_kwargs):
        return None

    monkeypatch.setattr(app_module, "run_database_read", database_ok)

    ready_response = asyncio.run(app_module.health_ready_api(_request()))
    live_response = asyncio.run(app_module.health_live_api(_request(ready=False)))

    assert ready_response.status_code == 200
    assert _response_payload(ready_response) == {"status": "ready"}
    assert live_response.status_code == 200
    assert _response_payload(live_response) == {"status": "live"}


def test_conflict_projection_keeps_business_data_and_removes_internal_secrets():
    projected = project_conflict_record(
        {
            "id": "contractor-1",
            "soTaiKhoan": "0123456789",
            "maNganHang": "VCB",
            "soCCCD": "001234567890",
            "anhChuKy": "/api/images/signature.png",
            "sessionToken": "must-not-leak",
            "passwordHash": "must-not-leak",
            "internalSecret": "must-not-leak",
        }
    )

    assert projected == {
        "id": "contractor-1",
        "soTaiKhoan": "0123456789",
        "maNganHang": "VCB",
        "soCCCD": "001234567890",
        "anhChuKy": "/api/images/signature.png",
    }
