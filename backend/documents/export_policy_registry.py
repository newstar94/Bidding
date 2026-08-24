"""Server-owned classification and entitlement contract for export routes."""

from __future__ import annotations

from dataclasses import dataclass
from functools import wraps


@dataclass(frozen=True)
class ExportPolicy:
    classification: str
    format: str
    entitlement_required: bool
    resource_scope: str
    audit_action: str


EXPORT_POLICIES = {
    "excel.generic_import_template": ExportPolicy(
        "empty_template", "xlsx", False, "session", "document.excel_template_exported",
    ),
    "excel.opening_template": ExportPolicy(
        "empty_template", "xlsx", False, "session", "document.opening_template_exported",
    ),
    "excel.package_lot_draft_template": ExportPolicy(
        "draft_template", "xlsx", False, "session", "document.package_lot_draft_exported",
    ),
    "excel.optional_purchase_draft_template": ExportPolicy(
        "draft_template", "xlsx", False, "session", "document.optional_purchase_draft_exported",
    ),
    "excel.financial_opening": ExportPolicy(
        "official_snapshot", "xlsx", True, "package", "document.financial_opening_exported",
    ),
    "excel.evaluation": ExportPolicy(
        "official_snapshot", "xlsx", True, "package", "document.evaluation_exported",
    ),
    "excel.award_result": ExportPolicy(
        "official_snapshot", "xlsx", True, "package", "document.award_result_exported",
    ),
    "excel.award_result_reconciliation": ExportPolicy(
        "official_snapshot", "xlsx", True, "package", "document.award_result_reconciliation_exported",
    ),
    "excel.winning_goods": ExportPolicy(
        "official_snapshot", "xlsx", True, "package", "document.winning_goods_exported",
    ),
    "excel.timeline": ExportPolicy(
        "official_snapshot", "xlsx", True, "package", "document.timeline_exported",
    ),
    "docx.package_report": ExportPolicy(
        "official_snapshot", "docx", True, "package", "document.package_report_exported",
    ),
    "docx.plan": ExportPolicy(
        "official_snapshot", "docx", True, "plan", "document.plan_exported",
    ),
    "docx.document_job": ExportPolicy(
        "official_snapshot", "docx", True, "job_record",
        "document.export_job_downloaded",
    ),
}


def export_policy(operation: str) -> ExportPolicy:
    try:
        return EXPORT_POLICIES[str(operation)]
    except KeyError as error:
        raise ValueError("DOCUMENT_EXPORT_OPERATION_UNREGISTERED") from error


def governed_export(operation: str):
    """Bind a production export endpoint to one registered server policy.

    The policy lookup happens both when routes are composed and when an endpoint
    is invoked.  A missing/renamed operation therefore fails closed instead of
    leaving a route outside the export inventory.
    """

    export_policy(operation)

    def decorate(handler):
        @wraps(handler)
        async def governed(*args, **kwargs):
            export_policy(operation)
            return await handler(*args, **kwargs)

        governed.export_policy_operation = operation
        return governed

    return decorate
