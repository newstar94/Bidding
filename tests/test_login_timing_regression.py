import asyncio
import json
from types import SimpleNamespace

from backend.auth import auth_routes


def test_unknown_login_runs_the_same_argon2_verification_lane(monkeypatch):
    cpu_calls = []

    async def allow_rate_limit(function, *_args, **_kwargs):
        decision = SimpleNamespace(allowed=True, remaining=4)
        if function is auth_routes._load_login_user_with_rate_limit:
            return decision, None
        return decision

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


def test_account_rate_limit_and_user_lookup_share_one_database_connection(monkeypatch):
    connections = []
    account = {
        "id": "user-1",
        "ten_dang_nhap": "tester",
        "mat_khau": "password-hash",
        "ho_ten": "Test User",
        "vai_tro": "user",
        "email": "tester@example.com",
        "anh_dai_dien": None,
        "da_xac_minh": True,
    }

    class Cursor:
        def __init__(self):
            self.result = None
            self.statements = []

        def execute(self, statement, _parameters=()):
            normalized = " ".join(str(statement).split())
            self.statements.append(normalized)
            self.result = (1, 4_000_000_000) if "rate_limit_buckets" in normalized else account
            return self

        def fetchone(self):
            return self.result

    class Connection:
        def __init__(self):
            self.cursor_instance = Cursor()
            self.committed = False
            self.closed = False

        def execute(self, statement, parameters=()):
            return self.cursor_instance.execute(statement, parameters)

        def cursor(self):
            return self.cursor_instance

        def commit(self):
            self.committed = True

        def rollback(self):
            pass

        def close(self):
            self.closed = True

    class Database:
        def get_connection(self):
            connection = Connection()
            connections.append(connection)
            return connection

    monkeypatch.setattr(auth_routes, "database", Database())

    decision, user = auth_routes._load_login_user_with_rate_limit(
        "tester",
        "login_user:opaque",
    )

    assert decision.allowed is True
    assert user == account
    assert len(connections) == 1
    assert connections[0].committed is True
    assert connections[0].closed is True
    assert len(connections[0].cursor_instance.statements) == 2
