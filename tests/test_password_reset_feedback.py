import asyncio
import json
from types import SimpleNamespace


def _request_password_reset(monkeypatch, reset_request):
    from backend.auth import otp_routes

    async def allow_rate_limit(*_args, **_kwargs):
        return SimpleNamespace(allowed=True, remaining=4)

    async def allow_turnstile(*_args, **_kwargs):
        return None

    async def create_reset(*_args, **_kwargs):
        return reset_request

    class Request:
        headers = {}
        client = SimpleNamespace(host="127.0.0.1")

        async def json(self):
            return {
                "username": "nguyenvana",
                "email": "nguyenvana@example.vn",
            }

    monkeypatch.setattr(otp_routes, "_rate_limit_decision", allow_rate_limit)
    monkeypatch.setattr(otp_routes, "enforce_turnstile", allow_turnstile)
    monkeypatch.setattr(otp_routes, "run_database_write", create_reset)
    return asyncio.run(otp_routes.forgot_password_api(Request()))


def test_password_reset_does_not_reveal_mismatched_account_details(monkeypatch):
    response = _request_password_reset(monkeypatch, None)

    assert response.status_code == 200
    assert json.loads(response.body) == {
        "success": True,
        "message": (
            "Đã gửi email hướng dẫn đặt lại mật khẩu. "
            "Vui lòng kiểm tra hộp thư đến hoặc thư rác."
        ),
    }
    assert response.background is None


def test_password_reset_confirms_email_was_sent(monkeypatch):
    response = _request_password_reset(
        monkeypatch,
        {
            "token": "reset-token",
            "email": "nguyenvana@example.vn",
            "name": "Nguyễn Văn A",
            "username": "nguyenvana",
        },
    )

    assert response.status_code == 200
    assert json.loads(response.body) == {
        "success": True,
        "message": (
            "Đã gửi email hướng dẫn đặt lại mật khẩu. "
            "Vui lòng kiểm tra hộp thư đến hoặc thư rác."
        ),
    }
    assert len(response.background.tasks) == 1
