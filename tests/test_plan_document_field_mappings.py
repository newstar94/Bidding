import json
import re
from pathlib import Path

from backend.documents.docx_context_policy import validate_mapping_definition
from backend.documents.word_defaults import (
    WORD_DEFAULT_MAPPINGS_VERSION,
    WORD_SINGLE_NAME_OVERRIDES,
    WORD_SINGLE_SOURCES,
    build_default_word_mappings,
    ensure_default_word_mappings,
)
from backend.documents.word_defaults import WORD_LIST_MAPPINGS


PLAN_SUBMISSION_WORD_FIELDS = {
    "so_to_trinh_du_toan": "so_ttr_du_toan",
    "so_to_trinh_ke_hoach": "so_ttr_ke_hoach",
    "so_to_trinh_du_toan_ke_hoach": "so_ttr_du_toan_ke_hoach",
}

PLAN_TOTAL_INVESTMENT_WORD_FIELD = {
    "tong_muc_dau_tu": "tong_muc_dau_tu_du_toan",
}


def test_plan_submission_numbers_have_default_word_mappings():
    assert WORD_DEFAULT_MAPPINGS_VERSION >= 8

    plan_sources = set(WORD_SINGLE_SOURCES["ke_hoach_lcnt"])
    generated = {
        mapping["source_column"]: mapping
        for mapping in build_default_word_mappings()
        if mapping["source_table"] == "ke_hoach_lcnt"
    }

    for source_column, variable_name in PLAN_SUBMISSION_WORD_FIELDS.items():
        assert source_column in plan_sources
        assert WORD_SINGLE_NAME_OVERRIDES[("ke_hoach_lcnt", source_column)] == variable_name
        assert generated[source_column]["ten_bien"] == variable_name
        assert generated[source_column]["format"] == "text"


def test_plan_total_investment_has_default_word_mapping():
    generated = {
        mapping["source_column"]: mapping
        for mapping in build_default_word_mappings()
        if mapping["source_table"] == "ke_hoach_lcnt"
    }

    mapping = generated["tong_muc_dau_tu"]
    assert mapping["ten_bien"] == "tong_muc_dau_tu_du_toan"
    assert mapping["format"] == "currency"


def test_plan_kind_and_package_domain_fields_are_not_confused():
    generated = {
        (mapping["source_table"], mapping["source_column"]): mapping["ten_bien"]
        for mapping in build_default_word_mappings()
        if mapping["source_column"]
    }

    assert generated[("ke_hoach_lcnt", "loai_hinh_mua_sam")] == "loai_ke_hoach"
    assert generated[("goi_thau", "linh_vuc")] == "gt_linh_vuc"
    assert "loai_mua_sam" not in generated.values()


def test_derived_document_fields_receive_default_mappings():
    generated = {
        (mapping["source_table"], mapping["source_column"]): mapping["ten_bien"]
        for mapping in build_default_word_mappings()
        if mapping["source_column"]
    }

    expected = {
        ("goi_thau", "ngay_moi_doi_chieu"): "ngay_moi_doi_chieu",
        ("goi_thau", "ngay_doi_chieu"): "ngay_doi_chieu",
        ("chuyen_gia", "chuc_vu"): "chuc_vu_cg",
        ("chuyen_gia", "cong_viec"): "cong_viec_cg",
        ("thong_tin_mo_thau", "danh_gia_ket_luan"): "mt_dg_ket_luan",
    }
    for source, variable_name in expected.items():
        assert generated[source] == variable_name


def test_dead_account_subscription_fields_are_not_word_sources():
    assert not {
        "goi_dich_vu_id",
        "ngay_bat_dau_goi",
        "ngay_het_han_goi",
    } & set(WORD_SINGLE_SOURCES["tai_khoan"])


def test_every_default_mapping_passes_the_document_context_policy():
    for mapping in build_default_word_mappings():
        validate_mapping_definition(
            mapping["ten_bien"],
            mapping["source_table"],
            mapping["source_column"],
        )


def test_frontend_default_manifest_matches_backend_defaults():
    manifest_path = (
        Path(__file__).resolve().parents[1]
        / "frontend"
        / "documents"
        / "wordVariableManifest.js"
    )
    source = manifest_path.read_text(encoding="utf-8")
    match = re.search(
        r"export const DEFAULT_WORD_VARIABLES = (\[.*?\]);\s*$",
        source,
        re.DOTALL,
    )
    assert match
    frontend = json.loads(match.group(1))

    frontend_keys = {
        (item["name"], item["sourceTable"], item["sourceColumn"])
        for item in frontend
    }
    backend_keys = {
        (
            item["ten_bien"],
            item["source_table"],
            item["source_column"],
        )
        for item in build_default_word_mappings()
    }
    assert frontend_keys == backend_keys


