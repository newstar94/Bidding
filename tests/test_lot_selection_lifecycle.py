import pytest

from backend.lot_selection_lifecycle import (
    ApprovalMode,
    BlockerCode,
    DependencyGroup,
    DependencyKind,
    LotLifecyclePolicyError,
    LotOutcome,
    LotProgress,
    LotStage,
    PackageLifecycleContext,
    PackageStatus,
    ProcedureKind,
    assess_batch_start,
    assess_partial_result_publication,
    project_package_status,
    require_transition,
    validate_artifact_scope,
)


def _context(**overrides):
    values = {
        "package_id": "PKG-1",
        "procedure_kind": ProcedureKind.ONE_STAGE_TWO_ENVELOPE,
        "approval_mode": ApprovalMode.CONSOLIDATED,
        "lots": {
            "LOT-1": LotProgress("LOT-1"),
            "LOT-2": LotProgress("LOT-2"),
            "LOT-3": LotProgress("LOT-3"),
        },
    }
    values.update(overrides)
    return PackageLifecycleContext(**values)


def test_batch_requires_a_non_empty_known_scope():
    empty = assess_batch_start(_context(), [])
    unknown = assess_batch_start(_context(), ["LOT-X"])

    assert not empty.allowed
    assert empty.blockers[0].code == BlockerCode.EMPTY_SCOPE
    assert not unknown.allowed
    assert unknown.blockers[0].code == BlockerCode.UNKNOWN_LOT


def test_batch_cannot_claim_active_or_completed_lot():
    context = _context(
        lots={
            "LOT-1": LotProgress("LOT-1", active_batch_id="BATCH-OLD"),
            "LOT-2": LotProgress("LOT-2", stage=LotStage.RESULT_APPROVED),
        }
    )

    decision = assess_batch_start(context, ["LOT-1", "LOT-2"])

    assert {blocker.code for blocker in decision.blockers} == {
        BlockerCode.LOT_ALREADY_ACTIVE,
        BlockerCode.LOT_ALREADY_COMPLETED,
    }


@pytest.mark.parametrize(
    "kind, expected_code",
    [
        (DependencyKind.HSMT_GROUP_EVALUATION, BlockerCode.DEPENDENCY_GROUP_SPLIT),
        (DependencyKind.CROSS_LOT_DISCOUNT, BlockerCode.DEPENDENCY_GROUP_SPLIT),
        (DependencyKind.AGGREGATE_CAPACITY, BlockerCode.DEPENDENCY_GROUP_SPLIT),
        (DependencyKind.AWARD_OPTIMIZATION, BlockerCode.DEPENDENCY_GROUP_SPLIT),
        (DependencyKind.FINANCIAL_DISCLOSURE, BlockerCode.FINANCIAL_DISCLOSURE_RISK),
    ],
)
def test_batch_cannot_split_a_dependency_group(kind, expected_code):
    context = _context(
        dependency_groups=(
            DependencyGroup(
                "GROUP-1",
                kind,
                frozenset({"LOT-1", "LOT-2"}),
                "These lots must be processed together.",
            ),
        )
    )

    decision = assess_batch_start(context, ["LOT-1"])

    assert not decision.allowed
    assert decision.blockers[0].code == expected_code
    assert decision.blockers[0].lot_ids == frozenset({"LOT-1", "LOT-2"})


def test_completed_member_does_not_keep_dependency_group_locked():
    context = _context(
        lots={
            "LOT-1": LotProgress("LOT-1", stage=LotStage.RESULT_APPROVED),
            "LOT-2": LotProgress("LOT-2"),
        },
        dependency_groups=(
            DependencyGroup(
                "GROUP-1",
                DependencyKind.CROSS_LOT_DISCOUNT,
                frozenset({"LOT-1", "LOT-2"}),
                "Evaluate the remaining dependent lots together.",
            ),
        ),
    )

    assert assess_batch_start(context, ["LOT-2"]).allowed


def test_partial_official_publication_is_allowed_for_a_valid_unfinished_scope():
    context = _context(approval_mode=ApprovalMode.CONSOLIDATED)

    assert assess_batch_start(context, ["LOT-1"]).allowed
    publication = assess_partial_result_publication(context, ["LOT-1"])

    assert publication.allowed


