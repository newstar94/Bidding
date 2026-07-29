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
PREPARATION_DOCUMENT_TYPES = frozenset({"HSMT", "HSMT_APPRAISAL_REPORT"})
EVALUATION_DOCUMENT_TYPES = frozenset(
    {
        "BID_EVALUATION_REPORT",
        "TECHNICAL_EVALUATION_REPORT",
        "TECHNICAL_APPRAISAL_REPORT",
        "FINANCIAL_EVALUATION_REPORT",
        "RESULT_APPRAISAL_REPORT",
    }
)
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
    if status in {"AWARDED", "CANCELLED"}:
        return ()
    if status == "PARTIALLY_AWARDED":
        return _evaluation_document_types(package)
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


def is_evaluation_document_type(document_type):
    return str(document_type or "").strip() in EVALUATION_DOCUMENT_TYPES


def _slot(document_type, document, *, can_mutate, evaluation_batch_id=None):
    definition = document_type_definition(document_type)
    return {
        "type": document_type,
        "label": definition["label"],
        "icon": definition["icon"],
        "evaluationBatchId": evaluation_batch_id,
        "canUpload": can_mutate,
        "canDelete": can_mutate,
        "document": document,
    }


def compose_document_sections(package, documents, evaluation_batches, *, write_allowed):
    """Build package-level and batch-level document groups for the API."""

    documents = tuple(documents or ())
    batches = tuple(evaluation_batches or ())
    has_lots = str(_package_value(package, "phan_lo", "phanLo") or "").strip() == "Có"
    allowed = set(allowed_upload_types(package))
    visible = set(visible_document_types(package, (item.get("type") for item in documents)))
    by_scope = {
        (item.get("evaluationBatchId"), item.get("type")): item
        for item in documents
    }
    sections = []

    general_types = [
        document_type
        for document_type in DOCUMENT_TYPE_ORDER
        if document_type in visible
        and (not has_lots or document_type in PREPARATION_DOCUMENT_TYPES)
    ]
    if general_types:
        sections.append(
            {
                "scopeType": "PACKAGE",
                "scopeKey": "package",
                "title": "Tài liệu chung của gói thầu" if has_lots else "Tài liệu gói thầu",
                "description": (
                    "Áp dụng chung cho toàn bộ các phần lô."
                    if has_lots
                    else "Tài liệu theo tiến trình của gói thầu."
                ),
                "status": None,
                "evaluationBatchId": None,
                "sequenceNo": None,
                "lotIds": [],
                "lotCodes": [],
                "slots": [
                    _slot(
                        document_type,
                        by_scope.get((None, document_type)),
                        can_mutate=write_allowed and document_type in allowed,
                    )
                    for document_type in general_types
                ],
            }
        )

    if has_lots:
        for batch in batches:
            batch_id = str(batch.get("id") or "").strip()
            if not batch_id:
                continue
            batch_documents = {
                item.get("type"): item
                for item in documents
                if item.get("evaluationBatchId") == batch_id
            }
            batch_types = [
                document_type
                for document_type in DOCUMENT_TYPE_ORDER
                if document_type in EVALUATION_DOCUMENT_TYPES
                and (document_type in visible or document_type in batch_documents)
            ]
            if not batch_types:
                continue
            batch_status = str(batch.get("status") or "").strip().upper()
            if batch_status == "VOID" and not batch_documents:
                continue
            sequence_no = int(batch.get("sequenceNo") or 0)
            can_mutate_batch = write_allowed and batch_status == "ACTIVE"
            sections.append(
                {
                    "scopeType": "EVALUATION_BATCH",
                    "scopeKey": f"batch:{batch_id}",
                    "title": f"Đợt đánh giá {sequence_no}" if sequence_no else "Đợt đánh giá",
                    "description": "Các tài liệu chỉ thuộc phạm vi phần lô của đợt này.",
                    "status": batch_status,
                    "evaluationBatchId": batch_id,
                    "sequenceNo": sequence_no or None,
                    "lotIds": list(batch.get("lotIds") or ()),
                    "lotCodes": list(batch.get("lotCodes") or ()),
                    "slots": [
                        _slot(
                            document_type,
                            batch_documents.get(document_type),
                            can_mutate=(
                                can_mutate_batch and document_type in allowed
                            ),
                            evaluation_batch_id=batch_id,
                        )
                        for document_type in batch_types
                    ],
                }
            )

        legacy_documents = {
            item.get("type"): item
            for item in documents
            if item.get("evaluationBatchId") is None
            and item.get("type") in EVALUATION_DOCUMENT_TYPES
        }
        if legacy_documents:
            sections.append(
                {
                    "scopeType": "LEGACY_EVALUATION",
                    "scopeKey": "legacy-evaluation",
                    "title": "Tài liệu đánh giá trước khi phân đợt",
                    "description": "Tài liệu lịch sử chưa xác định được đợt và được giữ nguyên để tránh mất dữ liệu.",
                    "status": "LEGACY",
                    "evaluationBatchId": None,
                    "sequenceNo": None,
                    "lotIds": [],
                    "lotCodes": [],
                    "slots": [
                        _slot(
                            document_type,
                            legacy_documents[document_type],
                            can_mutate=False,
                        )
                        for document_type in DOCUMENT_TYPE_ORDER
                        if document_type in legacy_documents
                    ],
                }
            )
    return sections
