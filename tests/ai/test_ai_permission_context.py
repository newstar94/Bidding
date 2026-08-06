from types import SimpleNamespace

from backend.ai import permission_context


class _Cursor:
    def execute(self, _statement, _parameters=()):
        return self

    def fetchone(self):
        return ("HTD",)


class _Connection:
    def cursor(self):
        return _Cursor()

    def close(self):
        return None


def test_manager_context_can_read_shared_reference_modules(monkeypatch):
    request = SimpleNamespace(state=SimpleNamespace())
    session = SimpleNamespace(user_id="manager-1", platform_role="user", active_role="manager")

    monkeypatch.setattr(permission_context, "verify_session", lambda _request: (True, session))
    monkeypatch.setattr(
        permission_context,
        "get_active_org",
        lambda target, *_args, **_kwargs: (
            setattr(target.state, "organization_context", SimpleNamespace(membership_role="manager", scope_type="organization"))
            or "org-1"
        ),
    )
    monkeypatch.setattr(permission_context.database, "get_connection", lambda: _Connection())
    monkeypatch.setattr(permission_context, "has_module_permission", lambda *_args, **_kwargs: False)
    monkeypatch.setattr(permission_context, "is_personal_scope_for_user", lambda *_args: False)

    context = permission_context.build_request_context(request)

    assert permission_context.MODULES["investors"] == "chudautu"
    assert context.permissions["chudautu"]
    assert context.permissions["nhathau"]
