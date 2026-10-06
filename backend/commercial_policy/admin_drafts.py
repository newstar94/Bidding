"""Prepare non-effective admin drafts without assigning commercial prices."""

from copy import deepcopy

from .document import build_initial_draft_document
from .errors import CommercialPolicyError


def prepare_admin_draft(source_document=None, *, template_mode=None):
    if template_mode not in (None, "empty", "blank_templates"):
        raise CommercialPolicyError(
            "COMMERCIAL_POLICY_INVALID", "Cách khởi tạo bản nháp không hợp lệ."
        )
    document = deepcopy(source_document) if source_document else build_initial_draft_document()
    if template_mode is None and source_document:
        return document
    if template_mode == "empty":
        document["offers"] = []
        return document
    templates = build_initial_draft_document()["offers"]
    for offer in templates:
        offer["price"].update(subtotal=None, tax=None, total=None)
        offer["memberQuota"] = 1 if offer["tier"] == "personal" else None
        offer["includedProcurementQuota"] = 0 if offer["variant"] == "internal" else None
        offer["exportCapabilities"] = None
        offer["violationCheckEnabled"] = False
        offer["salesState"] = "non_sellable"
        offer["display"]["recommended"] = False
    document["offers"] = templates
    return document
