"""ADR 0042: timeline milestone numbers/dates as Word variables."""

import sqlite3

import pytest
from docx import Document

from backend.documents import timeline_context_service
from backend.documents.custom_exporter import generate_report_from_custom_template
from backend.documents.docx_context_policy import (
    PLAN_ROOT_SPECS,
    REPORT_ROOT_SPECS,
    filter_mapping_rows,
    seal_docx_context,
    validate_docx_context_manifest,
    validate_mapping_definition,
)
from backend.documents.docx_mapping_service import apply_custom_mappings
from backend.documents.field_manifest import FIELD_LABELS_BY_TABLE, field_format
from backend.documents.word_defaults import (
    WORD_DEFAULT_MAPPINGS_VERSION,
    build_default_word_mappings,
)
from backend.documents.word_mapping_registry import (
    delete_word_mapping,
    reset_word_mapping,
    resolve_word_mappings,
    save_word_mapping,
)
from backend.timeline.effective_timeline import CATALOG
from backend.timeline.word_fields import (
    MILESTONE_WORD_SLUGS,
    PLAN_SECTION_MILESTONE_KEYS,
    TIMELINE_CONTEXT_KEYS,
    TIMELINE_DATE_CONTEXT_KEYS,
    date_context_key,
    milestone_values_from_rows,
    number_context_key,
    timeline_word_context,
)


def _timeline_defaults():
    return [
        row for row in build_default_word_mappings()
        if row["source_table"] == "__context__"
        and row["source_column"] in TIMELINE_CONTEXT_KEYS
    ]


def _mapping_rows():
    return [
        (row["ten_bien"], row["source_table"], row["source_column"])
        for row in _timeline_defaults()
    ]


