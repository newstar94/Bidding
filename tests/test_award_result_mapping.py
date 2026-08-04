import pytest

from backend.documents.award_result_mapping import (
    ExternalPortalResultStatus,
    LotApprovedOutcome,
    map_bidder_award,
    parse_lot_outcome,
)


@pytest.mark.parametrize(
    "outcome",
    [
        LotApprovedOutcome.NO_BID,
        LotApprovedOutcome.NO_TECHNICAL_QUALIFIER,
        LotApprovedOutcome.NO_FINANCIAL_QUALIFIER,
        LotApprovedOutcome.NO_RESPONSIVE_BID,
        LotApprovedOutcome.CANCELLED_LOT,
        LotApprovedOutcome.REPROCUREMENT_REQUIRED,
        LotApprovedOutcome.OTHER_APPROVED_OUTCOME,
    ],
)
def test_no_award_outcomes_have_explicit_external_mapping_and_reason(outcome):
    mapping = map_bidder_award(outcome, is_winner=False)

    assert mapping.status is ExternalPortalResultStatus.NOT_AWARDED
    assert mapping.reason
    assert mapping.allows_award_fields is False
    assert mapping.lot_has_award is False


def test_awarded_outcome_distinguishes_winner_and_non_winner():
    winner = map_bidder_award(LotApprovedOutcome.AWARDED, is_winner=True)
    loser = map_bidder_award(
        LotApprovedOutcome.AWARDED,
        is_winner=False,
        evaluation_reason="Xếp hạng sau nhà thầu trúng thầu",
    )

    assert winner.status is ExternalPortalResultStatus.AWARDED
    assert winner.allows_award_fields is True
    assert loser.status is ExternalPortalResultStatus.NOT_AWARDED
    assert loser.reason == "Xếp hạng sau nhà thầu trúng thầu"
    assert loser.lot_has_award is True


def test_unknown_outcome_never_silently_falls_back():
    assert parse_lot_outcome("UNKNOWN") is None
    assert parse_lot_outcome(None) is None
