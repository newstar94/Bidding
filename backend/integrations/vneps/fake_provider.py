"""Recorded provider adapter for deterministic CI/E2E runs."""

from __future__ import annotations

import json
from pathlib import Path

from backend.contractor_risk.violation_rules import (
    normalize_identity_code,
    normalize_tax_code,
)
from backend.integrations.vneps.errors import VnepsConfigurationError, VnepsSchemaError
from backend.integrations.vneps.response_parser import parse_violation_response


class FixtureViolationProvider:
    name = "MuaSamCongFixture"
    schema_version = "fixture-2026.1"

    def __init__(self, fixture_path: str):
        self.fixture_path = Path(fixture_path).resolve()
        if not self.fixture_path.is_file():
            raise VnepsConfigurationError("VNEPS violation fixture does not exist")

    def lookup(self, *, contractor_identifier: str, tax_code: str = ""):
        try:
            payload = json.loads(self.fixture_path.read_text(encoding="utf-8"))
        except (OSError, UnicodeError, json.JSONDecodeError) as error:
            raise VnepsSchemaError("VNEPS violation fixture is invalid") from error
        values = payload.get("records") if isinstance(payload, dict) else None
        if not isinstance(values, list):
            raise VnepsSchemaError("VNEPS violation fixture needs a records list")
        requested_identifier = normalize_identity_code(contractor_identifier)
        requested_tax = normalize_tax_code(tax_code)
        selected = [
            value
            for value in values
            if isinstance(value, dict)
            and (
                requested_identifier
                and normalize_identity_code(
                    value.get("contractorIdentifier") or value.get("orgCode")
                ) == requested_identifier
                or requested_tax
                and normalize_tax_code(
                    value.get("taxCode") or value.get("maSoThue")
                ) == requested_tax
            )
        ]
        return parse_violation_response({"items": selected}, provider=self.name)
