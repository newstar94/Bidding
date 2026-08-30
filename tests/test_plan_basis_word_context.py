import sqlite3

import pytest

from backend.documents.docx_context_policy import (
    filter_mapping_rows,
    seal_docx_context,
    validate_mapping_definition,
)
from backend.documents.docx_mapping_service import apply_custom_mappings
from backend.documents.plan_basis_context import (
    PlanBasisSelectionError,
    materialize_plan_basis_items,
    parse_selection_payload,
    resolve_plan_basis_rows,
)
from backend.documents.word_defaults import (
    WORD_DEFAULT_MAPPINGS_VERSION,
    build_default_word_mappings,
)
from backend.documents.template_catalog.routes import _sample_preview_context


def _cursor():
    connection = sqlite3.connect(":memory:")
    connection.row_factory = sqlite3.Row
    connection.execute(
        """CREATE TABLE ke_hoach_can_cu (
            id TEXT, organization_id TEXT, ke_hoach_id TEXT, noi_dung_goc TEXT,
            ten_van_ban TEXT, so_van_ban TEXT, ngay_ban_hanh TEXT,
            don_vi_ban_hanh TEXT, trich_yeu TEXT, parse_status TEXT,
            parse_version TEXT, parse_reasons TEXT, sort_order INTEGER, id_goc TEXT
        )"""
    )
    connection.executemany(
        """INSERT INTO ke_hoach_can_cu VALUES (?, 'org', 'plan', ?, ?, ?, ?, ?, ?, ?, 'v1', '[]', ?, ?)""",
        [
            ("b-2", "raw second", None, None, None, None, None, "UNPARSED", 2, "r-2"),
            ("b-1", "raw first", "Quyết định", "123/QĐ", "2025-11-11", "UBND xã ABC", "phê duyệt dự toán", "PARSED", 1, "r-1"),
        ],
    )
    return connection, connection.cursor()


def test_selection_missing_all_explicit_zero_subset_and_server_order():
    connection, cursor = _cursor()
    try:
        rows, mode = resolve_plan_basis_rows(cursor, "org", "plan", None)
        assert mode == "all"
        assert [row["id"] for row in rows] == ["b-1", "b-2"]
        rows, mode = resolve_plan_basis_rows(cursor, "org", "plan", [])
        assert mode == "explicit" and rows == []
        rows, _mode = resolve_plan_basis_rows(cursor, "org", "plan", ["b-2", "b-1"])
        assert [row["id"] for row in rows] == ["b-1", "b-2"]
    finally:
        connection.close()


@pytest.mark.parametrize("payload", [
    {"selectedCanCuLapKeHoachIds": "b-1"},
    {"selectedCanCuLapKeHoachIds": ["b-1", "b-1"]},
    {"selectedCanCuLapKeHoachIds": [""]},
])
def test_selection_rejects_invalid_transport(payload):
    with pytest.raises(PlanBasisSelectionError):
        parse_selection_payload(payload)


def test_selection_rejects_unknown_or_foreign_ids():
    connection, cursor = _cursor()
    try:
        with pytest.raises(PlanBasisSelectionError):
            resolve_plan_basis_rows(cursor, "org", "plan", ["other-plan-row"])
    finally:
        connection.close()


def test_word_items_materialize_raw_structured_and_connector_helpers():
    connection, cursor = _cursor()
    try:
        rows, _mode = resolve_plan_basis_rows(cursor, "org", "plan", None)
        items = materialize_plan_basis_items(rows)
    finally:
        connection.close()
    first, second = items
    assert first == {
        "stt": 1,
        "noi_dung_goc": "raw first",
        "ten_can_cu": "Quyết định về việc phê duyệt dự toán",
        "ten_van_ban": "Quyết định",
        "so_van_ban": "123/QĐ",
        "ngay_ban_hanh": "2025-11-11",
        "S_ngay_ban_hanh": "11/11/2025",
        "don_vi_ban_hanh": "UBND xã ABC",
        "trich_yeu": "phê duyệt dự toán",
        "parse_status": "PARSED",
        "cum_so_van_ban": " số 123/QĐ",
        "cum_ngay_ban_hanh": " ngày 11/11/2025",
        "cum_don_vi_ban_hanh": " của UBND xã ABC",
        "cum_trich_yeu": " về việc phê duyệt dự toán",
    }
    assert all(value is not None for value in second.values())
    assert second["cum_so_van_ban"] == ""
    assert second["cum_ngay_ban_hanh"] == ""
    assert second["cum_don_vi_ban_hanh"] == ""
    assert second["cum_trich_yeu"] == ""


def test_selected_source_creates_only_custom_visible_alias():
    mapping = ("ds_can_cu_lap_ke_hoach", "ke_hoach_can_cu", "")
    assert filter_mapping_rows([mapping], "plan") == [mapping]
    validate_mapping_definition(*mapping, document_type="plan")
    context = {
        "ke_hoach": {"id": "plan"},
        "ke_hoach_can_cu": materialize_plan_basis_items([]),
    }
    apply_custom_mappings(context, [mapping])
    sealed, manifest = seal_docx_context("plan", context, [mapping])
    assert "ke_hoach_can_cu" not in sealed
    assert sealed["ds_can_cu_lap_ke_hoach"] == []
    assert "ds_can_cu_lap_ke_hoach" in manifest["custom_root_keys"]


def test_default_mapping_catalog_exposes_one_selected_basis_loop_at_v16():
    defaults = build_default_word_mappings()
    matches = [row for row in defaults if row["source_table"] == "ke_hoach_can_cu"]
    assert WORD_DEFAULT_MAPPINGS_VERSION == 16
    assert [(row["ten_bien"], row["mapping_key"]) for row in matches] == [
        ("ds_can_cu_lap_ke_hoach", "list:ke_hoach_can_cu")
    ]


def test_sample_preview_materializes_the_visible_plan_basis_alias():
    mappings = [
        ("ds_can_cu_lap_ke_hoach", "ke_hoach_can_cu", ""),
    ]
    context = _sample_preview_context("plan")

    apply_custom_mappings(context, mappings)
    sealed, _manifest = seal_docx_context("plan", context, mappings)

    assert sealed["ds_can_cu_lap_ke_hoach"] == [{
        "stt": 1,
        "noi_dung_goc": (
            "Căn cứ Quyết định số 123/QĐ ngày 11/11/2025 của UBND xã ABC "
            "về việc phê duyệt dự toán"
        ),
        "ten_can_cu": "Quyết định về việc phê duyệt dự toán",
        "ten_van_ban": "Quyết định",
        "so_van_ban": "123/QĐ",
        "ngay_ban_hanh": "2025-11-11",
        "S_ngay_ban_hanh": "11/11/2025",
        "don_vi_ban_hanh": "UBND xã ABC",
        "trich_yeu": "phê duyệt dự toán",
        "cum_so_van_ban": " số 123/QĐ",
        "cum_ngay_ban_hanh": " ngày 11/11/2025",
        "cum_don_vi_ban_hanh": " của UBND xã ABC",
        "cum_trich_yeu": " về việc phê duyệt dự toán",
        "parse_status": "PARSED",
    }]
