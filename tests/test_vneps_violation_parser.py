from backend.contractor_risk.types import ViolationCategory
from backend.integrations.vneps.response_parser import parse_violation_response


def test_parser_keeps_only_the_three_approved_categories():
    result = parse_violation_response(
        {
            "items": [
                {
                    "category": "BIDDING_BAN",
                    "orgCode": "vn001",
                    "effDate": "2026-01-01",
                    "expDate": "2027-01-01",
                },
                {"category": "UNAPPROVED_OTHER_VIOLATION", "orgCode": "vn001"},
            ]
        },
        provider="fixture",
    )
    assert len(result.records) == 1
    assert result.records[0].category == ViolationCategory.BIDDING_BAN


def test_reputation_parser_does_not_replace_missing_behavior_date_with_public_date():
    result = parse_violation_response(
        {
            "items": [{
                "category": "UNRELIABLE_BID_PARTICIPATION",
                "contractorIdentifier": "vn001",
                "publicDate": "2025-01-01",
            }]
        },
        provider="fixture",
    )
    assert result.records[0].behavior_date is None


def test_termination_without_explicit_fault_evidence_requires_review():
    result = parse_violation_response(
        {
            "items": [{
                "category": "CONTRACT_TERMINATION_BY_CONTRACTOR_FAULT",
                "contractorIdentifier": "vn001",
                "issuedDate": "2025-01-01",
            }]
        },
        provider="fixture",
    )
    assert result.records[0].requires_review is True


def test_cancelled_source_status_is_normalized_as_revoked():
    result = parse_violation_response(
        {
            "items": [{
                "category": "BIDDING_BAN",
                "contractorIdentifier": "vn001",
                "status": "CANCEL",
            }]
        },
        provider="fixture",
    )
    assert result.records[0].is_revoked is True
