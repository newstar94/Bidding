from types import SimpleNamespace

import pytest

from backend.product_analytics import routes


class _Connection:
    def __init__(self):
        self.cursor_value = object()
        self.events = []

    def execute(self, statement):
        self.events.append(("execute", statement))

    def cursor(self):
        return self.cursor_value

    def commit(self):
        self.events.append(("commit",))

    def rollback(self):
        self.events.append(("rollback",))

    def close(self):
        self.events.append(("close",))


def _request():
    return SimpleNamespace(
        cookies={"session_token": "request-token"},
        headers={},
        method="POST",
        client=SimpleNamespace(host="127.0.0.1"),
    )


def test_refresh_stops_when_transactional_admin_authority_is_revoked(monkeypatch):
    connection = _Connection()
    refreshed = []
    monkeypatch.setattr(routes.database, "get_connection", lambda: connection)
    monkeypatch.setattr(
        routes,
        "verify_session_in_transaction",
        lambda *_args, **_kwargs: (False, "step-up expired"),
    )
    monkeypatch.setattr(
        routes,
        "refresh_product_analytics",
        lambda *_args, **_kwargs: refreshed.append(True),
    )

    with pytest.raises(routes._RefreshAuthorityError, match="step-up expired"):
        routes._refresh_write(
            _request(), "actor-1", "2026-01-01", "2026-03-31"
        )

    assert ("rollback",) in connection.events
    assert refreshed == []


def test_refresh_and_safe_audit_share_the_authorized_transaction(monkeypatch):
    connection = _Connection()
    actor = SimpleNamespace(user_id="actor-1")
    audits = []
    monkeypatch.setattr(routes.database, "get_connection", lambda: connection)
    monkeypatch.setattr(
        routes,
        "verify_session_in_transaction",
        lambda cursor, *_args, **_kwargs: (True, actor),
    )
    monkeypatch.setattr(
        routes,
        "refresh_product_analytics",
        lambda cursor, **_kwargs: {"rows": 12},
    )
    monkeypatch.setattr(
        routes,
        "log_audit",
        lambda action, **kwargs: audits.append((action, kwargs)),
    )

    result = routes._refresh_write(
        _request(), "actor-1", "2026-01-01", "2026-03-31"
    )

    assert result == {"rows": 12}
    assert ("commit",) in connection.events
    assert audits == [
        (
            "admin.product_analytics_refreshed",
            {
                "actor_user_id": "actor-1",
                "target_type": "product_analytics",
                "target_id": "2026-01-01:2026-03-31",
                "request": audits[0][1]["request"],
                "metadata": {
                    "fromDate": "2026-01-01",
                    "toDate": "2026-03-31",
                },
                "cursor": connection.cursor_value,
                "required": True,
            },
        )
    ]
