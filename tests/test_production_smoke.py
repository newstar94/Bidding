"""Contract tests for the versioned, fail-closed deployment smoke runner."""

from __future__ import annotations

import pytest

from deploy.scripts import production_smoke

EXPECTED_RELEASE_ID = "a" * 64


def _patch_runner(monkeypatch, *, live_status=200, login_status=200):
    """Provide deterministic HTTP responses without a platform HTTP server."""

    calls = []

    def fake_request(self, *, method, path, body=None, headers=None, authenticated=True):
        del self, body, headers
        calls.append((method, path, authenticated))
        if path == "/health/live":
            return production_smoke.ResponseSnapshot(live_status, "application/json", b"{}")
        if path == "/health/ready":
            return production_smoke.ResponseSnapshot(200, "application/json", b"{}")
        if path == "/api/auth/login":
            if login_status != 200:
                return production_smoke.ResponseSnapshot(
                    login_status, "application/json", b'{"error":"password-not-echoed"}'
                )
            return production_smoke.ResponseSnapshot(
                200, "application/json", b'{"success":true}'
            )
        if path == "/api/auth/check-session":
            return production_smoke.ResponseSnapshot(200, "application/json", b'{"valid":true}')
        if path == "/api/admin/system/version":
            return production_smoke.ResponseSnapshot(
                200, "application/json", (f'{{"releaseId":"{EXPECTED_RELEASE_ID}"}}').encode()
            )
        if path.startswith("/api/record") or path == "/api/sync-version":
            return production_smoke.ResponseSnapshot(200, "application/json", b"{}")
        if path == "/word":
            return production_smoke.ResponseSnapshot(
                200,
                "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
                b"PK-word",
            )
        if path == "/excel":
            return production_smoke.ResponseSnapshot(
                200,
                "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
                b"PK-excel",
            )
        if path == "/api/private":
            return production_smoke.ResponseSnapshot(403, "application/json", b'{"error":"auth"}')
        raise AssertionError(f"unexpected smoke path: {path}")

    monkeypatch.setattr(production_smoke.SmokeRunner, "request", fake_request)
    return calls


def _set_required_env(monkeypatch):
    monkeypatch.setenv("SMOKE_USERNAME", "fixture-user")
    monkeypatch.setenv("SMOKE_PASSWORD", "fixture-password-not-for-output")
    monkeypatch.setenv("SMOKE_READ_PATH", "/api/record?table=goi_thau&id=fixture")
    monkeypatch.setenv("SMOKE_EXPECTED_RELEASE_ID", EXPECTED_RELEASE_ID)


def test_tunnel_smoke_checks_private_health_locally_without_credentials(monkeypatch):
    _set_required_env(monkeypatch)
    _patch_runner(monkeypatch)
    original_request = production_smoke.SmokeRunner.request
    calls = []

    def tunnel_request(self, **kwargs):
        calls.append((self.base_url, kwargs["path"], kwargs.get("authenticated", True), self.cookie_value))
        if kwargs["path"].startswith("/health/"):
            assert kwargs["headers"] == {"Host": "app.example.invalid"}
        if kwargs["path"].startswith("/health/") and self.base_url != "http://127.0.0.1:8080":
            return production_smoke.ResponseSnapshot(403, "text/html", b"")
        return original_request(self, **kwargs)

    monkeypatch.setattr(production_smoke.SmokeRunner, "request", tunnel_request)
    monkeypatch.setenv("SMOKE_HEALTH_BASE_URL", "http://127.0.0.1:8080")

    assert production_smoke.main(["https://app.example.invalid"]) == 0
    health_calls = [call for call in calls if call[1].startswith("/health/")]
    assert len(health_calls) == 2
    assert all(origin == "http://127.0.0.1:8080" and not authenticated and cookie is None
               for origin, _path, authenticated, cookie in health_calls)
    assert all(origin == "https://app.example.invalid" for origin, path, _auth, _cookie in calls
               if not path.startswith("/health/"))


@pytest.mark.parametrize("origin", [
    "http://10.0.0.1:8080", "https://example.invalid", "http://localhost:8080", "http://127.0.0.1:8080/prefix",
    "http://127.0.0.1:8080?token=value",
])
def test_private_health_origin_rejects_non_numeric_loopback_or_non_origin_values(monkeypatch, origin):
    _set_required_env(monkeypatch)
    _patch_runner(monkeypatch)
    monkeypatch.setenv("SMOKE_HEALTH_BASE_URL", origin)

    assert production_smoke.main(["https://app.example.invalid"]) == 2


