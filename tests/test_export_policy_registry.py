import pytest

from backend.app import routes
from backend.documents.export_policy_registry import EXPORT_POLICIES, export_policy


def test_required_export_matrix_has_explicit_classification_and_format():
    required = {
        "excel.generic_import_template",
        "excel.opening_template",
        "excel.package_lot_draft_template",
        "excel.optional_purchase_draft_template",
        "excel.financial_opening",
        "excel.evaluation",
        "excel.award_result",
        "excel.timeline",
        "docx.package_report",
    }

    assert required <= set(EXPORT_POLICIES)
    assert all(policy.format in {"docx", "xlsx"} for policy in EXPORT_POLICIES.values())
    assert all(policy.classification for policy in EXPORT_POLICIES.values())


def test_unregistered_export_operation_fails_closed():
    with pytest.raises(ValueError, match="DOCUMENT_EXPORT_OPERATION_UNREGISTERED"):
        export_policy("excel.unknown")


def test_client_row_endpoints_are_explicitly_draft_templates():
    assert export_policy("excel.package_lot_draft_template").classification == "draft_template"
    assert export_policy("excel.optional_purchase_draft_template").classification == "draft_template"


def test_every_production_export_artifact_route_is_bound_to_registered_policy():
    expected = {
        "/api/export-report/{package_id}": "docx.package_report",
        "/api/export-timeline/{package_id}": "excel.timeline",
        "/api/export-plan/{plan_id}": "docx.plan",
        "/api/export-excel-template/{import_type}": "excel.generic_import_template",
        "/api/export-mothau-template": "excel.opening_template",
        "/api/export-danhgiahsdt-template": "excel.evaluation",
        "/api/export-ketquaqd-template": "excel.award_result",
        "/api/export-opening-fin-template": "excel.financial_opening",
        "/api/export-phanlo-excel": "excel.package_lot_draft_template",
        "/api/export-tuychonmuathem-excel": "excel.optional_purchase_draft_template",
        "/api/packages/{package_id}/winning-goods.xlsx": "excel.winning_goods",
        "/api/packages/{package_id}/award-result-excel/export": "excel.award_result",
        "/api/packages/{package_id}/award-result-excel/reconciliation": "excel.award_result_reconciliation",
        "/api/document-jobs/package-report/{package_id}": "docx.package_report",
        "/api/document-jobs/{job_id}/download": "docx.package_report",
        "/api/document-jobs/{job_id}/retry": "docx.package_report",
    }
    discovered = {}
    for route in routes:
        path = getattr(route, "path", "")
        methods = set(getattr(route, "methods", ()) or ())
        is_artifact_route = (
            path.startswith("/api/export-")
            or path.endswith(".xlsx")
            or path.endswith("/award-result-excel/export")
            or path.endswith("/award-result-excel/reconciliation")
            or (
                path.startswith("/api/document-jobs/")
                and ("/package-report/" in path or path.endswith("/download") or path.endswith("/retry"))
            )
        )
        if not is_artifact_route or not methods:
            continue
        operation = getattr(route.endpoint, "export_policy_operation", None)
        assert operation in EXPORT_POLICIES, f"{path} is outside the export policy registry"
        discovered[path] = operation

    assert discovered == expected
