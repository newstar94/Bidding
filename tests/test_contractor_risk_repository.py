from datetime import datetime
from types import SimpleNamespace

from backend.contractor_risk.repository import ContractorRiskRepository, ResolutionContext
from backend.contractor_risk.violation_rules import VIOLATION_RULE_VERSION
from backend.shared.date_utils import VIETNAM_TIMEZONE


class SnapshotCursor:
    def __init__(self, row):
        self.row = row
        self.sql = ""

    def execute(self, sql, _params):
        self.sql = sql
        if "is_stale = 0" not in sql:
            raise AssertionError("stale contractor snapshots must not be reused")
        return self

    def fetchone(self):
        return self.row


def context(closing_at):
    return ResolutionContext(
        organization_id="org-1",
        package_id="pkg-1",
        lot_id=None,
        opening_id="opening-1",
        member_id=None,
        contractor_id="contractor-1",
        bid_closing_at=closing_at,
        contractor_identifier="vn001",
        tax_code="0012345678",
        contractor_name="Nhà thầu A",
    )


def repository_for(row):
    cursor = SnapshotCursor(row)
    return ContractorRiskRepository(SimpleNamespace(cursor=lambda: cursor))


def test_latest_snapshot_ignores_stale_and_closing_time_mismatch():
    closing_at = datetime(2026, 6, 1, tzinfo=VIETNAM_TIMEZONE)
    repository = repository_for({
        "contractor_identifier": "vn001",
        "tax_code": "0012345678",
        "bid_closing_at": "2026-05-01T00:00:00+07:00",
        "source_provider": "fixture",
        "source_payload_hash": "hash",
        "source_records_json": "[]",
    })

    assert repository.latest_snapshot_result(
        context(closing_at),
        contractor_identifier="vn001",
        tax_code="0012345678",
    ) is None


def test_latest_snapshot_never_turns_failed_lookup_into_clean_result():
    closing_at = datetime(2026, 6, 1, tzinfo=VIETNAM_TIMEZONE)
    repository = repository_for({
        "contractor_identifier": "vn001",
        "tax_code": "0012345678",
        "bid_closing_at": closing_at,
        "status": "LOOKUP_FAILED",
        "source_provider": "MuaSamCong",
        "source_payload_hash": "",
        "source_records_json": "[]",
    })

    assert repository.latest_snapshot_result(
        context(closing_at),
        contractor_identifier="vn001",
        tax_code="0012345678",
    ) is None


def test_latest_snapshot_is_reused_only_for_current_rule_version():
    closing_at = datetime(2026, 6, 1, tzinfo=VIETNAM_TIMEZONE)
    values = {
        "contractor_identifier": "vn001",
        "tax_code": "0012345678",
        "bid_closing_at": closing_at,
        "status": "NO_ACTIVE_VIOLATION",
        "source_provider": "MuaSamCong",
        "source_payload_hash": "hash",
        "source_records_json": "[]",
    }

    stale = repository_for({**values, "rule_version": "2026.1"})
    assert stale.latest_snapshot_result(
        context(closing_at),
        contractor_identifier="vn001",
        tax_code="0012345678",
    ) is None

    current = repository_for({**values, "rule_version": VIOLATION_RULE_VERSION})
    assert current.latest_snapshot_result(
        context(closing_at),
        contractor_identifier="vn001",
        tax_code="0012345678",
    ) is not None