def test_list_source_picker_only_contains_real_collections():
    source = (
        Path(__file__).resolve().parents[1]
        / "views"
        / "tabs"
        / "tab_bieumau.html"
    ).read_text(encoding="utf-8")
    list_picker = source.split('id="wml-source-table"', 1)[1].split("</select>", 1)[0]

    for scalar_source in (
        "ke_hoach_lcnt",
        "hop_dong",
        "chu_dau_tu",
        "tai_khoan",
        "to_chuc",
        "goi_dich_vu",
        "chuyen_gia",
    ):
        assert f'value="{scalar_source}"' not in list_picker
    for collection_source in (
        "goi_thau_trong_ke_hoach",
        "goi_thau_versions",
        "ke_hoach_versions",
        "to_chuyen_gia",
        "to_tham_dinh",
        "thong_tin_mo_thau",
        "detailed_evaluation_reports",
        "detailed_evaluation_rows",
        "detailed_evaluation_validity_rows",
        "detailed_evaluation_capacity_rows",
        "detailed_evaluation_technical_rows",
        "detailed_evaluation_financial_rows",
    ):
        assert f'value="{collection_source}"' in list_picker


def test_default_mapping_cleanup_parameterizes_like_patterns():
    class PsycopgStrictCursor:
        rowcount = 0

        def __init__(self):
            self.last_sql = ""

        def execute(self, sql, params=()):
            self.last_sql = sql
            assert "LIKE '" not in sql
            if "LIKE ?" in sql:
                assert params[-1].endswith("%")
            return self

        def fetchone(self):
            if "SELECT 1 FROM to_chuc" in self.last_sql:
                return (1,)
            if "SELECT mappings_version" in self.last_sql:
                return (0,)
            if "SELECT id, ten_bien, mo_ta" in self.last_sql:
                return ("existing", "custom_name", "custom mapping")
            return None

    cursor = PsycopgStrictCursor()
    ensure_default_word_mappings(cursor, "org-1")


def test_plan_and_package_list_sources_are_explicit_and_seeded():
    generated = {
        mapping["ten_bien"]: mapping
        for mapping in build_default_word_mappings()
        if not mapping["source_column"]
    }

    assert generated["ds_gt"]["source_table"] == "goi_thau_trong_ke_hoach"
    assert generated["ds_phien_ban_gt"]["source_table"] == "goi_thau_versions"
    assert "ds_kh" not in generated
    assert generated["ds_phien_ban_kh"]["source_table"] == "ke_hoach_versions"
    assert generated["ds_tat_ca_phan_lo"]["source_table"] == "ds_phan_lo"
    assert generated["ds_bao_cao_dgct"]["source_table"] == "detailed_evaluation_reports"
    assert generated["ds_dgct"]["source_table"] == "detailed_evaluation_rows"
    assert generated["ds_dgct_hop_le"]["source_table"] == "detailed_evaluation_validity_rows"
    assert generated["ds_dgct_nang_luc"]["source_table"] == "detailed_evaluation_capacity_rows"
    assert generated["ds_dgct_ky_thuat"]["source_table"] == "detailed_evaluation_technical_rows"
    assert generated["ds_dgct_tai_chinh"]["source_table"] == "detailed_evaluation_financial_rows"
    assert "ds_phan_lo" not in generated
    assert len({name for name, _source, _description in WORD_LIST_MAPPINGS}) == len(
        WORD_LIST_MAPPINGS
    )


def test_business_version_fields_have_default_word_mappings():
    generated_sources = {
        (mapping["source_table"], mapping["source_column"])
        for mapping in build_default_word_mappings()
        if mapping["source_column"]
    }
    for table in (
        "chu_dau_tu",
        "ke_hoach_lcnt",
        "goi_thau",
        "nha_thau",
        "chuyen_gia",
        "hop_dong",
    ):
        assert (table, "phien_ban") in generated_sources

    for column in ("qua_mang", "trong_nuoc_quoc_te", "is_rebid"):
        assert ("goi_thau", column) in generated_sources

    assert ("ke_hoach_lcnt", "is_tong_muc_tu_dong") not in generated_sources
