"""Business policy for processing a procurement package by lot scope.

The module is deliberately independent from HTTP, synchronization and database
code. Those adapters must ask this policy before advancing a lot or publishing
a formal artifact so every entry point applies the same rules.
"""

from __future__ import annotations

from dataclasses import dataclass, field
from enum import Enum
from typing import FrozenSet, Iterable, Mapping, Optional, Sequence, Tuple


class ProcedureKind(str, Enum):
    ONE_STAGE_ONE_ENVELOPE = "1G1T"
    ONE_STAGE_TWO_ENVELOPE = "1G2T"


class ApprovalMode(str, Enum):
    CONSOLIDATED = "CONSOLIDATED_APPROVAL"
    STAGED = "STAGED_APPROVAL"


class LotStage(str, Enum):
    NOT_STARTED = "NOT_STARTED"
    EVALUATION_DRAFT = "EVALUATION_DRAFT"
    EVALUATION_FINALIZED = "EVALUATION_FINALIZED"
    TECHNICAL_DRAFT = "TECHNICAL_DRAFT"
    TECHNICAL_EVALUATED = "TECHNICAL_EVALUATED"
    TECHNICAL_APPRAISED = "TECHNICAL_APPRAISED"
    TECHNICAL_APPROVED = "TECHNICAL_APPROVED"
    FINANCIAL_OPENED = "FINANCIAL_OPENED"
    FINANCIAL_EVALUATED = "FINANCIAL_EVALUATED"
    RESULT_APPRAISED = "RESULT_APPRAISED"
    RESULT_APPROVED = "RESULT_APPROVED"


class LotOutcome(str, Enum):
    AWARDED = "AWARDED"
    NO_BID = "NO_BID"
    NO_TECHNICAL_QUALIFIER = "NO_TECHNICAL_QUALIFIER"
    NO_FINANCIAL_QUALIFIER = "NO_FINANCIAL_QUALIFIER"
    NO_RESPONSIVE_BID = "NO_RESPONSIVE_BID"
    CANCELLED_LOT = "CANCELLED_LOT"
    REPROCUREMENT_REQUIRED = "REPROCUREMENT_REQUIRED"
    OTHER_APPROVED_OUTCOME = "OTHER_APPROVED_OUTCOME"


class PackageStatus(str, Enum):
    NOT_STARTED = "NOT_STARTED"
    IN_PROGRESS = "IN_PROGRESS"
    PARTIALLY_COMPLETED = "PARTIALLY_COMPLETED"
    COMPLETED = "COMPLETED"
    PACKAGE_CANCELLED = "PACKAGE_CANCELLED"


class DependencyKind(str, Enum):
    HSMT_GROUP_EVALUATION = "HSMT_GROUP_EVALUATION"
    CROSS_LOT_DISCOUNT = "CROSS_LOT_DISCOUNT"
    AGGREGATE_CAPACITY = "AGGREGATE_CAPACITY"
    AWARD_OPTIMIZATION = "AWARD_OPTIMIZATION"
    FINANCIAL_DISCLOSURE = "FINANCIAL_DISCLOSURE"


class BlockerCode(str, Enum):
    EMPTY_SCOPE = "EMPTY_SCOPE"
    UNKNOWN_LOT = "UNKNOWN_LOT"
    LOT_ALREADY_ACTIVE = "LOT_ALREADY_ACTIVE"
    LOT_ALREADY_COMPLETED = "LOT_ALREADY_COMPLETED"
    DEPENDENCY_GROUP_SPLIT = "DEPENDENCY_GROUP_SPLIT"
    FINANCIAL_DISCLOSURE_RISK = "FINANCIAL_DISCLOSURE_RISK"
    STAGED_APPROVAL_NOT_AUTHORIZED = "STAGED_APPROVAL_NOT_AUTHORIZED"
    CONSOLIDATED_MODE_CANNOT_PUBLISH_PARTIAL_RESULT = (
        "CONSOLIDATED_MODE_CANNOT_PUBLISH_PARTIAL_RESULT"
    )
    INVALID_ARTIFACT_SCOPE = "INVALID_ARTIFACT_SCOPE"
    INVALID_FINAL_OUTCOME = "INVALID_FINAL_OUTCOME"


@dataclass(frozen=True)
class LotProgress:
    lot_id: str
    stage: LotStage = LotStage.NOT_STARTED
    outcome: Optional[LotOutcome] = None
    active_batch_id: Optional[str] = None

    @property
    def is_completed(self) -> bool:
        return self.stage == LotStage.RESULT_APPROVED


@dataclass(frozen=True)
class DependencyGroup:
    """Lots that must move together for a stated HSMT/business reason."""

    group_id: str
    kind: DependencyKind
    lot_ids: FrozenSet[str]
    reason: str
    must_move_together: bool = True


