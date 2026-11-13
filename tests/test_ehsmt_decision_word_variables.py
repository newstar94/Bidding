"""ADR 0102: E-HSMT approval and adjustment decisions in Word exports."""

import sqlite3

import pytest
from docx import Document

from backend.documents import timeline_context_service
from backend.documents.custom_exporter import generate_report_from_custom_template
from backend.documents.docx_context_policy import (
    filter_mapping_rows,
    project_docx_context,
    seal_docx_context,
    validate_mapping_definition,
)
from backend.documents.docx_mapping_service import apply_custom_mappings
from backend.documents.field_manifest import FIELD_LABELS_BY_TABLE
from backend.documents.word_defaults import (
    WORD_DEFAULT_MAPPINGS_VERSION,
    build_default_word_mappings,
)
from backend.timeline.ehsmt_decisions import (
    EHSMT_DECISION_FIELDS,
    EHSMT_DECISION_LIST_ROOT,
    build_ehsmt_decisions,
)
from backend.timeline.word_fields import (
    PLAN_SECTION_MILESTONE_KEYS,
    milestone_values_from_rows,
    with_original_version_values,
)

PACKAGE_DOCUMENT_TYPES = ("evaluation", "hsmt", "opening", "result", "contract", "liquidation")


def _row(key, number, date, *, repeatable=False, entity="", order=0.0, applicable=True):
    return {
        "milestone_key": key,
        "applicability": "APPLICABLE" if applicable else "NOT_APPLICABLE",
        "is_repeatable": repeatable,
        "source_entity_id": entity,
        "sort_order": order,
        "so_van_ban": number,
        "ngay_thuc_te": date,
        "ngay_du_kien": "",
    }


def test_builder_puts_the_original_first_then_adjustments_in_timeline_order():
    original = [
        _row("E_HSMT_SUBMISSION", "TTr-01", "2026-02-01"),
        _row("E_HSMT_APPROVAL", "QĐ-GỐC", "2026-02-05"),
    ]
    version = [
        _row("E_HSMT_APPROVAL", "QĐ-ĐC2", "2026-04-01"),
        _row("E_HSMT_ADJUSTMENT_APPROVAL", "QĐ-ĐC2", "2026-04-01",
             repeatable=True, entity="adj-2", order=560.02),
        _row("E_HSMT_ADJUSTMENT_APPROVAL", "QĐ-ĐC1", "2026-03-01",
             repeatable=True, entity="adj-1", order=560.01),
        _row("E_HSMT_ADJUSTMENT_APPROVAL", "QĐ-ẨN", "2026-03-15",
             repeatable=True, entity="adj-x", order=560.015, applicable=False),
    ]
    adjustments = [
        {"id": "adj-1", "sequence": 1, "reason": "Sửa tiêu chuẩn kỹ thuật",
         "submission_number": "TTr-ĐC1", "submission_date": "2026-02-25T00:00:00",
         "appraisal_report_number": "BCTĐ-ĐC1", "appraisal_report_date": "2026-02-27"},
        {"id": "adj-2", "sequence": 2},
    ]

    items = build_ehsmt_decisions(original, version, adjustments)

    assert [(item["lan"], item["loai"], item["so_quyet_dinh"]) for item in items] == [
        (0, "Phê duyệt E-HSMT", "QĐ-GỐC"),
        (1, "Điều chỉnh E-HSMT lần 1", "QĐ-ĐC1"),
        (2, "Điều chỉnh E-HSMT lần 2", "QĐ-ĐC2"),
    ]
    assert items[0]["so_to_trinh"] == "TTr-01"
    assert items[0]["ngay_to_trinh"] == "2026-02-01"
    assert items[1] == {
        "lan": 1,
        "loai": "Điều chỉnh E-HSMT lần 1",
        "so_quyet_dinh": "QĐ-ĐC1",
        "ngay_quyet_dinh": "2026-03-01",
        "so_to_trinh": "TTr-ĐC1",
        "ngay_to_trinh": "2026-02-25",
        "so_bao_cao_tham_dinh": "BCTĐ-ĐC1",
        "ngay_bao_cao_tham_dinh": "2026-02-27",
        "ly_do": "Sửa tiêu chuẩn kỹ thuật",
    }
    assert all(set(item) == set(EHSMT_DECISION_FIELDS) for item in items)