def test_staged_publication_does_not_require_separate_authorization():
    unauthorized = _context(approval_mode=ApprovalMode.STAGED)
    authorized = _context(
        approval_mode=ApprovalMode.STAGED,
        staged_approval_authorized=True,
    )

    assert assess_partial_result_publication(unauthorized, ["LOT-1"]).allowed
    assert assess_partial_result_publication(authorized, ["LOT-1"]).allowed


def test_current_batch_can_publish_its_claimed_scope():
    context = _context(
        approval_mode=ApprovalMode.STAGED,
        staged_approval_authorized=True,
        lots={
            "LOT-1": LotProgress("LOT-1", active_batch_id="BATCH-1"),
            "LOT-2": LotProgress("LOT-2"),
        },
    )

    assert assess_partial_result_publication(
        context,
        ["LOT-1"],
        current_batch_id="BATCH-1",
    ).allowed


def test_one_stage_one_envelope_rejects_two_envelope_transition():
    require_transition(
        ProcedureKind.ONE_STAGE_ONE_ENVELOPE,
        LotStage.NOT_STARTED,
        LotStage.EVALUATION_DRAFT,
    )

    with pytest.raises(LotLifecyclePolicyError):
        require_transition(
            ProcedureKind.ONE_STAGE_ONE_ENVELOPE,
            LotStage.NOT_STARTED,
            LotStage.TECHNICAL_DRAFT,
        )


def test_two_envelope_financial_opening_requires_technical_approval():
    require_transition(
        ProcedureKind.ONE_STAGE_TWO_ENVELOPE,
        LotStage.TECHNICAL_APPROVED,
        LotStage.FINANCIAL_OPENED,
    )

    with pytest.raises(LotLifecyclePolicyError):
        require_transition(
            ProcedureKind.ONE_STAGE_TWO_ENVELOPE,
            LotStage.TECHNICAL_EVALUATED,
            LotStage.FINANCIAL_OPENED,
        )


def test_approved_result_requires_explicit_outcome():
    with pytest.raises(LotLifecyclePolicyError) as error:
        require_transition(
            ProcedureKind.ONE_STAGE_ONE_ENVELOPE,
            LotStage.RESULT_APPRAISED,
            LotStage.RESULT_APPROVED,
        )

    assert error.value.blockers[0].code == BlockerCode.INVALID_FINAL_OUTCOME
    require_transition(
        ProcedureKind.ONE_STAGE_ONE_ENVELOPE,
        LotStage.RESULT_APPRAISED,
        LotStage.RESULT_APPROVED,
        outcome=LotOutcome.AWARDED,
    )


@pytest.mark.parametrize(
    "stages, expected",
    [
        ([LotStage.NOT_STARTED, LotStage.NOT_STARTED], PackageStatus.NOT_STARTED),
        ([LotStage.EVALUATION_DRAFT, LotStage.NOT_STARTED], PackageStatus.IN_PROGRESS),
        (
            [LotStage.RESULT_APPROVED, LotStage.EVALUATION_DRAFT],
            PackageStatus.PARTIALLY_COMPLETED,
        ),
        ([LotStage.RESULT_APPROVED, LotStage.RESULT_APPROVED], PackageStatus.COMPLETED),
    ],
)
def test_package_status_is_a_projection_of_lot_statuses(stages, expected):
    lots = [LotProgress(f"LOT-{index}", stage=stage) for index, stage in enumerate(stages)]

    assert project_package_status(lots) == expected


def test_package_cancellation_is_explicit_not_inferred_from_lot_outcomes():
    lots = [LotProgress("LOT-1", stage=LotStage.RESULT_APPROVED)]

    assert project_package_status(lots) == PackageStatus.COMPLETED
    assert project_package_status(lots, package_cancelled=True) == PackageStatus.PACKAGE_CANCELLED


def test_artifact_scope_must_exactly_match_batch_snapshot():
    validate_artifact_scope(["LOT-1", "LOT-2"], ["LOT-2", "LOT-1"])

    with pytest.raises(LotLifecyclePolicyError) as error:
        validate_artifact_scope(["LOT-1"], ["LOT-1", "LOT-2"])

    assert error.value.blockers[0].code == BlockerCode.INVALID_ARTIFACT_SCOPE
