"""ADR 0095: public business profile and recorded legal consent."""

import asyncio
import json
from types import SimpleNamespace

import pytest

from backend.auth import legal_consent, otp_routes
from backend.business_profile import routes as profile_routes
from backend.business_profile import store


@pytest.fixture
def profile_file(tmp_path, monkeypatch):
    path = tmp_path / "nested" / "business_profile.json"
    monkeypatch.setenv("BUSINESS_PROFILE_FILE", str(path))
    store._cache.update(signature=None, data=None)
    yield path
    store._cache.update(signature=None, data=None)


def test_missing_profile_reads_as_empty_and_unconfigured(profile_file):
    profile = store.load_business_profile()
    assert profile == {key: "" for key in store.PROFILE_KEYS}
    assert store.is_profile_configured(profile) is False


def test_profile_round_trip_normalizes_whitespace(profile_file):
    saved = store.save_business_profile({
        "legalName": "  Công ty   TNHH ABC ",
        "taxCode": "0101234567-001",
        "phone": "+84 24 1234 5678",
        "email": "hotro@abc.vn",
    })
    assert saved["legalName"] == "Công ty TNHH ABC"
    assert saved["address"] == ""
    assert json.loads(profile_file.read_text(encoding="utf-8")) == saved
    assert store.load_business_profile() == saved
    assert store.is_profile_configured(saved) is True


@pytest.mark.parametrize(
    "payload, message",
    [
        ({"taxCode": "12345"}, "Mã số thuế"),
        ({"phone": "abc"}, "Số điện thoại"),
        ({"email": "not-an-email"}, "Email"),
        ({"legalName": "x" * 201}, "tối đa 200"),
        ({"legalName": 5}, "chuỗi"),
        ({"website": "https://abc.vn"}, "không được hỗ trợ"),
        ({"address": "a\x00b"}, "không hợp lệ"),
        ([], "đối tượng"),
    ],
)
def test_invalid_profile_is_rejected_without_writing(profile_file, payload, message):
    with pytest.raises(store.BusinessProfileValidationError, match=message):
        store.save_business_profile(payload)
    assert not profile_file.exists()


class _Request:
    def __init__(self, body=None):
        self._body = body
        self.headers = {}
        self.client = SimpleNamespace(host="127.0.0.1")

    async def json(self):
        return self._body

    async def body(self):
        return json.dumps(self._body).encode("utf-8")


def _session_reader(valid, session):
    async def read(*_args, **_kwargs):
        return valid, session
    return read


def test_public_profile_endpoint_is_anonymous(profile_file):
    store.save_business_profile({"taxCode": "0101234567"})
    response = asyncio.run(profile_routes.public_business_profile_api(_Request()))
    body = json.loads(response.body)
    assert response.status_code == 200
    assert body["configured"] is True
    assert body["profile"]["taxCode"] == "0101234567"


def test_admin_profile_endpoints_require_super_admin(profile_file, monkeypatch):
    monkeypatch.setattr(profile_routes, "run_database_read", _session_reader(False, "Không có quyền."))
    for handler in (profile_routes.get_business_profile_api, profile_routes.put_business_profile_api):
        response = asyncio.run(handler(_Request({"profile": {"taxCode": "0101234567"}})))
        assert response.status_code == 403
        assert json.loads(response.body)["code"] == "SUPER_ADMIN_REQUIRED"
    assert not profile_file.exists()


def test_admin_profile_update_saves_and_audits_changed_fields(profile_file, monkeypatch):
    audits = []
    monkeypatch.setattr(profile_routes, "run_database_read", _session_reader(True, SimpleNamespace(user_id="admin-1")))

    async def write(function, *args, **kwargs):
        audits.append((args, kwargs))

    monkeypatch.setattr(profile_routes, "run_database_write", write)
    response = asyncio.run(profile_routes.put_business_profile_api(
        _Request({"profile": {"legalName": "Công ty ABC", "taxCode": "0101234567"}}),
    ))
    body = json.loads(response.body)
    assert response.status_code == 200
    assert body["changedFields"] == ["legalName", "taxCode"]
    assert [field["key"] for field in body["fields"]] == list(store.PROFILE_KEYS)
    assert audits[0][0] == ("platform.business_profile_updated",)
    assert audits[0][1]["metadata"] == {"changedFields": ["legalName", "taxCode"]}

    invalid = asyncio.run(profile_routes.put_business_profile_api(_Request({"profile": {"taxCode": "1"}})))
    assert invalid.status_code == 400
    assert json.loads(invalid.body)["code"] == "BUSINESS_PROFILE_INVALID"
    assert store.load_business_profile()["taxCode"] == "0101234567"


REGISTRATION = {
    "username": "newuser2026",
    "password": "Strong-Unique-2026!",
    "name": "Người dùng mới",
    "email": "new.user@example.com",
}


def _register(monkeypatch, payload):
    async def allow_rate_limit(*_args, **_kwargs):
        return SimpleNamespace(allowed=True, remaining=4)

    async def no_turnstile(*_args, **_kwargs):
        return None

    async def unexpected_write(*_args, **_kwargs):
        raise AssertionError("an account must not be created without consent")

    monkeypatch.setattr(otp_routes, "_rate_limit_decision", allow_rate_limit)
    monkeypatch.setattr(otp_routes, "enforce_turnstile", no_turnstile)
    monkeypatch.setattr(otp_routes, "run_database_write", unexpected_write)
    return asyncio.run(otp_routes.register_api(_Request(payload)))


def test_registration_without_consent_field_is_rejected(monkeypatch):
    response = _register(monkeypatch, dict(REGISTRATION))
    assert response.status_code == 400
    assert "acceptLegal" in response.body.decode("utf-8")


def test_registration_with_declined_consent_is_rejected(monkeypatch):
    response = _register(monkeypatch, {**REGISTRATION, "acceptLegal": False})
    assert response.status_code == 400
    assert json.loads(response.body)["code"] == "LEGAL_CONSENT_REQUIRED"


def test_registration_with_non_boolean_consent_is_rejected(monkeypatch):
    response = _register(monkeypatch, {**REGISTRATION, "acceptLegal": "true"})
    assert response.status_code == 400


def test_consent_evidence_is_a_required_transactional_audit_event(monkeypatch):
    calls = []
    monkeypatch.setattr(legal_consent, "log_audit", lambda *args, **kwargs: calls.append((args, kwargs)))
    cursor = object()
    legal_consent.record_legal_consent(
        cursor,
        user_id="user-1",
        method=legal_consent.CONSENT_METHOD_REGISTRATION_CHECKBOX,
        request="request",
    )
    (args, kwargs), = calls
    assert args == ("legal.consent_accepted",)
    assert kwargs["cursor"] is cursor
    assert kwargs["required"] is True
    assert kwargs["target_id"] == "user-1"
    assert kwargs["request"] == "request"
    assert kwargs["metadata"] == {
        "policyVersion": legal_consent.LEGAL_POLICY_VERSION,
        "documents": ["terms", "privacy", "security", "cookies", "refund"],
        "method": "registration_checkbox",
    }
