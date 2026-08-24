import pytest

from backend.procurement_cases.policy import CasePolicy, CasePolicyError
from backend.sync.queries import TABLE_KEYS


@pytest.mark.parametrize(("case_type", "state", "action", "target"), [
    ("CLARIFICATION", "DRAFT", "SUBMIT_REVIEW", "UNDER_REVIEW"),
    ("CLARIFICATION", "UNDER_REVIEW", "RETURN", "RETURNED"),
    ("CLARIFICATION", "RETURNED", "SUBMIT_REVIEW", "UNDER_REVIEW"),
    ("CLARIFICATION", "UNDER_REVIEW", "APPROVE", "APPROVED"),
    ("CLARIFICATION", "APPROVED", "ISSUE", "ISSUED"),
    ("CLARIFICATION", "ISSUED", "CLOSE", "CLOSED"),
    ("CLARIFICATION", "CLOSED", "REOPEN", "DRAFT"),
    ("PETITION", "RECEIVED", "ASSIGN", "ASSIGNED"),
    ("PETITION", "ASSIGNED", "START_REVIEW", "UNDER_REVIEW"),
    ("PETITION", "UNDER_REVIEW", "DRAFT_RESPONSE", "DRAFT_RESPONSE"),
    ("PETITION", "DRAFT_RESPONSE", "RETURN", "RETURNED"),
    ("PETITION", "RETURNED", "DRAFT_RESPONSE", "DRAFT_RESPONSE"),
    ("PETITION", "DRAFT_RESPONSE", "APPROVE", "APPROVED"),
    ("PETITION", "APPROVED", "ISSUE", "ISSUED"),
    ("PETITION", "ISSUED", "CLOSE", "CLOSED"),
    ("PETITION", "CLOSED", "REOPEN", "RECEIVED"),
])
def test_approved_transition_matrix(case_type, state, action, target):
    assert CasePolicy.transition(
        case_type, state, action, has_response=True
    ) == target


@pytest.mark.parametrize(("case_type", "state", "action"), [
    ("CLARIFICATION", "DRAFT", "APPROVE"),
    ("CLARIFICATION", "APPROVED", "CLOSE"),
    ("PETITION", "RECEIVED", "APPROVE"),
    ("PETITION", "UNDER_REVIEW", "APPROVE"),
    ("PETITION", "DRAFT_RESPONSE", "SUBMIT_REVIEW"),
    ("PETITION", "REJECTED", "REOPEN"),
])
def test_unapproved_transitions_are_rejected(case_type, state, action):
    with pytest.raises(CasePolicyError, match="CASE_"):
        CasePolicy.transition(case_type, state, action, has_response=True)


@pytest.mark.parametrize(("case_type", "state", "action"), [
    ("CLARIFICATION", "DRAFT", "SUBMIT_REVIEW"),
    ("CLARIFICATION", "UNDER_REVIEW", "APPROVE"),
    ("PETITION", "UNDER_REVIEW", "DRAFT_RESPONSE"),
    ("PETITION", "DRAFT_RESPONSE", "APPROVE"),
])
def test_response_prerequisites_are_server_owned(case_type, state, action):
    with pytest.raises(CasePolicyError, match="CASE_RESPONSE_REQUIRED"):
        CasePolicy.transition(case_type, state, action, has_response=False)


def test_create_contract_and_petition_other_description():
    assert CasePolicy.validate_create(
        "CLARIFICATION", "INBOUND", None, None
    ) == ("DRAFT", "clarification-policy-v1")
    assert CasePolicy.validate_create(
        "PETITION", None, "OTHER", "Nội dung khác"
    ) == ("RECEIVED", "petition-policy-v1")
    with pytest.raises(CasePolicyError, match="CASE_OTHER_DESCRIPTION_REQUIRED"):
        CasePolicy.validate_create("PETITION", None, "OTHER", "")


def test_official_case_tables_are_not_generic_sync_targets():
    assert not any(
        table.startswith("procurement_case") for table in TABLE_KEYS.values()
    )
