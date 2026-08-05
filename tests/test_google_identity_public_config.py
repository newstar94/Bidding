from backend import app as app_module


def test_google_identity_is_hidden_by_default_in_development(monkeypatch):
    monkeypatch.setattr(app_module, "IS_PRODUCTION", False)
    monkeypatch.setenv("GOOGLE_CLIENT_ID", "configured-client-id")
    monkeypatch.delenv("GOOGLE_AUTH_ENABLED", raising=False)

    assert app_module._public_google_client_id() == ""


def test_google_identity_can_be_explicitly_enabled_in_development(monkeypatch):
    monkeypatch.setattr(app_module, "IS_PRODUCTION", False)
    monkeypatch.setenv("GOOGLE_CLIENT_ID", "configured-client-id")
    monkeypatch.setenv("GOOGLE_AUTH_ENABLED", "true")

    assert app_module._public_google_client_id() == "configured-client-id"


def test_google_identity_remains_enabled_by_default_in_production(monkeypatch):
    monkeypatch.setattr(app_module, "IS_PRODUCTION", True)
    monkeypatch.setenv("GOOGLE_CLIENT_ID", "configured-client-id")
    monkeypatch.delenv("GOOGLE_AUTH_ENABLED", raising=False)

    assert app_module._public_google_client_id() == "configured-client-id"