@dataclass(frozen=True)
class PackageLifecycleContext:
    package_id: str
    procedure_kind: ProcedureKind
    approval_mode: ApprovalMode
    lots: Mapping[str, LotProgress]
    dependency_groups: Sequence[DependencyGroup] = field(default_factory=tuple)
    staged_approval_authorized: bool = False
    package_cancelled: bool = False


@dataclass(frozen=True)
class PolicyBlocker:
    code: BlockerCode
    message: str
    lot_ids: FrozenSet[str] = field(default_factory=frozenset)
    dependency_group_id: Optional[str] = None


@dataclass(frozen=True)
class EligibilityDecision:
    selected_lot_ids: FrozenSet[str]
    blockers: Tuple[PolicyBlocker, ...]

    @property
    def allowed(self) -> bool:
        return not self.blockers

    def require_allowed(self) -> None:
        if self.blockers:
            details = "; ".join(blocker.message for blocker in self.blockers)
            raise LotLifecyclePolicyError(details, self.blockers)


class LotLifecyclePolicyError(ValueError):
    def __init__(self, message: str, blockers: Sequence[PolicyBlocker] = ()) -> None:
        super().__init__(message)
        self.blockers = tuple(blockers)


_ONE_STAGE_ONE_ENVELOPE_TRANSITIONS = {
    LotStage.NOT_STARTED: frozenset({LotStage.EVALUATION_DRAFT}),
    LotStage.EVALUATION_DRAFT: frozenset({LotStage.EVALUATION_FINALIZED}),
    LotStage.EVALUATION_FINALIZED: frozenset({LotStage.RESULT_APPRAISED}),
    LotStage.RESULT_APPRAISED: frozenset({LotStage.RESULT_APPROVED}),
    LotStage.RESULT_APPROVED: frozenset(),
}

_ONE_STAGE_TWO_ENVELOPE_TRANSITIONS = {
    LotStage.NOT_STARTED: frozenset({LotStage.TECHNICAL_DRAFT}),
    LotStage.TECHNICAL_DRAFT: frozenset({LotStage.TECHNICAL_EVALUATED}),
    LotStage.TECHNICAL_EVALUATED: frozenset({LotStage.TECHNICAL_APPRAISED}),
    LotStage.TECHNICAL_APPRAISED: frozenset({LotStage.TECHNICAL_APPROVED}),
    LotStage.TECHNICAL_APPROVED: frozenset({LotStage.FINANCIAL_OPENED}),
    LotStage.FINANCIAL_OPENED: frozenset({LotStage.FINANCIAL_EVALUATED}),
    LotStage.FINANCIAL_EVALUATED: frozenset({LotStage.RESULT_APPRAISED}),
    LotStage.RESULT_APPRAISED: frozenset({LotStage.RESULT_APPROVED}),
    LotStage.RESULT_APPROVED: frozenset(),
}


def _assess_scope(
    context: PackageLifecycleContext,
    selected_lot_ids: Iterable[str],
    *,
    current_batch_id: Optional[str] = None,
) -> EligibilityDecision:
    selected = frozenset(selected_lot_ids)
    blockers = []

    if not selected:
        blockers.append(
            PolicyBlocker(BlockerCode.EMPTY_SCOPE, "A batch must contain at least one lot.")
        )

    unknown = selected.difference(context.lots)
    if unknown:
        blockers.append(
            PolicyBlocker(
                BlockerCode.UNKNOWN_LOT,
                "The batch contains lots that do not belong to the package.",
                unknown,
            )
        )

    known_selected = selected.intersection(context.lots)
    active = frozenset(
        lot_id
        for lot_id in known_selected
        if context.lots[lot_id].active_batch_id is not None
        and context.lots[lot_id].active_batch_id != current_batch_id
    )
    if active:
        blockers.append(
            PolicyBlocker(
                BlockerCode.LOT_ALREADY_ACTIVE,
                "A selected lot is already claimed by another active batch.",
                active,
            )
        )

    completed = frozenset(
        lot_id for lot_id in known_selected if context.lots[lot_id].is_completed
    )
    if completed:
        blockers.append(
            PolicyBlocker(
                BlockerCode.LOT_ALREADY_COMPLETED,
                "A selected lot already has an approved result.",
                completed,
            )
        )

    for group in context.dependency_groups:
        if not group.must_move_together or not selected.intersection(group.lot_ids):
            continue
        pending_group_lots = frozenset(
            lot_id
            for lot_id in group.lot_ids
            if lot_id in context.lots and not context.lots[lot_id].is_completed
        )
        missing = pending_group_lots.difference(selected)
        if not missing:
            continue
        code = (
            BlockerCode.FINANCIAL_DISCLOSURE_RISK
            if group.kind == DependencyKind.FINANCIAL_DISCLOSURE
            else BlockerCode.DEPENDENCY_GROUP_SPLIT
        )
        blockers.append(
            PolicyBlocker(
                code,
                group.reason,
                frozenset(selected.intersection(group.lot_ids).union(missing)),
                group.group_id,
            )
        )

    return EligibilityDecision(selected, tuple(blockers))


