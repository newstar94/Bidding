import asyncio
import json

import pytest
from starlette.requests import Request

from backend.partners import address_routes


@pytest.fixture
def isolated_wards_cache(monkeypatch):
    monkeypatch.setattr(address_routes, "_wards_cache", {})
    monkeypatch.setattr(address_routes, "_wards_locks", {})


def _wards_request():
    return Request({
        "type": "http",
        "method": "GET",
        "path": "/api/wards/01",
        "headers": [],
        "path_params": {"province_code": "01"},
    })


@pytest.mark.parametrize(
    "malformed_payload",
    [None, [], "invalid", {}, {"wards": None}, {"wards": "invalid"}, {"wards": {}}],
)
def test_malformed_wards_response_does_not_poison_cache(
    monkeypatch, isolated_wards_cache, malformed_payload
):
    valid_wards = [{"code": 1, "name": "Ward", "upstream_field": "preserved"}]
    upstream_payloads = iter([malformed_payload, {"wards": valid_wards}])
    calls = []

    async def fake_blocking_io(function, url, *, timeout_seconds):
        assert function is address_routes._fetch_json
        assert url == f"{address_routes.PROVINCES_API_BASE}/p/01?depth=2"
        assert timeout_seconds == 12
        calls.append(url)
        return next(upstream_payloads)

    monkeypatch.setattr(address_routes, "run_blocking_io", fake_blocking_io)

    async def request_twice():
        first = await address_routes.get_wards_api(_wards_request())
        second = await address_routes.get_wards_api(_wards_request())
        return first, second

    first, second = asyncio.run(request_twice())

    assert (
        first.status_code,
        second.status_code,
        json.loads(second.body),
        len(calls),
    ) == (502, 200, valid_wards, 2)
    assert json.loads(first.body)["code"] == "WARDS_UPSTREAM_UNAVAILABLE"
    assert address_routes._wards_cache == {"01": valid_wards}


@pytest.mark.parametrize(
    "wards",
    [[], [{"code": 1, "name": "Ward", "upstream_field": "preserved"}]],
)
def test_valid_wards_list_is_preserved_and_cached(
    monkeypatch, isolated_wards_cache, wards
):
    calls = []

    async def fake_blocking_io(*_args, **_kwargs):
        calls.append(True)
        return {"wards": wards}

    monkeypatch.setattr(address_routes, "run_blocking_io", fake_blocking_io)

    async def request_twice():
        first = await address_routes.get_wards_api(_wards_request())
        second = await address_routes.get_wards_api(_wards_request())
        return first, second

    first, second = asyncio.run(request_twice())

    assert first.status_code == second.status_code == 200
    assert json.loads(first.body) == json.loads(second.body) == wards
    assert address_routes._wards_cache == {"01": wards}
    assert len(calls) == 1
