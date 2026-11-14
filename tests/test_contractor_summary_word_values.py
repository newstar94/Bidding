"""ADR 0106: per-contractor lot summaries and the preference value."""

from backend.documents import docx_context_policy as policy
from backend.documents.computed_word_values import (
    CONTRACTOR_SUMMARY_LIST_MAPPINGS,
    CONTRACTOR_SUMMARY_RANK_1_ROOT,
    CONTRACTOR_SUMMARY_ROOT,
    CONTRACTOR_SUMMARY_TECHNICAL_ROOT,
)
from backend.documents.docx_bid_context_service import (
    build_contractor_summaries,
    enrich_context_with_filtered_bidders,
)
from backend.documents.word_defaults import (
    WORD_DEFAULT_MAPPINGS_VERSION,
    build_default_word_mappings,
)

PACKAGE = {
    "gia_goi_thau": 900,
    "phan_lo_list": [
        {"ma_phan_lo": "L1", "gia_tri_phan_lo": 150},
        {"ma_phan_lo": "L2", "gia_tri_phan_lo": 250},
        {"ma_phan_lo": "L3", "gia_tri_phan_lo": 500},
    ],
}


def bid(contractor, lot, price, *, after=None, capacity="Đạt", technical="Đạt", rank="--",
        preference=None, evaluated=None, conclusion=""):
    return {
        "nha_thau_id": contractor, "ten_nha_thau": contractor.upper(), "ma_so_thue": "01" + contractor,
        "ma_phan_lo": lot, "gia_du_thau": price, "gia_sau_giam_gia": after,
        "danh_gia_hop_le": "Đạt", "danh_gia_nang_luc": capacity, "danh_gia_ky_thuat": technical,
        "danh_gia_tai_chinh": rank, "tong_gia_tri_cong_uu_dai": preference,
        "gia_xep_hang": evaluated, "danh_gia_ket_luan": conclusion,
    }


BIDS = [
    bid("a", "L1", 140, after=130, rank="Xếp hạng 1", preference=6, evaluated=136),
    bid("a", "L2", 240, capacity="Không đạt", technical="", rank="Không xếp hạng"),
    bid("a", "L3", 480, after=470, rank="Xếp hạng 2", evaluated=470),
    bid("b", "L1", 145, rank="Xếp hạng 2", evaluated=145),
    bid("c", "L3", 460, technical="Không đạt", rank="Không xếp hạng"),
]


def _summary(root, contractor):
    lists = build_contractor_summaries(BIDS, PACKAGE)
    return next(row for row in lists[root] if row["nha_thau_id"] == contractor)


def test_one_row_per_contractor_with_lot_counts():
    lists = build_contractor_summaries(BIDS, PACKAGE)
    assert [row["nha_thau_id"] for row in lists[CONTRACTOR_SUMMARY_ROOT]] == ["a", "b", "c"]
    a = _summary(CONTRACTOR_SUMMARY_ROOT, "a")
    assert a["so_phan_tham_du"] == 3
    assert a["so_phan_dat_nang_luc"] == 2
    assert a["so_phan_khong_dat_nang_luc"] == 1
    assert a["so_phan_dat_ky_thuat"] == 2
    assert a["so_phan_xep_hang_1"] == 1
    assert a["danh_gia_hop_le"] == "Đạt"
    assert a["danh_gia_nang_luc"] == "Đạt 2/3 phần lô"


def test_totals_use_lot_values_prices_and_discount_amounts():
    a = _summary(CONTRACTOR_SUMMARY_ROOT, "a")
    assert a["tong_gia_phan_lo"] == "900"
    assert a["tong_gia_du_thau"] == "860"
    assert a["tong_gia_tri_giam_gia"] == "20"
    assert a["tong_gia_sau_giam_gia"] == "840"  # L2 without discount keeps its bid price
    assert a["tong_gia_tri_uu_dai"] == "6"
    assert a["tong_gia_du_thau_dat_ky_thuat"] == "620"
    assert a["tong_gia_sau_giam_gia_dat_ky_thuat"] == "600"
    assert a["tong_gia_danh_gia_dat_ky_thuat"] == "606"
    assert a["tong_gia_phan_lo_xep_hang_1"] == "150"
    assert a["tong_gia_sau_giam_gia_xep_hang_1"] == "130"