def assess_batch_start(
    context: PackageLifecycleContext,
    selected_lot_ids: Iterable[str],
) -> EligibilityDecision:
    """Check whether a new processing batch may claim the selected lots."""

    return _assess_scope(context, selected_lot_ids)


def assess_partial_result_publication(
    context: PackageLifecycleContext,
    selected_lot_ids: Iterable[str],
    *,
    current_batch_id: Optional[str] = None,
) -> EligibilityDecision:
    """Check whether an approval decision may cover fewer than all pending lots."""

    base = _assess_scope(
        context,
        selected_lot_ids,
        current_batch_id=current_batch_id,
    )
    blockers = list(base.blockers)
    selected = base.selected_lot_ids
    pending_lots = frozenset(
        lot_id for lot_id, lot in context.lots.items() if not lot.is_completed
    )
    is_partial = bool(selected) and selected != pending_lots

    if is_partial and context.approval_mode == ApprovalMode.CONSOLIDATED:
        blockers.append(
            PolicyBlocker(
                BlockerCode.CONSOLIDATED_MODE_CANNOT_PUBLISH_PARTIAL_RESULT,
                "Consolidated approval mode cannot publish a result for only part of the pending lots.",
                selected,
            )
        )
    elif is_partial and not context.staged_approval_authorized:
        blockers.append(
            PolicyBlocker(
                BlockerCode.STAGED_APPROVAL_NOT_AUTHORIZED,
                "Staged approval has not been authorized by the procurement documents and legal review.",
                selected,
            )
        )

    return EligibilityDecision(selected, tuple(blockers))


def allowed_next_stages(
    procedure_kind: ProcedureKind,
    current_stage: LotStage,
) -> FrozenSet[LotStage]:
    transitions = (
        _ONE_STAGE_ONE_ENVELOPE_TRANSITIONS
        if procedure_kind == ProcedureKind.ONE_STAGE_ONE_ENVELOPE
        else _ONE_STAGE_TWO_ENVELOPE_TRANSITIONS
    )
    return transitions.get(current_stage, frozenset())


def require_transition(
    procedure_kind: ProcedureKind,
    current_stage: LotStage,
    target_stage: LotStage,
    *,
    outcome: Optional[LotOutcome] = None,
) -> None:
    if target_stage not in allowed_next_stages(procedure_kind, current_stage):
        raise LotLifecyclePolicyError(
            "Invalid lot lifecycle transition: "
            f"{procedure_kind.value} {current_stage.value} -> {target_stage.value}."
        )
    if target_stage == LotStage.RESULT_APPROVED and outcome is None:
        blocker = PolicyBlocker(
            BlockerCode.INVALID_FINAL_OUTCOME,
            "An approved lot result must have an explicit final outcome.",
        )
        raise LotLifecyclePolicyError(blocker.message, (blocker,))
    if target_stage != LotStage.RESULT_APPROVED and outcome is not None:
        blocker = PolicyBlocker(
            BlockerCode.INVALID_FINAL_OUTCOME,
            "A final lot outcome can only be recorded when the result is approved.",
        )
        raise LotLifecyclePolicyError(blocker.message, (blocker,))


def project_package_status(
    lots: Iterable[LotProgress],
    *,
    package_cancelled: bool = False,
) -> PackageStatus:
    if package_cancelled:
        return PackageStatus.PACKAGE_CANCELLED

    lot_list = tuple(lots)
    if not lot_list or all(lot.stage == LotStage.NOT_STARTED for lot in lot_list):
        return PackageStatus.NOT_STARTED

    completed_count = sum(lot.is_completed for lot in lot_list)
    if completed_count == len(lot_list):
        return PackageStatus.COMPLETED
    if completed_count:
        return PackageStatus.PARTIALLY_COMPLETED
    return PackageStatus.IN_PROGRESS


def validate_artifact_scope(
    artifact_lot_ids: Iterable[str],
    batch_lot_ids: Iterable[str],
) -> None:
    """Require a formal artifact to identify an exact, non-empty lot scope."""

    artifact_scope = frozenset(artifact_lot_ids)
    batch_scope = frozenset(batch_lot_ids)
    if not artifact_scope or artifact_scope != batch_scope:
        blocker = PolicyBlocker(
            BlockerCode.INVALID_ARTIFACT_SCOPE,
            "The artifact lot scope must exactly match the immutable batch snapshot.",
            artifact_scope,
        )
        raise LotLifecyclePolicyError(blocker.message, (blocker,))

