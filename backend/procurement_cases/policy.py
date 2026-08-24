"""Pure versioned state policies for shared procurement cases."""

from __future__ import annotations


POLICY_VERSIONS = {
    "CLARIFICATION": "clarification-policy-v1",
    "PETITION": "petition-policy-v1",
}

PETITION_CATEGORIES = frozenset({"E_HSMT", "CONTRACTOR_SELECTION_RESULT", "OTHER"})

_TRANSITIONS = {
    "CLARIFICATION": {
        "SUBMIT_REVIEW": ({"DRAFT", "RETURNED"}, "UNDER_REVIEW", True),
        "RETURN": ({"UNDER_REVIEW"}, "RETURNED", False),
        "APPROVE": ({"UNDER_REVIEW"}, "APPROVED", True),
        "ISSUE": ({"APPROVED"}, "ISSUED", True),
        "CLOSE": ({"ISSUED"}, "CLOSED", False),
        "WITHDRAW": ({"DRAFT", "RETURNED", "UNDER_REVIEW", "APPROVED"}, "WITHDRAWN", False),
        "REOPEN": ({"CLOSED"}, "DRAFT", False),
    },
    "PETITION": {
        "ASSIGN": ({"RECEIVED"}, "ASSIGNED", False),
        "START_REVIEW": ({"ASSIGNED"}, "UNDER_REVIEW", False),
        "DRAFT_RESPONSE": ({"UNDER_REVIEW", "RETURNED"}, "DRAFT_RESPONSE", True),
        "RETURN": ({"DRAFT_RESPONSE"}, "RETURNED", False),
        "APPROVE": ({"DRAFT_RESPONSE"}, "APPROVED", True),
        "ISSUE": ({"APPROVED"}, "ISSUED", True),
        "CLOSE": ({"ISSUED"}, "CLOSED", False),
        "REJECT": ({"RECEIVED", "ASSIGNED", "UNDER_REVIEW"}, "REJECTED", False),
        "WITHDRAW": ({"RECEIVED", "ASSIGNED", "UNDER_REVIEW", "DRAFT_RESPONSE", "APPROVED"}, "WITHDRAWN", False),
        "REOPEN": ({"CLOSED"}, "RECEIVED", False),
    },
}


class CasePolicyError(ValueError):
    def __init__(self, code, fields=None):
        super().__init__(code)
        self.code = code
        self.fields = fields or {}


class CasePolicy:
    @staticmethod
    def validate_create(case_type, direction, category, other_description):
        if case_type not in POLICY_VERSIONS:
            raise CasePolicyError("CASE_TYPE_INVALID")
        if case_type == "CLARIFICATION":
            if direction not in {"INBOUND", "OUTBOUND"}:
                raise CasePolicyError("CASE_DIRECTION_REQUIRED")
            if category or other_description:
                raise CasePolicyError("CASE_PETITION_FIELDS_NOT_ALLOWED")
            return "DRAFT", POLICY_VERSIONS[case_type]
        if direction:
            raise CasePolicyError("CASE_DIRECTION_NOT_ALLOWED")
        if category not in PETITION_CATEGORIES:
            raise CasePolicyError("CASE_CATEGORY_REQUIRED")
        if category == "OTHER" and not str(other_description or "").strip():
            raise CasePolicyError("CASE_OTHER_DESCRIPTION_REQUIRED")
        return "RECEIVED", POLICY_VERSIONS[case_type]

    @staticmethod
    def transition(case_type, state, action, *, has_response=False):
        policy = _TRANSITIONS.get(case_type, {})
        spec = policy.get(action)
        if spec is None:
            raise CasePolicyError("CASE_ACTION_NOT_ALLOWED")
        source_states, target_state, response_required = spec
        if state not in source_states:
            raise CasePolicyError("CASE_STATE_TRANSITION_INVALID")
        if response_required and not has_response:
            raise CasePolicyError("CASE_RESPONSE_REQUIRED")
        return target_state

    @staticmethod
    def available_actions(case_type, state, *, has_response=False):
        actions = []
        for action in _TRANSITIONS.get(case_type, {}):
            try:
                CasePolicy.transition(
                    case_type, state, action, has_response=has_response
                )
            except CasePolicyError:
                continue
            actions.append(action)
        if state not in {"ISSUED", "CLOSED", "WITHDRAWN", "REJECTED"}:
            actions.extend(("SAVE_RESPONSE", "SET_DUE_DATE", "ADD_PARTY", "ADD_ATTACHMENT"))
        actions.append("ADD_LEGAL_BASIS")
        return actions