def test_filtered_lists_follow_technical_pass_and_rank_one():
    lists = build_contractor_summaries(BIDS, PACKAGE)
    assert [row["nha_thau_id"] for row in lists[CONTRACTOR_SUMMARY_TECHNICAL_ROOT]] == ["a", "b"]
    assert [row["nha_thau_id"] for row in lists[CONTRACTOR_SUMMARY_RANK_1_ROOT]] == ["a"]
    b = _summary(CONTRACTOR_SUMMARY_ROOT, "b")
    assert b["tong_gia_tri_uu_dai"] == "0"
    assert b["tong_gia_tri_giam_gia_xep_hang_1"] == "0"


def test_score_based_technical_result_uses_the_bid_conclusion():
    scored = [bid("s", "L1", 100, technical="85 điểm", conclusion="Đạt")]
    failed = [bid("f", "L1", 100, technical="40 điểm", conclusion="Không đạt")]
    assert build_contractor_summaries(scored, PACKAGE)[CONTRACTOR_SUMMARY_ROOT][0]["so_phan_dat_ky_thuat"] == 1
    assert build_contractor_summaries(failed, PACKAGE)[CONTRACTOR_SUMMARY_ROOT][0]["so_phan_dat_ky_thuat"] == 0


def test_package_without_lots_uses_the_package_price():
    row = build_contractor_summaries([bid("x", "", 800)], PACKAGE)[CONTRACTOR_SUMMARY_ROOT][0]
    assert row["so_phan_tham_du"] == 1
    assert row["tong_gia_phan_lo"] == "900"


def test_enrichment_adds_lists_and_preference_on_each_bid():
    context = {"goi_thau": dict(PACKAGE), "nha_thau": [dict(item) for item in BIDS]}
    enrich_context_with_filtered_bidders(context)
    assert len(context[CONTRACTOR_SUMMARY_ROOT]) == 3
    by_lot = {(row["nha_thau_id"], row["ma_phan_lo"]): row for row in context["ds_nha_thau_tham_du"]}
    assert by_lot[("a", "L1")]["tong_gia_tri_cong_uu_dai"] == "6"
    assert by_lot[("b", "L1")]["tong_gia_tri_cong_uu_dai"] == "0"


def test_policy_and_catalog_expose_the_new_values():
    for _alias, root, _label in CONTRACTOR_SUMMARY_LIST_MAPPINGS:
        assert policy.REPORT_ROOT_SPECS[root] == "contractor_summary_list"
        policy.validate_mapping_definition("ds_thu", root, "", document_type="result")
    assert "tong_gia_tri_cong_uu_dai" in policy._BID_FIELDS
    assert WORD_DEFAULT_MAPPINGS_VERSION >= 22
    defaults = {item["ten_bien"]: item for item in build_default_word_mappings()}
    for name, root, _label in CONTRACTOR_SUMMARY_LIST_MAPPINGS:
        assert defaults[name]["source_table"] == root


def test_projection_keeps_summary_rows_and_deadlines():
    context = {
        "goi_thau": {"id": "g", **PACKAGE},
        "nha_thau": [dict(item) for item in BIDS],
    }
    context = policy.project_docx_context("result", context, None, organization_id="org-1")
    enrich_context_with_filtered_bidders(context)
    projected = policy.project_docx_context("result", context, None, organization_id="org-1")
    assert projected[CONTRACTOR_SUMMARY_RANK_1_ROOT][0]["so_phan_xep_hang_1"] == 1
    assert projected["ds_nha_thau_tham_du"][0]["tong_gia_tri_cong_uu_dai"] == "6"
