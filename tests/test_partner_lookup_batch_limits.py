import asyncio
from types import SimpleNamespace

from backend.partners import address_routes


def test_partner_lookup_limits_allow_one_opening_batch(monkeypatch):
    observed_limits = []

    async def fake_database_write(function, *args, **kwargs):
        if function is address_routes.get_rate_limit_decision:
            observed_limits.append(kwargs["max_attempts"])
            return SimpleNamespace(allowed=True)
        if function is address_routes._authenticate_partner_lookup:
            return True, SimpleNamespace(user_id="user-1"), "organization-1"
        raise AssertionError(f"unexpected database function: {function}")

    async def fake_blocking_io(*_args, **_kwargs):
        return {
            "name": "Contractor",
            "org_code": "vn0306089887",
            "representative_name": "Tran Anh Khoa",
        }

    monkeypatch.setattr(address_routes, "run_database_write", fake_database_write)
    monkeypatch.setattr(address_routes, "run_blocking_io", fake_blocking_io)
    monkeypatch.setattr(address_routes, "get_client_ip", lambda _request: "127.0.0.1")
    monkeypatch.setattr(address_routes, "_observe_partner_lookup", lambda *_args, **_kwargs: None)
    request = SimpleNamespace(
        cookies={"session_token": "session"},
        query_params={"orgCode": "vn0306089887", "role": "NT"},
    )

    response = asyncio.run(address_routes.lookup_tax_code_api(request))

    assert response.status_code == 200
    assert observed_limits == [
        address_routes.PARTNER_LOOKUP_IP_RATE_LIMIT,
        address_routes.PARTNER_LOOKUP_USER_RATE_LIMIT,
    ]
    assert address_routes.PARTNER_LOOKUP_IP_RATE_LIMIT >= 120
    assert address_routes.PARTNER_LOOKUP_USER_RATE_LIMIT >= 60
