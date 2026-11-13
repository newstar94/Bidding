"""ADR 0105: precomputed plan totals and performance-security amount for Word."""

import pytest

from backend.documents import docx_context_policy as policy
from backend.documents.computed_word_values import (
    PERFORMANCE_SECURITY_FIELD,
    PLAN_TOTAL_CONTEXT_KEYS,
    PLAN_TOTAL_WORD_MAPPINGS,
    performance_security_amount,
    plan_total_context,
)
from backend.documents.docx_bid_context_service import enrich_context_with_filtered_bidders
from backend.documents.field_manifest import field_format
from backend.documents.word_defaults import (
    WORD_DEFAULT_MAPPINGS_VERSION,
    build_default_word_mappings,
)


def test_plan_totals_add_every_row_and_subtract_done_work():
    plan = {
        "tong_muc_dau_tu": 1_000_000_000,
        "cv_da_thuc_hien": [{"gia_tri": 120_000_000}, {"gia_tri": "30000000"}, {"gia_tri": None}],
        "cv_khong_ap_dung": [{"gia_tri": 5_000_000}, {"gia_tri": 7_500_000}],
    }
    packages = [{"gia_goi_thau": 400_000_000}, {"gia_goi_thau": 445_000_000}]
    assert plan_total_context(plan, packages) == {
        "tong_gia_goi_thau_ke_hoach": 845_000_000,
        "tong_gia_tri_cv_da_thuc_hien": 150_000_000,
        "tong_gia_tri_cv_khong_ap_dung": 12_500_000,
        "tong_muc_dau_tu_tru_da_thuc_hien": 850_000_000,
    }


def test_empty_lists_total_zero_and_missing_investment_stays_empty():
    totals = plan_total_context({}, [])
    assert totals["tong_gia_goi_thau_ke_hoach"] == 0
    assert totals["tong_gia_tri_cv_da_thuc_hien"] == 0
    assert totals["tong_gia_tri_cv_khong_ap_dung"] == 0
    assert totals["tong_muc_dau_tu_tru_da_thuc_hien"] == ""
    assert set(totals) == PLAN_TOTAL_CONTEXT_KEYS


@pytest.mark.parametrize(
    ("rate", "price", "expected"),
    [
        (10, 288_000_000, 28_800_000),
        (2.5, 123_456_789, 3_086_420),  # 3,086,419.725 rounds half up
        ("3", "1.000.000", 30_000),
        (0, 288_000_000, None),
        (None, 288_000_000, None),
        (10, None, None),
        (10, "", None),
    ],
)
def test_performance_security_amount(rate, price, expected):
    assert performance_security_amount(rate, price) == expected


def test_every_bid_row_carries_the_security_of_its_letter_price():
    context = {
        "goi_thau": {"ty_le_bao_dam_hop_dong": 10},
        "nha_thau": [
            {"nha_thau_id": "a", "ten_nha_thau": "A", "gia_du_thau": 300_000_000, "gia_sau_giam_gia": 288_000_000,
             "danh_gia_ket_luan": "Trúng thầu"},
            {"nha_thau_id": "b", "ten_nha_thau": "B", "gia_du_thau": 500_000_000},
        ],
    }
    enrich_context_with_filtered_bidders(context)
    winners = context["ds_nha_thau_trung_thau"]
    assert [bid["ten_nha_thau"] for bid in winners] == ["A"]
    assert winners[0][PERFORMANCE_SECURITY_FIELD] == "28.800.000"
    by_name = {bid["ten_nha_thau"]: bid for bid in context["ds_nha_thau_tham_du"]}
    # Without a discounted price the bid price is the contract price.
    assert by_name["B"][PERFORMANCE_SECURITY_FIELD] == "50.000.000"


def test_security_is_empty_without_a_rate():
    context = {"goi_thau": {}, "nha_thau": [{"nha_thau_id": "a", "gia_du_thau": 1_000_000}]}
    enrich_context_with_filtered_bidders(context)
    assert context["ds_nha_thau_tham_du"][0][PERFORMANCE_SECURITY_FIELD] == ""


def test_policy_admits_the_new_values_only_where_they_belong():
    for key in PLAN_TOTAL_CONTEXT_KEYS:
        assert policy.PLAN_ROOT_SPECS[key] == "scalar"
        assert key not in policy.REPORT_ROOT_SPECS
        policy.validate_mapping_definition("bien_thu", "__context__", key, document_type="plan")
    assert PERFORMANCE_SECURITY_FIELD in policy._BID_FIELDS


def test_projected_plan_context_keeps_totals():
    context = {"ke_hoach": {"id": "kh-1"}, **plan_total_context({"tong_muc_dau_tu": 10}, [])}
    projected = policy.project_docx_context("plan", context, None, organization_id="org-1")
    assert projected["tong_muc_dau_tu_tru_da_thuc_hien"] == 10
    assert projected["tong_gia_goi_thau_ke_hoach"] == 0


def test_default_catalog_exposes_currency_variables():
    assert WORD_DEFAULT_MAPPINGS_VERSION >= 20
    defaults = {item["ten_bien"]: item for item in build_default_word_mappings()}
    for name, key, _label in PLAN_TOTAL_WORD_MAPPINGS:
        assert defaults[name]["source_table"] == "__context__"
        assert defaults[name]["source_column"] == key
        assert field_format(key) == "currency"
