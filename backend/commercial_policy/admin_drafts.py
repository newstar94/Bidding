"""Prepare editable drafts, preserving source configuration and release gates."""

from copy import deepcopy

from .document import build_initial_draft_document
from .errors import CommercialPolicyError


def load_legacy_export_capabilities(cursor):
    rows = cursor.execute(
        """SELECT id, document_export_word, document_export_excel,
                  document_export_award_result_excel
             FROM goi_dich_vu WHERE id IN ('silver', 'gold', 'diamond')"""
    ).fetchall()
    return {
        row["id"]: {
            "document.export.word": bool(row["document_export_word"]),
            "document.export.excel": bool(row["document_export_excel"]),
            "document.export.award_result_excel": bool(row["document_export_award_result_excel"]),
        }
        for row in rows
    }


def prepare_admin_draft(
    source_document=None, *, template_mode=None, legacy_capabilities_by_tier=None
):
    if template_mode not in (None, "empty", "blank_templates", "complete_templates"):
        raise CommercialPolicyError(
            "COMMERCIAL_POLICY_INVALID", "Cách khởi tạo bản nháp không hợp lệ."
        )
    defaults = build_initial_draft_document(legacy_capabilities_by_tier)
    document = deepcopy(source_document) if source_document else deepcopy(defaults)
    if template_mode is None and source_document:
        return document
    if template_mode == "empty":
        document["offers"] = []
        return document
    if template_mode == "complete_templates":
        source_offers = {
            (offer.get("tier"), offer.get("variant"), (offer.get("price") or {}).get("period")): offer
            for offer in document.get("offers") or []
        }
        for offer in defaults["offers"]:
            source = source_offers.get((offer["tier"], offer["variant"], "yearly"))
            if source and source.get("exportCapabilities") is not None:
                offer["exportCapabilities"] = deepcopy(source["exportCapabilities"])
        document["offers"] = defaults["offers"]
        policies = {**defaults["policies"], **(document.get("policies") or {})}
        for name in ("baseTerm", "renewalAnchor", "partialBatch"):
            policy = policies.get(name)
            if not policy or policy.get("kind") == "blocked_decision":
                policies[name] = deepcopy(defaults["policies"][name])
        document["policies"] = policies
        tax = document.get("taxInvoice")
        if tax is None:
            tax = deepcopy(defaults["taxInvoice"])
            document["taxInvoice"] = tax
        if isinstance(tax, dict):
            for key in ("taxInclusive", "invoiceEnabled"):
                if tax.get(key) is None:
                    tax[key] = defaults["taxInvoice"][key]
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
