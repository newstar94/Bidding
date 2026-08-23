from backend.db.db_helper import CompatRow
from backend.documents.docx_context_policy import (
    filter_mapping_rows,
    project_docx_context,
)
from backend.documents.docx_mapping_service import apply_custom_mappings


def test_filter_mapping_rows_accepts_postgres_compat_rows():
    row = CompatRow(
        ("ten_bien", "source_table", "source_column"),
        ("ma_gt", "goi_thau", "ma_goi_thau"),
    )

    assert filter_mapping_rows([row], "result") == [
        ("ma_gt", "goi_thau", "ma_goi_thau")
    ]


def test_opening_bid_list_mapping_does_not_use_contract_contractor_rows():
    context = {
        "nha_thau": [{"ten_nha_thau": "Nhà thầu của hợp đồng"}],
        "thong_tin_mo_thau": [{
            "ten_nha_thau": "Nhà thầu tham dự mở thầu",
            "hieu_luc_hsdt": "90 ngày",
        }],
    }

    apply_custom_mappings(
        context,
        [("ds_mo_thau", "thong_tin_mo_thau", "")],
    )

    assert context["ds_mo_thau"] == [{
        "ten_nha_thau": "Nhà thầu tham dự mở thầu",
        "hieu_luc_hsdt": "90 ngày",
    }]


def test_contract_context_preserves_opening_rows_separately_from_contractor():
    projected = project_docx_context(
        "contract",
        {
            "nha_thau": [{"ten_nha_thau": "Nhà thầu của hợp đồng"}],
            "thong_tin_mo_thau": [{
                "ten_nha_thau": "Nhà thầu tham dự mở thầu",
                "hieu_luc_hsdt": "90 ngày",
            }],
        },
    )

    assert projected["nha_thau"][0]["ten_nha_thau"] == "Nhà thầu của hợp đồng"
    assert projected["thong_tin_mo_thau"] == [{
        "ten_nha_thau": "Nhà thầu tham dự mở thầu",
        "hieu_luc_hsdt": "90 ngày",
    }]
