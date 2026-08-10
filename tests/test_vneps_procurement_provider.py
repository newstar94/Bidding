import pytest

from backend.integrations.vneps.fake_procurement_provider import FixtureProcurementSource
from backend.integrations.vneps.procurement_provider import VnepsProcurementSource
from backend.procurement_import.source import ProcurementSourceError


def test_production_provider_fails_closed_without_authorized_detail_contract(monkeypatch):
    monkeypatch.delenv("VNEPS_PROCUREMENT_API_AUTHORIZATION_CONFIRMED", raising=False)
    with pytest.raises(ProcurementSourceError, match="BLOCKED BY EXTERNAL/API AUTHORIZATION"):
        VnepsProcurementSource()


def test_fixture_provider_is_forbidden_in_production(tmp_path, monkeypatch):
    fixture = tmp_path / "fixture.json"
    fixture.write_text('{"schemaVersion":"vneps-procurement-fixture-v1","plans":[]}', encoding="utf-8")
    monkeypatch.setenv("APP_ENV", "production")
    with pytest.raises(RuntimeError, match="forbidden in production"):
        FixtureProcurementSource(str(fixture))


def test_fixture_schema_drift_fails_closed(tmp_path, monkeypatch):
    fixture = tmp_path / "fixture.json"
    fixture.write_text('{"schemaVersion":"unexpected","plans":[]}', encoding="utf-8")
    monkeypatch.setenv("APP_ENV", "test")
    with pytest.raises(ProcurementSourceError, match="PROCUREMENT_SCHEMA_CHANGED"):
        FixtureProcurementSource(str(fixture))
