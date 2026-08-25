import asyncio
import json
from types import SimpleNamespace

from backend.auth import auth_routes


def test_unknown_login_runs_the_same_argon2_verification_lane(monkeypatch):
    cpu_calls = []

    async def allow_rate_limit(*_args, **_kwargs):
        return SimpleNamespace(allowed=True, remaining=4)

    async def no_challenge(*_args, **_kwargs):
        return None

    async def no_user(*_args, **_kwargs):
        return None

    async def capture_cpu(function, *args, **kwargs):
        cpu_calls.append((function, args, kwargs))
        return False, None

    class Request:
        headers = {}
        client = SimpleNamespace(host="127.0.0.1")

        async def json(self):
            return {
                "username": "unknown-user",
                "password": "valid-shape-password",
                "remember": False,
            }

    monkeypatch.setattr(auth_routes, "run_database_write", allow_rate_limit)
    monkeypatch.setattr(auth_routes, "enforce_turnstile", no_challenge)
    monkeypatch.setattr(auth_routes, "run_database_read", no_user)
    monkeypatch.setattr(auth_routes, "run_cpu_bound", capture_cpu)
    monkeypatch.setattr(auth_routes, "_record_failed_login", lambda *_args: None)

    response = asyncio.run(auth_routes.login_api(Request()))

    assert response.status_code == 400
    assert json.loads(response.body)["error"] == "Tên đăng nhập hoặc mật khẩu không đúng"
    assert len(cpu_calls) == 1
    assert cpu_calls[0][0] is auth_routes._verify_and_maybe_rehash
    assert cpu_calls[0][1][0] == auth_routes._DUMMY_LOGIN_PASSWORD_HASH
