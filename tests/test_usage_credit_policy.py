import pytest

from backend.commercial_policy.errors import CommercialPolicyError, DECISION_REQUIRED
from backend.usage_credits import SourceRevisionCandidate, UsageCreditService, UsageOwner


class NoDatabaseCursor:
    def execute(self, *_args, **_kwargs):
        raise AssertionError("Blocked partial-batch policy must stop before database/network work.")


def test_usage_candidate_identity_is_canonical_and_deduplicated_before_reservation():
    service = UsageCreditService(NoDatabaseCursor())
    candidates = service.list_missing_source_revisions(
        [
            {"provider": " MSC ", "entity_kind": "plan", "source_code": "pl-1", "source_revision": "01"},
            {"provider": "msc", "entity_kind": "PLAN", "source_code": "PL-1", "source_revision": "01"},
            {"provider": "msc", "entity_kind": "PLAN", "source_code": "PL-1", "source_revision": "02"},
        ],
        lambda candidate: candidate.source_revision == "02",
    )
    assert [candidate.identity for candidate in candidates] == [
        ("msc", "PLAN", "PL-1", "01")
    ]


def test_initial_blocked_partial_batch_stops_before_reservation_or_external_fetch():
    service = UsageCreditService(NoDatabaseCursor())
    owner = UsageOwner("organization", "org-1")
    candidates = [
        SourceRevisionCandidate("msc", "PLAN", "PL-1", "01"),
        SourceRevisionCandidate("msc", "PLAN", "PL-1", "02"),
    ]
    with pytest.raises(CommercialPolicyError) as error:
        service.reserve_source_fetch_batch(
            owner,
            candidates,
            "job-12345678",
            partial_batch_policy={"kind": "blocked_decision"},
        )
    assert error.value.code == DECISION_REQUIRED
    assert error.value.details == {"decision": "partialBatch"}