def test_builder_without_an_applicable_original_lists_only_adjustments():
    version = [_row("E_HSMT_ADJUSTMENT_APPROVAL", "QĐ-ĐC1", "2026-03-01",
                    repeatable=True, entity="missing-record", order=560.01)]

    items = build_ehsmt_decisions([], version, [])

    assert [(item["lan"], item["so_quyet_dinh"], item["ly_do"]) for item in items] == [
        (1, "QĐ-ĐC1", ""),
    ]


def test_latest_instance_scalar_takes_the_last_applicable_adjustment():
    rows = [
        _row("E_HSMT_ADJUSTMENT_APPROVAL", "QĐ-ĐC1", "2026-03-01", repeatable=True, order=560.01),
        _row("E_HSMT_ADJUSTMENT_APPROVAL", "QĐ-ĐC2", "", repeatable=True, order=560.02),
        _row("E_HSMT_ADJUSTMENT_APPROVAL", "QĐ-ẨN", "", repeatable=True, order=560.03,
             applicable=False),
    ]

    assert milestone_values_from_rows(rows)["E_HSMT_ADJUSTMENT_APPROVAL"] == ("QĐ-ĐC2", "")
    assert "E_HSMT_ADJUSTMENT_APPROVAL" not in milestone_values_from_rows(
        rows, PLAN_SECTION_MILESTONE_KEYS
    )


def test_original_version_values_replace_only_the_approval_milestone():
    merged = with_original_version_values(
        {"E_HSMT_APPROVAL": ("QĐ-ĐC2", "2026-04-01"), "BID_EVALUATION_REPORT": ("BC", "")},
        {"E_HSMT_APPROVAL": ("QĐ-GỐC", "2026-02-05"), "BID_EVALUATION_REPORT": ("cũ", "")},
    )

    assert merged == {
        "E_HSMT_APPROVAL": ("QĐ-GỐC", "2026-02-05"),
        "BID_EVALUATION_REPORT": ("BC", ""),
    }
    assert with_original_version_values({"E_HSMT_APPROVAL": ("X", "")}, {}) == {
        "E_HSMT_APPROVAL": ("", ""),
    }


def _database():
    connection = sqlite3.connect(":memory:")
    connection.row_factory = sqlite3.Row
    connection.executescript(
        """
        CREATE TABLE goi_thau (
            id TEXT, organization_id TEXT, ke_hoach_id TEXT,
            hinh_thuc_lua_chon TEXT, phuong_thuc_lua_chon TEXT, linh_vuc TEXT,
            created_at TEXT, id_goc TEXT, phien_ban TEXT, archived_at TEXT,
            so_quyet_dinh TEXT, ngay_quyet_dinh TEXT,
            so_to_trinh_hsmt TEXT, ngay_trinh_hsmt TEXT
        );
        CREATE TABLE ke_hoach_lcnt (
            id TEXT, organization_id TEXT, phe_duyet TEXT,
            quyet_dinh_phe_duyet TEXT, ngay_phe_duyet TEXT
        );
        CREATE TABLE goi_thau_moc_tien_do (
            id TEXT, organization_id TEXT, goi_thau_id TEXT,
            milestone_key TEXT, instance_key TEXT, ma_moc TEXT,
            so_van_ban TEXT, ngay_du_kien TEXT, ngay_thuc_te TEXT,
            trang_thai TEXT, source_mode TEXT, sort_order REAL
        );
        """
    )
    connection.execute(
        "INSERT INTO ke_hoach_lcnt VALUES ('plan-1', 'org', 'Kế hoạch', '12/QĐ-UBND', '2026-01-05')"
    )
    connection.executemany(
        """INSERT INTO goi_thau VALUES (?, ?, 'plan-1', 'Đấu thầu rộng rãi',
               'Một giai đoạn một túi hồ sơ', 'Hàng hóa', ?, ?, ?, ?, ?, ?, ?, ?)""",
        [
            ("pkg-0", "org", "2026-01-10", None, "00", None, "QĐ-GỐC", "2026-02-05", "TTr-01", "2026-02-01"),
            ("pkg-1", "org", "2026-01-10", "pkg-0", "01", None, "QĐ-ĐC1", "2026-03-01", "TTr-01", "2026-02-01"),
            ("pkg-2", "org", "2026-01-10", "pkg-0", "02", None, "QĐ-ĐC2", "2026-04-01", "TTr-01", "2026-02-01"),
            # Same lineage id in another tenant must never become the original.
            ("pkg-x", "other", "2025-01-01", "pkg-0", "00", None, "QĐ-LẠ", "2025-01-01", "", ""),
            # An archived version that would otherwise sort first is ignored.
            ("pkg-old", "org", "2025-12-01", "pkg-0", "00", "2026-01-01", "QĐ-HỦY", "2025-12-01", "", ""),
        ],
    )
    return connection


