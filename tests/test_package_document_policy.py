from pathlib import Path

import pytest

from backend.db.schema import SCHEMA_DINH_NGHIA
from backend.documents import package_document_service as service
from backend.documents.package_document_policy import (
    allowed_upload_types,
    document_types_through_current_step,
    visible_document_types,
)
from backend.http_middleware import BodySizeLimitMiddleware


def package(status, *, method="Một giai đoạn một túi hồ sơ", appraisal="Không"):
    return {
        "trang_thai": status,
        "phuong_thuc_lua_chon": method,
        "yeu_cau_tham_dinh_hsmt": appraisal,
    }


def test_preparation_only_unlocks_tender_documents():
    assert allowed_upload_types(package("PREPARING")) == ("HSMT",)
    assert allowed_upload_types(package("Chuẩn bị", appraisal="Có")) == (
        "HSMT",
        "HSMT_APPRAISAL_REPORT",
    )


def test_one_envelope_evaluation_keeps_preparation_upload_available():
    assert allowed_upload_types(package("EVALUATING")) == (
        "HSMT",
        "BID_EVALUATION_REPORT",
        "RESULT_APPRAISAL_REPORT",
    )


def test_two_envelope_evaluation_keeps_preparation_upload_available():
    assert allowed_upload_types(
        package(
            "Đang chấm thầu",
            method="Một giai đoạn hai túi hồ sơ",
        )
    ) == (
        "HSMT",
        "TECHNICAL_EVALUATION_REPORT",
        "TECHNICAL_APPRAISAL_REPORT",
        "FINANCIAL_EVALUATION_REPORT",
        "RESULT_APPRAISAL_REPORT",
    )


@pytest.mark.parametrize(
    "status",
    ["INVITED", "OPENED"],
)
def test_invitation_steps_allow_missing_preparation_document_upload(status):
    assert allowed_upload_types(package(status)) == ("HSMT",)


@pytest.mark.parametrize("status", ["PARTIALLY_AWARDED", "AWARDED"])
def test_result_steps_allow_backfilling_all_reached_documents(status):
    assert allowed_upload_types(package(status)) == (
        "HSMT",
        "BID_EVALUATION_REPORT",
        "RESULT_APPRAISAL_REPORT",
    )


def test_cancelled_package_remains_read_only():
    assert allowed_upload_types(package("CANCELLED")) == ()


def test_invitation_step_lists_missing_preparation_documents():
    assert document_types_through_current_step(package("INVITED")) == ("HSMT",)
    assert visible_document_types(package("Đang mời thầu")) == ("HSMT",)


def test_one_envelope_evaluation_lists_documents_cumulatively():
    assert document_types_through_current_step(package("EVALUATING")) == (
        "HSMT",
        "BID_EVALUATION_REPORT",
        "RESULT_APPRAISAL_REPORT",
    )


def test_two_envelope_evaluation_lists_documents_cumulatively():
    assert document_types_through_current_step(
        package(
            "EVALUATING",
            method="Một giai đoạn hai túi hồ sơ",
            appraisal="Có",
        )
    ) == (
        "HSMT",
        "HSMT_APPRAISAL_REPORT",
        "TECHNICAL_EVALUATION_REPORT",
        "TECHNICAL_APPRAISAL_REPORT",
        "FINANCIAL_EVALUATION_REPORT",
        "RESULT_APPRAISAL_REPORT",
    )


def test_expected_and_existing_documents_remain_visible_after_package_moves_on():
    assert visible_document_types(
        package("AWARDED"),
        ("HSMT", "BID_EVALUATION_REPORT"),
    ) == (
        "HSMT",
        "BID_EVALUATION_REPORT",
        "RESULT_APPRAISAL_REPORT",
    )


def test_schema_keeps_one_current_file_per_type():
    schema = SCHEMA_DINH_NGHIA["tai_lieu_goi_thau"]
    assert (
        "UNIQUE(organization_id, goi_thau_id, document_type)"
        in schema["unique_constraints"]
    )
    assert "storage_key" in schema["columns"]
    assert "sha256" in schema["columns"]


def test_private_storage_round_trip_and_path_guard(tmp_path, monkeypatch):
    root = tmp_path / "documents"
    monkeypatch.setattr(service, "PACKAGE_DOCUMENT_ROOT", root)
    source = tmp_path / "report.pdf"
    source.write_bytes(b"%PDF-1.7\ncontent\n%%EOF\n")
    storage_key = service.create_storage_key("org-a", "package-a", ".pdf")

    size, checksum = service.persist_upload_path(source, storage_key)
    stored_path = service.resolve_storage_key(storage_key)

    assert size == source.stat().st_size
    assert len(checksum) == 64
    assert stored_path.read_bytes() == source.read_bytes()
    service.remove_storage_key(storage_key)
    assert not stored_path.exists()
    with pytest.raises(service.PackageDocumentError):
        service.resolve_storage_key("../outside.pdf")


def test_pdf_validation_rejects_non_pdf(tmp_path):
    invalid = Path(tmp_path) / "invalid.pdf"
    invalid.write_bytes(b"not a pdf")
    with pytest.raises(service.PackageDocumentError):
        service.validate_pdf_path(invalid)


def test_package_document_route_gets_multipart_body_limit(monkeypatch):
    monkeypatch.setenv("REQUEST_MAX_PACKAGE_DOCUMENT_BYTES", "27262976")
    assert BodySizeLimitMiddleware._limit_for_path(
        "/api/packages/gt-1/documents/HSMT"
    ) == 27_262_976
