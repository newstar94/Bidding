from types import SimpleNamespace
from concurrent.futures import ThreadPoolExecutor
from pathlib import Path

from backend.auth import auth_service
from backend.db.db_helper import SQLiteDatabase
from backend.shared.client_ip import (
    get_client_ip,
    is_client_ip_allowed,
    is_request_secure,
)


def _request(peer, forwarded=None):
    headers = {}
    if forwarded is not None:
        headers["X-Forwarded-For"] = forwarded
    return SimpleNamespace(
        client=SimpleNamespace(host=peer),
        headers=headers,
    )


def _rate_limit_database(path):
    database = SQLiteDatabase(path)
    conn = database.get_connection()
    try:
        conn.execute(
            """
            CREATE TABLE rate_limit_buckets (
                bucket_key TEXT PRIMARY KEY,
                window_started_at INTEGER NOT NULL,
                attempt_count INTEGER NOT NULL,
                expires_at INTEGER NOT NULL
            )
            """
        )
        conn.commit()
    finally:
        conn.close()
    return database


def test_untrusted_peer_cannot_spoof_forwarded_ip(monkeypatch):
    monkeypatch.setenv("TRUSTED_PROXY_CIDRS", "10.0.0.0/8")

    client_ip = get_client_ip(_request("203.0.113.20", "127.0.0.1"))

    assert client_ip == "203.0.113.20"


def test_trusted_proxy_chain_returns_first_untrusted_hop(monkeypatch):
    monkeypatch.setenv("TRUSTED_PROXY_CIDRS", "10.0.0.0/8,192.168.10.0/24")

    client_ip = get_client_ip(
        _request("10.0.0.5", "198.51.100.7, 192.168.10.8")
    )

    assert client_ip == "198.51.100.7"


def test_malformed_forwarded_chain_fails_closed_to_peer(monkeypatch):
    monkeypatch.setenv("TRUSTED_PROXY_CIDRS", "10.0.0.0/8")

    client_ip = get_client_ip(_request("10.0.0.5", "not-an-ip, 127.0.0.1"))

    assert client_ip == "10.0.0.5"


def test_untrusted_peer_cannot_spoof_forwarded_https(monkeypatch):
    monkeypatch.setenv("TRUSTED_PROXY_CIDRS", "10.0.0.0/8")
    request = _request("203.0.113.20", "127.0.0.1")
    request.headers["X-Forwarded-Proto"] = "https"
    request.url = SimpleNamespace(scheme="http")

    assert is_request_secure(request) is False


def test_super_admin_allowlist_supports_cidr_but_fails_closed_on_invalid_config():
    assert is_client_ip_allowed("203.0.113.25", "203.0.113.0/24") is True
    assert is_client_ip_allowed("198.51.100.7", "203.0.113.0/24") is False
    assert is_client_ip_allowed("203.0.113.25", "not-a-network") is False


def test_rate_limit_is_persistent_and_expires(monkeypatch, tmp_path):
    database_path = tmp_path / "rate-limit.db"
    database = _rate_limit_database(database_path)
    monkeypatch.setattr(auth_service, "_get_rate_limit_database", lambda: database)
    monkeypatch.setattr(auth_service.time, "time", lambda: 1000)

    assert auth_service.check_rate_limit("login:198.51.100.7", consume_attempt=False)
    assert all(
        auth_service.check_rate_limit("login:198.51.100.7")
        for _ in range(auth_service.RATE_LIMIT_MAX)
    )
    assert not auth_service.check_rate_limit("login:198.51.100.7")

    replacement_database = SQLiteDatabase(database_path)
    monkeypatch.setattr(
        auth_service,
        "_get_rate_limit_database",
        lambda: replacement_database,
    )
    assert not auth_service.check_rate_limit("login:198.51.100.7")

    monkeypatch.setattr(auth_service.time, "time", lambda: 1061)
    assert auth_service.check_rate_limit("login:198.51.100.7")

    conn = replacement_database.get_connection()
    try:
        row = conn.execute(
            "SELECT bucket_key, attempt_count FROM rate_limit_buckets"
        ).fetchone()
    finally:
        conn.close()
    assert row["bucket_key"] != "login:198.51.100.7"
    assert row["attempt_count"] == 1


def test_rate_limit_storage_failure_is_fail_closed(monkeypatch):
    class _BrokenDatabase:
        def get_connection(self):
            raise OSError("rate-limit storage unavailable")

    monkeypatch.setattr(
        auth_service,
        "_get_rate_limit_database",
        lambda: _BrokenDatabase(),
    )
    monkeypatch.setattr(
        "backend.shared.logging_utils.log_error",
        lambda *_args, **_kwargs: None,
    )

    assert not auth_service.check_rate_limit("login:203.0.113.9")


def test_concurrent_workers_share_one_atomic_limit(monkeypatch, tmp_path):
    database = _rate_limit_database(tmp_path / "concurrent-rate-limit.db")
    monkeypatch.setattr(auth_service, "_get_rate_limit_database", lambda: database)
    monkeypatch.setattr(auth_service.time, "time", lambda: 2000)

    with ThreadPoolExecutor(max_workers=12) as executor:
        allowed = list(executor.map(
            lambda _index: auth_service.check_rate_limit("login:shared-worker"),
            range(12),
        ))

    assert sum(allowed) == auth_service.RATE_LIMIT_MAX
    assert not auth_service.check_rate_limit("login:shared-worker", consume_attempt=False)


def test_rate_limit_response_has_machine_code_and_retry_after():
    decision = auth_service.RateLimitDecision(False, 17, 0)

    response = auth_service.rate_limit_response("Too many requests", decision)

    assert response.status_code == 429
    assert response.headers["retry-after"] == "17"
    assert b'"code":"rate_limit_exceeded"' in response.body


def test_nginx_baseline_overwrites_client_forwarding_headers():
    config = Path("deploy/nginx-biddingflow.conf.example").read_text(encoding="utf-8")

    assert "proxy_set_header X-Forwarded-For $remote_addr;" in config
    assert "proxy_set_header Forwarded \"\";" in config
    assert "$proxy_add_x_forwarded_for" not in config


def test_ingress_limits_match_application_request_classes():
    nginx = Path("deploy/nginx-biddingflow.conf.example").read_text(encoding="utf-8")
    service = Path("deploy/biddingflow.service.example").read_text(encoding="utf-8")

    assert "location = /api/sync" in nginx
    assert "client_max_body_size 10m;" in nginx
    assert nginx.count("client_max_body_size 11m;") == 2
    assert "client_max_body_size 64m;" not in nginx
    assert "zone=biddingflow_auth" in nginx
    assert "zone=biddingflow_api" in nginx
    assert "zone=biddingflow_sync" in nginx
    assert "zone=biddingflow_document" in nginx
    assert "zone=biddingflow_websocket" in nginx
    assert "--workers 1" in service
    assert "--limit-concurrency 128" in service
    assert "--backlog 256" in service
    assert "--timeout-graceful-shutdown 30" in service
    assert "--ws-max-size 65536" in service
