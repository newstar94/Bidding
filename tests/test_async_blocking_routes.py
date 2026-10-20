"""Async routes must keep PostgreSQL round-trips off the event loop."""

import asyncio
import importlib.util
from pathlib import Path
from threading import get_ident
from types import SimpleNamespace

from backend import app as app_module
from backend.auth import auth_routes, otp_routes
from backend.product_analytics import routes as analytics_routes
from backend.shared.async_io import BlockingIOBusyError


ROOT = Path(__file__).resolve().parents[1]


def _load_checker():
    spec = importlib.util.spec_from_file_location(
        "check_async_blocking", ROOT / "scripts" / "check_async_blocking.py"
    )
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


def test_backend_has_no_inline_blocking_calls_in_async_functions():
    checker = _load_checker()
    assert checker.scan(sorted((ROOT / "backend").rglob("*.py"))) == []


def test_checker_flags_inline_database_access(tmp_path):
    checker = _load_checker()
    sample = tmp_path / "sample.py"
    sample.write_text(
        "async def handler(request):\n"
        "    conn = database.get_connection()\n"
        "    ok, role = verify_session(request)\n"
        "    log_audit('x', request=request)\n"
        "    log_audit('y', cursor=cursor, required=True)\n"
        "    await run_database_read(verify_session, request)\n",
        encoding="utf-8",
    )
    checker.ROOT = tmp_path
    hits = checker.scan([sample])
    assert len(hits) == 3
    assert any("get_connection" in hit for hit in hits)
    assert any("verify_session" in hit for hit in hits)
    assert any("log_audit" in hit for hit in hits)


class _RecordingConnection:
    def __init__(self, thread_ids):
        self.thread_ids = thread_ids
        self.in_transaction = False

    def cursor(self):
        return self

    def commit(self):
        self.thread_ids.append(("commit", get_ident()))

    def rollback(self):
        pass

    def close(self):
        pass


def test_logout_revokes_session_on_database_lane(monkeypatch):
    thread_ids = []

    def connect():
        thread_ids.append(("connect", get_ident()))
        return _RecordingConnection(thread_ids)

    monkeypatch.setattr(auth_routes, "database", SimpleNamespace(get_connection=connect))
    monkeypatch.setattr(auth_routes, "revoke_session", lambda cursor, token: "user-1")
    monkeypatch.setattr(auth_routes, "log_audit", lambda *args, **kwargs: None)
    monkeypatch.setattr(auth_routes, "disconnect_user_websockets", lambda user_id: None)

    async def scenario():
        request = SimpleNamespace(cookies={"session_token": "token-1"})
        response = await auth_routes.logout_api(request)
        return get_ident(), response

    loop_thread, response = asyncio.run(scenario())
    assert response.status_code == 200
    assert thread_ids and all(thread != loop_thread for _, thread in thread_ids)


def test_update_profile_verifies_session_off_event_loop(monkeypatch):
    seen = []

    def verify(request, **kwargs):
        seen.append(get_ident())
        return False, "Phiên làm việc đã hết hạn hoặc không hợp lệ!"

    monkeypatch.setattr(auth_routes, "verify_session", verify)

    async def scenario():
        response = await auth_routes.update_profile_api(SimpleNamespace(cookies={}))
        return get_ident(), response

    loop_thread, response = asyncio.run(scenario())
    assert response.status_code == 403
    assert seen and seen[0] != loop_thread


def test_change_password_lane_overload_returns_503(monkeypatch):
    async def busy(*_args, **_kwargs):
        raise BlockingIOBusyError("read lane full")

    monkeypatch.setattr(auth_routes, "run_database_read", busy)
    response = asyncio.run(auth_routes.change_password_api(SimpleNamespace(cookies={})))
    assert response.status_code == 503
    assert response.headers["Retry-After"] == "1"


def test_verify_email_otp_check_runs_on_database_lane(monkeypatch):
    thread_ids = []

    class Cursor:
        def execute(self, *_args):
            thread_ids.append(get_ident())
            return self

        def fetchone(self):
            return None

    class Connection:
        def cursor(self):
            return Cursor()

        def close(self):
            pass

    async def read_json(_request):
        return {"username": "alice", "code": "123456"}, None

    async def allow(*_args, **_kwargs):
        return SimpleNamespace(allowed=True)

    async def no_challenge(*_args, **_kwargs):
        return None

    monkeypatch.setattr(otp_routes, "database", SimpleNamespace(get_connection=Connection))
    monkeypatch.setattr(otp_routes, "read_json_object", read_json)
    monkeypatch.setattr(otp_routes, "_rate_limit_decision", allow)
    monkeypatch.setattr(otp_routes, "enforce_turnstile", no_challenge)
    monkeypatch.setattr(otp_routes, "get_client_ip", lambda _request: "127.0.0.1")

    async def scenario():
        response = await otp_routes.verify_email_api(SimpleNamespace())
        return get_ident(), response

    loop_thread, response = asyncio.run(scenario())
    assert response.status_code == 400
    assert thread_ids and all(thread != loop_thread for thread in thread_ids)


def test_protected_image_authorization_runs_on_database_lane(monkeypatch):
    seen = []

    def verify(_request):
        seen.append(get_ident())
        return False, "Thiếu thông tin xác thực phiên làm việc!"

    monkeypatch.setattr(app_module, "verify_session", verify)

    async def scenario():
        request = SimpleNamespace(path_params={"file_path": "nha_thau/x.png"})
        response = await app_module.protected_image_api(request)
        return get_ident(), response

    loop_thread, response = asyncio.run(scenario())
    assert response.status_code == 403
    assert seen and seen[0] != loop_thread


def test_commercial_event_lane_overload_stays_best_effort(monkeypatch):
    async def read(*_args, **_kwargs):
        return True, SimpleNamespace(user_id="user-1")

    async def busy(*_args, **_kwargs):
        raise BlockingIOBusyError("write lane full")

    async def read_json(_request):
        return {"event": "x"}, None

    monkeypatch.setenv("ANALYTICS_HMAC_KEY", "k" * 32)
    monkeypatch.setattr(analytics_routes, "run_database_read", read)
    monkeypatch.setattr(analytics_routes, "run_database_write", busy)
    monkeypatch.setattr(analytics_routes, "read_json_object", read_json)
    response = asyncio.run(analytics_routes.commercial_analytics_event_api(SimpleNamespace()))
    assert response.status_code == 202