def test_requires_credentials_and_read_path(monkeypatch, capsys):
    monkeypatch.delenv("SMOKE_USERNAME", raising=False)
    monkeypatch.delenv("SMOKE_PASSWORD", raising=False)
    monkeypatch.delenv("SMOKE_COOKIE_FILE", raising=False)
    monkeypatch.delenv("SMOKE_READ_PATH", raising=False)
    monkeypatch.delenv("SMOKE_EXPECTED_RELEASE_ID", raising=False)

    result = production_smoke.main([])

    assert result == 2
    assert "fixture-password" not in capsys.readouterr().err


def test_rejects_non_https_outside_test_hosts(monkeypatch):
    _set_required_env(monkeypatch)

    assert production_smoke.main(["http://example.invalid"]) == 2


def test_health_failure_is_nonzero_and_does_not_echo_secret(monkeypatch, capsys):
    calls = _patch_runner(monkeypatch, live_status=503)
    _set_required_env(monkeypatch)

    result = production_smoke.main(["http://127.0.0.1:8000"])
    output = capsys.readouterr()

    assert result == 1
    assert "fixture-password-not-for-output" not in output.out + output.err
    assert not any(path == "/api/auth/login" for _method, path, _auth in calls)


def test_success_runs_auth_read_sync_and_optional_document_probes(
    monkeypatch, tmp_path, capsys
):
    calls = _patch_runner(monkeypatch)
    _set_required_env(monkeypatch)
    monkeypatch.setenv("SMOKE_WORD_PATH", "/word")
    monkeypatch.setenv("SMOKE_EXCEL_PATH", "/excel")
    monkeypatch.setenv("SMOKE_NEGATIVE_PATH", "/api/private")
    monkeypatch.setenv("SMOKE_NEGATIVE_STATUS", "403")
    log_path = tmp_path / "smoke.jsonl"
    monkeypatch.setenv("SMOKE_LOG_FILE", str(log_path))
    result = production_smoke.main(["--mode", "rollback", "http://127.0.0.1:8000"])
    output = capsys.readouterr()

    assert result == 0
    assert "fixture-password-not-for-output" not in output.out + output.err
    methods_paths = [(method, path) for method, path, _auth in calls]
    assert ("POST", "/api/auth/login") in methods_paths
    assert ("POST", "/api/auth/check-session") in methods_paths
    assert any(
        method == "GET" and path.startswith("/api/record?")
        for method, path in methods_paths
    )
    assert ("GET", "/api/sync-version") in methods_paths
    assert ("GET", "/word") in methods_paths
    assert ("GET", "/excel") in methods_paths
    assert ("GET", "/api/private") in methods_paths
    log_text = log_path.read_text(encoding="utf-8")
    assert "fixture-password-not-for-output" not in log_text
    assert "session_token=fixture" not in log_text
    assert '"event": "complete-rollback"' in log_text


def test_login_failure_is_nonzero_without_response_body(monkeypatch, capsys):
    _patch_runner(monkeypatch, login_status=401)
    _set_required_env(monkeypatch)
    monkeypatch.setenv("SMOKE_PASSWORD", "wrong-secret-that-must-not-print")

    result = production_smoke.main(["http://127.0.0.1:8000"])
    output = capsys.readouterr()

    assert result == 1
    assert "wrong-secret-that-must-not-print" not in output.out + output.err
    assert "password-not-echoed" not in output.out + output.err


def test_requires_expected_release_identity(monkeypatch, capsys):
    _patch_runner(monkeypatch)
    _set_required_env(monkeypatch)
    monkeypatch.delenv("SMOKE_EXPECTED_RELEASE_ID", raising=False)

    result = production_smoke.main(["http://127.0.0.1:8000"])

    assert result == 2
    assert "release" in capsys.readouterr().err.casefold()


def test_fails_when_running_release_does_not_match(monkeypatch, capsys):
    calls = _patch_runner(monkeypatch)
    _set_required_env(monkeypatch)
    monkeypatch.setenv("SMOKE_EXPECTED_RELEASE_ID", "b" * 64)

    result = production_smoke.main(["http://127.0.0.1:8000"])
    output = capsys.readouterr()

    assert result == 1
    assert any(path == "/api/admin/system/version" for _method, path, _auth in calls)
    assert "không khớp" in output.err