def _cursor():
    connection = sqlite3.connect(":memory:")
    connection.row_factory = sqlite3.Row
    connection.executescript(
        """
        CREATE TABLE goi_thau (
            id TEXT, organization_id TEXT, ke_hoach_id TEXT,
            hinh_thuc_lua_chon TEXT, phuong_thuc_lua_chon TEXT,
            linh_vuc TEXT, created_at TEXT
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
        "INSERT INTO ke_hoach_lcnt VALUES ('plan-1', 'org', 'Kế hoạch', '12/QĐ-UBND', '2026-03-05')"
    )
    connection.executemany(
        "INSERT INTO goi_thau VALUES (?, 'org', 'plan-1', 'Đấu thầu rộng rãi', 'Một giai đoạn một túi hồ sơ', 'Hàng hóa', ?)",
        [("pkg-1", "2026-01-02"), ("pkg-2", "2025-12-01")],
    )
    rows = [
        ("pkg-1", "EXPERT_TEAM_ESTABLISHMENT", "05/QĐ-TCG", "2026-03-10", "2026-03-11", None),
        ("pkg-1", "BID_EVALUATION_REPORT", "BC-01", "2026-04-02", None, "MANUAL"),
        ("pkg-1", "TECHNICAL_RESULT_APPRAISAL", "KT-99", None, "2026-04-03", "MANUAL"),
        ("pkg-1", "PLAN_TEAM_ESTABLISHMENT", "TL-01", None, "2026-02-01", None),
        ("pkg-1", "VALUATION_EVIDENCE", "CT-01", None, "2026-01-20", None),
        ("pkg-2", "VALUATION_EVIDENCE", "CT-02", None, "2026-01-10", None),
        ("pkg-2", "EXPERT_TEAM_ESTABLISHMENT", "", None, None, None),
    ]
    connection.executemany(
        """INSERT INTO goi_thau_moc_tien_do
           VALUES (?, 'org', ?, ?, '', '', ?, ?, ?, NULL, ?, 1)""",
        [
            (f"row-{index}", package, key, number, planned, actual, mode)
            for index, (package, key, number, planned, actual, mode) in enumerate(rows)
        ],
    )
    return connection, connection.cursor()


@pytest.fixture
def cursor(monkeypatch):
    monkeypatch.setattr(
        timeline_context_service,
        "_load_related",
        lambda _cursor, _organization_id, _package_id: {},
    )
    connection, cursor = _cursor()
    yield cursor
    connection.close()


def test_every_single_milestone_has_one_number_and_one_date_default_variable():
    singles = [
        item["milestoneKey"] for item in CATALOG["milestones"]
        if not item["repeatable"]
    ]
    defaults = _timeline_defaults()
    names = [row["ten_bien"] for row in defaults]

    # v17 introduced the milestone variables; later catalogs (ADR 0043) add more.
    assert WORD_DEFAULT_MAPPINGS_VERSION >= 17
    assert set(MILESTONE_WORD_SLUGS) == set(singles)
    assert len(defaults) == 2 * len(singles)
    assert len(set(names)) == len(names)
    assert {row["source_column"] for row in defaults} == TIMELINE_CONTEXT_KEYS
    for row in defaults:
        expected = "date" if row["source_column"] in TIMELINE_DATE_CONTEXT_KEYS else "text"
        assert row["format"] == expected == field_format(row["source_column"])
        assert row["source_column"] in FIELD_LABELS_BY_TABLE["__context__"]
        assert row["ten_bien"].startswith(("so_", "ngay_"))
        assert not row["ten_bien"].startswith("td_")
    other_names = {
        row["ten_bien"] for row in build_default_word_mappings()
        if row not in defaults
    }
    assert not other_names & set(names)


@pytest.mark.parametrize("document_type", ["plan", "evaluation", "hsmt", "result", "contract"])
def test_timeline_mappings_pass_the_export_contract(document_type):
    rows = _mapping_rows()
    for row in rows:
        validate_mapping_definition(*row, document_type=document_type)
    assert filter_mapping_rows(rows, document_type) == rows
    assert TIMELINE_CONTEXT_KEYS <= set(REPORT_ROOT_SPECS)
    assert TIMELINE_CONTEXT_KEYS <= set(PLAN_ROOT_SPECS)


def test_only_applicable_single_rows_project_and_actual_date_wins():
    rows = [
        {"milestone_key": "BID_EVALUATION_REPORT", "applicability": "APPLICABLE",
         "so_van_ban": "BC-01", "ngay_du_kien": "2026-04-02", "ngay_thuc_te": "2026-04-05"},
        {"milestone_key": "E_HSMT_APPROVAL", "applicability": "APPLICABLE",
         "so_van_ban": "", "ngay_du_kien": "2026-02-02", "ngay_thuc_te": ""},
        {"milestone_key": "TECHNICAL_RESULT_APPRAISAL", "applicability": "CONDITIONAL",
         "so_van_ban": "KT", "ngay_thuc_te": "2026-04-03"},
        {"milestone_key": "BID_DEADLINE_EXTENSION", "applicability": "APPLICABLE",
         "is_repeatable": True, "so_van_ban": "x", "ngay_thuc_te": "2026-01-01"},
    ]

    context = timeline_word_context(milestone_values_from_rows(rows))

    assert set(context) == TIMELINE_CONTEXT_KEYS
    assert context[number_context_key("BID_EVALUATION_REPORT")] == "BC-01"
    assert context[date_context_key("BID_EVALUATION_REPORT")] == "2026-04-05"
    assert context[date_context_key("E_HSMT_APPROVAL")] == "2026-02-02"
    assert context[number_context_key("TECHNICAL_RESULT_APPRAISAL")] == ""
    assert all(isinstance(value, str) for value in context.values())


def test_package_context_uses_the_effective_timeline(cursor):
    context = timeline_context_service.load_timeline_word_context(cursor, "org", "pkg-1")

    assert set(context) == TIMELINE_CONTEXT_KEYS
    assert context["moc_so_qd_tl_tcg"] == "05/QĐ-TCG"
    assert context["moc_ngay_qd_tl_tcg"] == "2026-03-11"
    assert context["moc_so_bcdg"] == "BC-01"
    assert context["moc_ngay_bcdg"] == "2026-04-02"
    # Automatically sourced from the plan, exactly like the Tiến độ tab.
    assert context["moc_so_qd_kh"] == "12/QĐ-UBND"
    assert context["moc_ngay_qd_kh"] == "2026-03-05"
    # One-envelope packages exclude the technical appraisal milestone.
    assert context["moc_so_bctd_kt"] == ""
    assert context["moc_ngay_bctd_kt"] == ""


def test_unknown_package_yields_empty_values_not_errors(cursor):
    context = timeline_context_service.load_timeline_word_context(cursor, "org", "missing")
    assert set(context) == TIMELINE_CONTEXT_KEYS
    assert set(context.values()) == {""}


def test_plan_context_only_takes_plan_section_from_the_first_filled_package(cursor):
    packages = [{"id": "pkg-1", "created_at": "2026-01-02"}, {"id": "pkg-2", "created_at": "2025-12-01"}]

    context = timeline_context_service.load_plan_timeline_word_context(cursor, "org", packages)

    assert set(context) == TIMELINE_CONTEXT_KEYS
    assert context["moc_so_chung_thu_tdg"] == "CT-02"
    assert context["moc_ngay_chung_thu_tdg"] == "2026-01-10"
    assert context["moc_so_qd_tl_to"] == "TL-01"
    assert context["moc_ngay_qd_tl_to"] == "2026-02-01"
    assert context["moc_so_qd_tl_tcg"] == ""
    assert context["moc_so_bcdg"] == ""
    filled = {key for key, value in context.items() if value}
    allowed = {
        key for milestone in PLAN_SECTION_MILESTONE_KEYS
        for key in (number_context_key(milestone), date_context_key(milestone))
    }
    assert filled <= allowed


def test_sealed_variables_render_number_long_date_and_short_date(cursor, tmp_path):
    rows = _mapping_rows()
    context = {
        "goi_thau": {"id": "pkg-1", "ten_goi_thau": "Gói thầu A"},
        **timeline_context_service.load_timeline_word_context(cursor, "org", "pkg-1"),
    }
    apply_custom_mappings(context, rows)
    sealed, manifest = seal_docx_context("evaluation", context, rows)

    assert "ngay_qd_tl_tcg" in manifest["date_root_keys"]
    assert "so_qd_tl_tcg" not in manifest["date_root_keys"]
    policy = validate_docx_context_manifest(sealed, manifest)
    assert "S_ngay_qd_tl_tcg" in policy["allowed_root_keys"]

    template = Document()
    template.add_paragraph(
        "Số {so_qd_tl_tcg} {ngay_qd_tl_tcg} | {S_ngay_qd_tl_tcg} | [{so_bctd_kt}]"
    )
    template_path = tmp_path / "timeline.docx"
    template.save(template_path)

    output = generate_report_from_custom_template(str(template_path), sealed, manifest)
    text = "\n".join(paragraph.text for paragraph in Document(output).paragraphs)

    assert "Số 05/QĐ-TCG" in text
    assert "11 tháng 3 năm 2026" in text
    assert "| 11/3/2026 |" in text
    assert "[]" in text


def _registry_database():
    connection = sqlite3.connect(":memory:")
    connection.row_factory = sqlite3.Row
    connection.executescript(
        """
        CREATE TABLE cau_hinh_bien_word (
            id TEXT PRIMARY KEY, organization_id TEXT NOT NULL,
            owner_type TEXT NOT NULL, ten_bien TEXT NOT NULL,
            source_table TEXT NOT NULL, source_column TEXT NOT NULL, mo_ta TEXT,
            UNIQUE(organization_id, ten_bien),
            UNIQUE(organization_id, source_table, source_column)
        );
        CREATE TABLE word_mapping_overrides (
            organization_id TEXT NOT NULL, owner_type TEXT NOT NULL,
            mapping_key TEXT NOT NULL, ten_bien_override TEXT,
            source_table_override TEXT, source_column_override TEXT,
            mo_ta_override TEXT, disabled INTEGER NOT NULL DEFAULT 0,
            base_version INTEGER NOT NULL, created_at TEXT, updated_at TEXT,
            PRIMARY KEY (organization_id, mapping_key)
        );
        """
    )
    return connection


def test_every_scope_starts_with_the_timeline_variables_and_can_customize_them():
    connection = _registry_database()
    cursor = connection.cursor()

    fresh = resolve_word_mappings(cursor, "org-new")
    by_name = {row["ten_bien"]: row for row in fresh}
    timeline_names = {row["ten_bien"] for row in _timeline_defaults()}
    assert timeline_names <= set(by_name)
    assert {by_name[name]["origin"] for name in timeline_names} == {"system"}
    assert cursor.execute("SELECT COUNT(*) FROM cau_hinh_bien_word").fetchone()[0] == 0

    renamed = save_word_mapping(
        cursor, "org-new", "organization",
        mapping_id=by_name["so_bcdg"]["id"], ten_bien="so_bao_cao_danh_gia",
        source_table="__context__", source_column="moc_so_bcdg", mo_ta=None,
    )
    assert renamed["origin"] == "override"
    hidden = delete_word_mapping(cursor, "org-new", "organization", by_name["ngay_bbdc"]["id"])
    assert hidden["action"] == "disabled"

    names = {row["ten_bien"] for row in resolve_word_mappings(cursor, "org-new")}
    assert "so_bao_cao_danh_gia" in names and "so_bcdg" not in names
    assert "ngay_bbdc" not in names
    assert "so_bcdg" in {row["ten_bien"] for row in resolve_word_mappings(cursor, "org-other")}

    reset_word_mapping(cursor, "org-new", renamed["id"])
    reset_word_mapping(cursor, "org-new", by_name["ngay_bbdc"]["id"])
    names = {row["ten_bien"] for row in resolve_word_mappings(cursor, "org-new")}
    assert {"so_bcdg", "ngay_bbdc"} <= names
    connection.close()


def test_an_existing_scope_variable_with_the_same_name_keeps_winning():
    connection = _registry_database()
    cursor = connection.cursor()
    cursor.execute(
        """INSERT INTO cau_hinh_bien_word VALUES
           ('custom-1', 'org-a', 'organization', 'so_bcdg', '__computed__', '"BC-TỰ-ĐẶT"', 'Biến riêng')"""
    )

    rows = [row for row in resolve_word_mappings(cursor, "org-a") if row["ten_bien"] == "so_bcdg"]

    assert [(row["origin"], row["id"]) for row in rows] == [("custom", "custom-1")]
    assert any(
        row["ten_bien"] == "so_bcdg" and row["origin"] == "system"
        for row in resolve_word_mappings(cursor, "org-b")
    )
    connection.close()
