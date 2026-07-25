"""Small policy for document upload slots in the package detail view."""

from __future__ import annotations

from backend.shared.domain_enums import enum_code


DOCUMENT_TYPES = {
    "HSMT": {
        "label": "Hồ sơ mời thầu/E-Hồ sơ mời thầu",
        "icon": "file-text",
    },
    "HSMT_APPRAISAL_REPORT": {
        "label": "Báo cáo thẩm định HSMT/E-HSMT",
        "icon": "clipboard-check",
    },
    "BID_EVALUATION_REPORT": {
        "label": "Báo cáo đánh giá E-HSDT",
        "icon": "file-check-2",
    },
    "TECHNICAL_EVALUATION_REPORT": {
        "label": "Báo cáo đánh giá E-HSĐXKT",
        "icon": "file-check-2",
    },
    "TECHNICAL_APPRAISAL_REPORT": {
        "label": "Báo cáo thẩm định nhà thầu đạt kỹ thuật",
        "icon": "clipboard-check",
    },
    "FINANCIAL_EVALUATION_REPORT": {
        "label": "Báo cáo đánh giá E-HSĐXTC",
        "icon": "badge-dollar-sign",
    },
    "RESULT_APPRAISAL_REPORT": {
        "label": "Báo cáo thẩm định kết quả lựa chọn nhà thầu",
        "icon": "clipboard-check",
    },
}

DOCUMENT_TYPE_ORDER = tuple(DOCUMENT_TYPES)
TWO_ENVELOPE_METHOD = "Một giai đoạn hai túi hồ sơ"
PREPARATION_REACHED_STATUSES = {
    "PREPARING",
    "INVITED",
    "OPENED",
    "EVALUATING",
    "PARTIALLY_AWARDED",
    "AWARDED",
    "CANCELLED",
}
EVALUATION_REACHED_STATUSES = {
    "EVALUATING",
    "PARTIALLY_AWARDED",
    "AWARDED",
}


def _package_value(package, snake_name, camel_name):
    if not package:
        return None
    if hasattr(package, "get"):
        return package.get(snake_name, package.get(camel_name))
    return None


def package_status_code(package):
    return enum_code(
        "goi_thau",
        "trang_thai",
        _package_value(package, "trang_thai", "trangThai"),
    )


def _preparation_document_types(package):
    document_types = ["HSMT"]
    if str(
        _package_value(
            package,
            "yeu_cau_tham_dinh_hsmt",
            "yeuCauThamDinhHsmt",
        )
        or ""
    ).strip() == "Có":
        document_types.append("HSMT_APPRAISAL_REPORT")
    return tuple(document_types)


def _evaluation_document_types(package):
    method = str(
        _package_value(
            package,
            "phuong_thuc_lua_chon",
            "phuongThucLuaChon",
        )
        or ""
    ).strip()
    if method == TWO_ENVELOPE_METHOD:
        return (
            "TECHNICAL_EVALUATION_REPORT",
            "TECHNICAL_APPRAISAL_REPORT",
            "FINANCIAL_EVALUATION_REPORT",
            "RESULT_APPRAISAL_REPORT",
        )
    return ("BID_EVALUATION_REPORT", "RESULT_APPRAISAL_REPORT")


def allowed_upload_types(package):
    """Return cumulative upload types unlocked through the current step."""

    status = package_status_code(package)
    if status == "CANCELLED":
        return ()
    return document_types_through_current_step(package)


def document_types_through_current_step(package):
    """Return every expected document type from prior steps through the current one."""

    status = package_status_code(package)
    visible = []
    if status in PREPARATION_REACHED_STATUSES:
        visible.extend(_preparation_document_types(package))
    if status in EVALUATION_REACHED_STATUSES:
        visible.extend(_evaluation_document_types(package))
    return tuple(visible)


def visible_document_types(package, existing_types=()):
    """Show cumulative expected slots plus every file already attached."""

    visible = set(document_types_through_current_step(package))
    visible.update(value for value in existing_types if value in DOCUMENT_TYPES)
    return tuple(value for value in DOCUMENT_TYPE_ORDER if value in visible)


def document_type_definition(document_type):
    return DOCUMENT_TYPES.get(str(document_type or "").strip())
