import json
from types import SimpleNamespace

from backend.api import org_routes
from backend.auth import admin_user_routes, auth_service
from backend.billing import routes as billing_routes
from backend.shared.access_policy import resolve_document_export_capabilities
from tests.test_document_export_entitlements import _database


def test_access_payload_projects_trial_entitlements_for_accessible_workspaces(
    monkeypatch,
):
    organization = {
        "id": "org-1",
        "name": "Organization",
        "scope_type": "organization",
        "role": "employee",
        "status": "active",
        "subscription": None,
        "entitlements": {
            "word_export": False,
            "excel_export": False,
            "award_result_excel_export": False,
            "source": "organization_subscription",
        },
    }
    personal = {
        "id": "personal:user-1",
        "name": "Personal",
        "scope_type": "personal",
        "role": "owner",
        "status": "active",
        "subscription": None,
        "entitlements": {
            "word_export": False,
            "excel_export": False,
            "award_result_excel_export": False,
            "source": "account_subscription",
        },
    }
    monkeypatch.setenv("TRIAL_FULL_ACCESS_ENABLED", "true")
    monkeypatch.setattr(
        auth_service, "get_user_organizations", lambda _cursor, _user_id: [organization]
    )
    monkeypatch.setattr(auth_service, "get_account_subscription", lambda *_args: None)
    monkeypatch.setattr(
        auth_service, "personal_workspace_payload", lambda *_args: personal
    )
    from backend.documents import word_defaults

    monkeypatch.setattr(
        word_defaults, "ensure_personal_word_workspace", lambda *_args: None
    )

    payload = auth_service.build_user_access_payload(
        object(), "user-1", "user", active_org_hint="org-1"
    )

    expected = {
        "word_export": True,
        "excel_export": True,
        "award_result_excel_export": True,
        "source": "trial_full_access",
    }
    assert payload["entitlements"] == expected
    assert all(item["entitlements"] == expected for item in payload["organizations"])
    assert payload["active_org_id"] == "org-1"
    assert payload["membership_role"] == "employee"


def test_trial_member_quota_bypass_does_not_read_commercial_subscription(
    monkeypatch,
):
    monkeypatch.setenv("TRIAL_FULL_ACCESS_ENABLED", "true")

    def fail_if_quota_is_read(*_args):
        raise AssertionError("Trial member mutations must not enforce package quota")

    monkeypatch.setattr(
        org_routes, "_lock_organization_member_quota", fail_if_quota_is_read
    )

    assert org_routes._organization_member_quota_error(object(), "org-1") is None


def test_normal_member_quota_contract_is_preserved(monkeypatch):
    monkeypatch.setenv("TRIAL_FULL_ACCESS_ENABLED", "false")
    monkeypatch.setattr(
        org_routes,
        "_lock_organization_member_quota",
        lambda *_args: (
            {
                "status": "active",
                "organization_status": "active",
                "package_status": "active",
                "expires_at": None,
                "member_quota": 2,
            },
            2,
        ),
    )

    response = org_routes._organization_member_quota_error(object(), "org-1")

    assert response.status_code == 409
    assert json.loads(response.body)["code"] == "ORG_MEMBER_QUOTA_EXCEEDED"


def test_trial_grants_every_word_field_family_only_to_an_authorized_member(
    monkeypatch,
):
    monkeypatch.setenv("TRIAL_FULL_ACCESS_ENABLED", "true")
    connection = _database(word=0, excel=0, award=0)
    try:
        cursor = connection.cursor()
        allowed = resolve_document_export_capabilities(
            cursor, "employee", "employee", "org"
        )
        denied = resolve_document_export_capabilities(
            cursor, "employee", "outsider", "org"
        )

        assert allowed.as_dict() == {
            "financial": True,
            "identity": True,
            "signature": True,
        }
        assert denied.as_dict() == {
            "financial": False,
            "identity": False,
            "signature": False,
        }
    finally:
        connection.close()


