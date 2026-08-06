from datetime import datetime

from backend.contractor_risk.repository import ResolutionContext
from backend.contractor_risk.service import ContractorRiskService
from backend.contractor_risk.types import (
    NormalizedViolationRecord,
    ViolationCategory,
    ViolationProviderResult,
    ViolationStatus,
)
from backend.integrations.vneps.errors import VnepsUpstreamError
from backend.shared.date_utils import VIETNAM_TIMEZONE


class FakeRepository:
    def __init__(self, *, snapshot=None, cached=None):
        self.snapshot = snapshot
        self.cached = cached
        self.cached_writes = []
        self.snapshots = []

    def latest_snapshot_result(self, _context, **_identity):
        return self.snapshot

    def get_cached_provider_result(self, **_identity):
        return self.cached

    def put_cached_provider_result(self, result, **identity):
        self.cached_writes.append((result, identity))

    def save_snapshot(self, context, **values):
        self.snapshots.append((context, values))


class FakeContractorProvider:
    def __init__(self, value=None):
        self.value = value

    def resolve(self, **_identity):
        return self.value


class FakeViolationProvider:
    name = "fixture"
    schema_version = "1"

    def __init__(self, result=None, error=None):
        self.result = result
        self.error = error
        self.calls = 0

    def lookup(self, **_identity):
        self.calls += 1
        if self.error:
            raise self.error
        return self.result


def context(**values):
    defaults = {
        "organization_id": "org-1",
        "package_id": "pkg-1",
        "lot_id": None,
        "opening_id": "opening-1",
        "member_id": None,
        "contractor_id": "contractor-1",
        "bid_closing_at": datetime(2026, 6, 1, tzinfo=VIETNAM_TIMEZONE),
        "contractor_identifier": "vn001",
        "tax_code": "0012345678",
        "contractor_name": "Nhà thầu A",
    }
    defaults.update(values)
    return ResolutionContext(**defaults)


def provider_result(*records):
    return ViolationProviderResult(
        records=tuple(records),
        provider="fixture",
        schema_version="1",
        payload_hash="a" * 64,
    )


def active_ban():
    return NormalizedViolationRecord(
        category=ViolationCategory.BIDDING_BAN,
        contractor_identifier="vn001",
        tax_code="0012345678",
        effective_from=datetime(2026, 1, 1),
        effective_to=datetime(2027, 1, 1),
    )


def test_service_confirms_violation_and_persists_authoritative_snapshot():
    repository = FakeRepository()
    provider = FakeViolationProvider(provider_result(active_ban()))
    resolution = ContractorRiskService(
        repository,
        FakeContractorProvider(),
        provider,
    ).resolve(context(), actor_user_id="user-1")

    assert resolution.violation_status == ViolationStatus.VIOLATION_CONFIRMED
    assert provider.calls == 1
    assert len(repository.cached_writes) == 1
    assert repository.snapshots[0][1]["status"] == ViolationStatus.VIOLATION_CONFIRMED


def test_service_reuses_cached_normalized_records_without_live_call():
    cached = provider_result(active_ban())
    repository = FakeRepository(cached=cached)
    provider = FakeViolationProvider(error=AssertionError("must not call live provider"))

    resolution = ContractorRiskService(
        repository,
        FakeContractorProvider(),
        provider,
    ).resolve(context(), actor_user_id="user-1")

    assert resolution.violation_status == ViolationStatus.VIOLATION_CONFIRMED
    assert provider.calls == 0


def test_service_recalculates_changed_closing_time_from_snapshot_records():
    repository = FakeRepository(snapshot=provider_result(active_ban()))
    provider = FakeViolationProvider(error=AssertionError("must not call live provider"))
    changed = context(
        bid_closing_at=datetime(2027, 1, 1, tzinfo=VIETNAM_TIMEZONE)
    )

    resolution = ContractorRiskService(
        repository,
        FakeContractorProvider(),
        provider,
    ).resolve(changed, actor_user_id="user-1")

    assert resolution.violation_status == ViolationStatus.NO_ACTIVE_VIOLATION
    assert provider.calls == 0


def test_service_maps_upstream_failure_to_lookup_failed_not_no_violation():
    repository = FakeRepository()
    provider = FakeViolationProvider(error=VnepsUpstreamError("timeout"))

    resolution = ContractorRiskService(
        repository,
        FakeContractorProvider(),
        provider,
    ).resolve(context(), actor_user_id="user-1")

    assert resolution.violation_status == ViolationStatus.LOOKUP_FAILED
    assert repository.snapshots[0][1]["status"] == ViolationStatus.LOOKUP_FAILED


def test_service_does_not_confirm_record_without_exact_identity_match():
    unrelated = NormalizedViolationRecord(
        category=ViolationCategory.BIDDING_BAN,
        contractor_identifier="vn999",
        tax_code="9999999999",
        effective_from=datetime(2026, 1, 1),
        effective_to=datetime(2027, 1, 1),
    )
    repository = FakeRepository()
    resolution = ContractorRiskService(
        repository,
        FakeContractorProvider(),
        FakeViolationProvider(provider_result(unrelated)),
    ).resolve(context(), actor_user_id="user-1")

    assert resolution.violation_status == ViolationStatus.REVIEW_REQUIRED


def test_service_missing_bid_closing_time_needs_review_without_provider_call():
    repository = FakeRepository()
    provider = FakeViolationProvider(error=AssertionError("must not call provider"))
    resolution = ContractorRiskService(
        repository,
        FakeContractorProvider(),
        provider,
    ).resolve(context(bid_closing_at=None), actor_user_id="user-1")

    assert resolution.violation_status == ViolationStatus.REVIEW_REQUIRED
    assert provider.calls == 0
