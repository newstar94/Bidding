"""Central business mapping for approved lot outcomes in award exports."""

from __future__ import annotations

from dataclasses import dataclass
from enum import StrEnum


class LotApprovedOutcome(StrEnum):
    AWARDED = "AWARDED"
    NO_BID = "NO_BID"
    NO_TECHNICAL_QUALIFIER = "NO_TECHNICAL_QUALIFIER"
    NO_FINANCIAL_QUALIFIER = "NO_FINANCIAL_QUALIFIER"
    NO_RESPONSIVE_BID = "NO_RESPONSIVE_BID"
    CANCELLED_LOT = "CANCELLED_LOT"
    REPROCUREMENT_REQUIRED = "REPROCUREMENT_REQUIRED"
    OTHER_APPROVED_OUTCOME = "OTHER_APPROVED_OUTCOME"


class ExternalPortalResultStatus(StrEnum):
    AWARDED = "Trúng thầu"
    NOT_AWARDED = "Không trúng thầu"


_NO_AWARD_REASONS = {
    LotApprovedOutcome.NO_BID: "Không có nhà thầu tham dự.",
    LotApprovedOutcome.NO_TECHNICAL_QUALIFIER: (
        "Không có nhà thầu đáp ứng yêu cầu kỹ thuật."
    ),
    LotApprovedOutcome.NO_FINANCIAL_QUALIFIER: (
        "Không có nhà thầu đáp ứng yêu cầu tài chính."
    ),
    LotApprovedOutcome.NO_RESPONSIVE_BID: "Không có hồ sơ dự thầu đáp ứng.",
    LotApprovedOutcome.CANCELLED_LOT: "Phần/lô bị hủy theo kết quả phê duyệt.",
    LotApprovedOutcome.REPROCUREMENT_REQUIRED: "Phần/lô cần tổ chức lựa chọn lại.",
    LotApprovedOutcome.OTHER_APPROVED_OUTCOME: (
        "Kết quả khác theo quyết định phê duyệt."
    ),
}


@dataclass(frozen=True)
class BidderAwardMapping:
    status: ExternalPortalResultStatus
    reason: str | None
    allows_award_fields: bool
    lot_has_award: bool


def parse_lot_outcome(value: object) -> LotApprovedOutcome | None:
    text = str(value or "").strip().upper()
    try:
        return LotApprovedOutcome(text)
    except ValueError:
        return None


def map_bidder_award(
    outcome: LotApprovedOutcome,
    *,
    is_winner: bool,
    evaluation_reason: str | None = None,
) -> BidderAwardMapping:
    """Map one bidder row without silently treating no-award outcomes as a loss."""

    reason = str(evaluation_reason or "").strip() or None
    if outcome is LotApprovedOutcome.AWARDED and is_winner:
        return BidderAwardMapping(
            ExternalPortalResultStatus.AWARDED,
            None,
            allows_award_fields=True,
            lot_has_award=True,
        )
    if outcome is LotApprovedOutcome.AWARDED:
        return BidderAwardMapping(
            ExternalPortalResultStatus.NOT_AWARDED,
            reason,
            allows_award_fields=False,
            lot_has_award=True,
        )
    return BidderAwardMapping(
        ExternalPortalResultStatus.NOT_AWARDED,
        _NO_AWARD_REASONS[outcome],
        allows_award_fields=False,
        lot_has_award=False,
    )