def test_trial_disables_fake_checkout_surface(monkeypatch):
    monkeypatch.setenv("APP_ENV", "development")
    monkeypatch.setenv("TRIAL_FULL_ACCESS_ENABLED", "true")
    assert billing_routes._fake_checkout_environment_allowed() is False

    monkeypatch.setenv("TRIAL_FULL_ACCESS_ENABLED", "false")
    assert billing_routes._fake_checkout_environment_allowed() is True


def test_index_bootstrap_exposes_trial_flag_without_leaking_placeholder(monkeypatch):
    from backend import app as app_module

    monkeypatch.setenv("TRIAL_FULL_ACCESS_ENABLED", "true")
    monkeypatch.setattr(app_module, "_compiled_html_cache", None)
    monkeypatch.setattr(app_module, "_compiled_html_cache_signature", None)
    monkeypatch.setattr(app_module, "_index_response_cache", None)
    monkeypatch.setattr(app_module, "IS_PRODUCTION", False)
    monkeypatch.setattr(app_module, "APP_DEBUG", True)

    html_content, _etag = app_module._build_index_response_payload()

    assert 'data-trial-full-access="true"' in html_content
    assert "__TRIAL_FULL_ACCESS_ENABLED__" not in html_content


def test_trial_role_update_does_not_mutate_hidden_commercial_settings(monkeypatch):
    class Cursor:
        def __init__(self):
            self.statements = []
            self.last_statement = ""

        def execute(self, statement, parameters=()):
            self.last_statement = " ".join(str(statement).split())
            self.statements.append((self.last_statement, parameters))
            return self

        def fetchone(self):
            if "SELECT vai_tro, email, ho_ten" in self.last_statement:
                return ("user", "user@example.test", "User")
            if "SELECT lower(trim(vai_tro_trong_to_chuc))" in self.last_statement:
                return ("employee",)
            return None

    class Connection:
        def __init__(self):
            self.cursor_instance = Cursor()
            self.committed = False

        def execute(self, statement, parameters=()):
            return self.cursor_instance.execute(statement, parameters)

        def cursor(self):
            return self.cursor_instance

        def commit(self):
            self.committed = True

        def rollback(self):
            pass

        def close(self):
            pass

    connection = Connection()
    monkeypatch.setenv("TRIAL_FULL_ACCESS_ENABLED", "true")
    monkeypatch.setattr(
        admin_user_routes.database, "get_connection", lambda: connection
    )
    monkeypatch.setattr(
        admin_user_routes,
        "verify_session_in_transaction",
        lambda *_args, **_kwargs: (True, SimpleNamespace(user_id="admin")),
    )
    monkeypatch.setattr(
        admin_user_routes, "lock_platform_role_invariants", lambda *_args: None
    )
    monkeypatch.setattr(
        admin_user_routes,
        "lock_organization_membership_invariants",
        lambda *_args: None,
    )
    monkeypatch.setattr(admin_user_routes, "log_audit", lambda *_args, **_kwargs: None)
    monkeypatch.setattr(
        admin_user_routes, "enqueue_websocket_event", lambda *_args, **_kwargs: None
    )
    monkeypatch.setattr(
        admin_user_routes, "revoke_user_sessions", lambda *_args, **_kwargs: None
    )

    response = admin_user_routes._update_user_access_settings_sync(
        SimpleNamespace(),
        "admin",
        {
            "user_id": "user",
            "platform_role": "user",
            "account_package_id": "none",
            "organization_id": "org",
            "organization_role": "employee",
            "organization_package_id": "none",
            "document_capabilities": {
                "financial": False,
                "identity": False,
                "signature": False,
            },
        },
    )

    sql = "\n".join(statement for statement, _params in connection.cursor_instance.statements)
    assert response.status_code == 200
    assert connection.committed
    assert "UPDATE tai_khoan SET vai_tro" in sql
    assert "UPDATE thanh_vien_to_chuc" in sql
    assert "account_subscriptions" not in sql
    assert "organization_subscriptions" not in sql
    assert "document_export_capabilities" not in sql