ADJUSTMENTS = {
    "pkg-1": [
        {"id": "package-version:pkg-1", "sequence": 1, "approval_decision_number": "QĐ-ĐC1",
         "approval_decision_date": "2026-03-01", "reason": "Sửa tiêu chuẩn kỹ thuật",
         "submission_number": "TTr-ĐC1", "submission_date": "2026-02-25"},
    ],
    "pkg-2": [
        {"id": "package-version:pkg-1", "sequence": 1, "approval_decision_number": "QĐ-ĐC1",
         "approval_decision_date": "2026-03-01", "reason": "Sửa tiêu chuẩn kỹ thuật",
         "submission_number": "TTr-ĐC1", "submission_date": "2026-02-25"},
        {"id": "package-version:pkg-2", "sequence": 2, "approval_decision_number": "QĐ-ĐC2",
         "approval_decision_date": "2026-04-01", "reason": "Gia hạn thời gian thực hiện"},
        {"id": "removed", "sequence": 3, "approval_decision_number": "QĐ-ẨN",
         "archived_at": "2026-04-02"},
    ],
}


@pytest.fixture
def cursor(monkeypatch):
    monkeypatch.setattr(
        timeline_context_service,
        "_load_related",
        lambda _cursor, _organization_id, package_id: {
            "ehsmtAdjustments": [dict(item) for item in ADJUSTMENTS.get(package_id, [])],
        },
    )
    connection = _database()
    yield connection.cursor()
    connection.close()


def test_amended_version_prints_the_original_approval_and_every_adjustment(cursor):
    context = timeline_context_service.load_timeline_word_context(cursor, "org", "pkg-2")

    assert context["moc_so_qd_pd_hsmt"] == "QĐ-GỐC"
    assert context["moc_ngay_qd_pd_hsmt"] == "2026-02-05"
    assert context["moc_so_qd_dc_hsmt"] == "QĐ-ĐC2"
    assert context["moc_ngay_qd_dc_hsmt"] == "2026-04-01"
    items = context[EHSMT_DECISION_LIST_ROOT]
    assert [(item["lan"], item["so_quyet_dinh"], item["ngay_quyet_dinh"]) for item in items] == [
        (0, "QĐ-GỐC", "2026-02-05"),
        (1, "QĐ-ĐC1", "2026-03-01"),
        (2, "QĐ-ĐC2", "2026-04-01"),
    ]
    assert items[1]["so_to_trinh"] == "TTr-ĐC1"
    assert items[1]["ly_do"] == "Sửa tiêu chuẩn kỹ thuật"
    assert items[2]["ly_do"] == "Gia hạn thời gian thực hiện"


def test_first_version_has_no_adjustment(cursor):
    context = timeline_context_service.load_timeline_word_context(cursor, "org", "pkg-0")

    assert context["moc_so_qd_pd_hsmt"] == "QĐ-GỐC"
    assert context["moc_so_qd_dc_hsmt"] == ""
    assert context["moc_ngay_qd_dc_hsmt"] == ""
    assert [item["lan"] for item in context[EHSMT_DECISION_LIST_ROOT]] == [0]


def test_catalog_exposes_the_list_and_the_latest_adjustment_pair():
    defaults = {row["ten_bien"]: row for row in build_default_word_mappings()}

    assert WORD_DEFAULT_MAPPINGS_VERSION >= 19
    assert defaults["ds_qd_hsmt"]["source_table"] == EHSMT_DECISION_LIST_ROOT
    assert defaults["ds_qd_hsmt"]["source_column"] == ""
    assert defaults["so_qd_dc_hsmt"]["source_column"] == "moc_so_qd_dc_hsmt"
    assert defaults["ngay_qd_dc_hsmt"]["format"] == "date"
    assert "gốc" in defaults["so_qd_pd_hsmt"]["mo_ta"]
    assert set(FIELD_LABELS_BY_TABLE[EHSMT_DECISION_LIST_ROOT]) == set(EHSMT_DECISION_FIELDS)


@pytest.mark.parametrize("document_type", PACKAGE_DOCUMENT_TYPES)
def test_list_mapping_is_valid_for_package_exports(document_type):
    rows = [("ds_qd_hsmt", EHSMT_DECISION_LIST_ROOT, "")]
    validate_mapping_definition(*rows[0], document_type=document_type)
    assert filter_mapping_rows(rows, document_type) == rows


def test_list_mapping_is_rejected_for_plan_exports():
    with pytest.raises(ValueError):
        validate_mapping_definition(
            "ds_qd_hsmt", EHSMT_DECISION_LIST_ROOT, "", document_type="plan"
        )


def test_projection_keeps_only_declared_fields():
    projected = project_docx_context("hsmt", {
        EHSMT_DECISION_LIST_ROOT: [{"lan": 0, "so_quyet_dinh": "QĐ", "secret": "x"}],
    })
    assert projected[EHSMT_DECISION_LIST_ROOT] == [{"lan": 0, "so_quyet_dinh": "QĐ"}]


def test_sealed_list_renders_in_a_template_loop(cursor, tmp_path):
    mappings = [
        (row["ten_bien"], row["source_table"], row["source_column"])
        for row in build_default_word_mappings()
        if row["ten_bien"] in {"ds_qd_hsmt", "so_qd_pd_hsmt", "so_qd_dc_hsmt", "ngay_qd_dc_hsmt"}
    ]
    context = project_docx_context("hsmt", {
        "goi_thau": {"id": "pkg-2", "ten_goi_thau": "Gói thầu A"},
        **timeline_context_service.load_timeline_word_context(cursor, "org", "pkg-2"),
    })
    apply_custom_mappings(context, mappings)
    sealed, manifest = seal_docx_context("hsmt", context, mappings)

    template = Document()
    template.add_paragraph("Gốc {so_qd_pd_hsmt}; mới nhất {so_qd_dc_hsmt} ({S_ngay_qd_dc_hsmt})")
    template.add_paragraph("{#ds_qd_hsmt}[{loai}: {so_quyet_dinh} ngày {S_ngay_quyet_dinh}]{/ds_qd_hsmt}")
    template_path = tmp_path / "qd_hsmt.docx"
    template.save(template_path)

    output = generate_report_from_custom_template(str(template_path), sealed, manifest)
    text = "\n".join(paragraph.text for paragraph in Document(output).paragraphs)

    assert "Gốc QĐ-GỐC; mới nhất QĐ-ĐC2 (01/4/2026)" in text
    assert "[Phê duyệt E-HSMT: QĐ-GỐC ngày 05/02/2026]" in text
    assert "[Điều chỉnh E-HSMT lần 1: QĐ-ĐC1 ngày 01/3/2026]" in text
    assert "[Điều chỉnh E-HSMT lần 2: QĐ-ĐC2 ngày 01/4/2026]" in text
