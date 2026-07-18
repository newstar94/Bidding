from backend.app import app  # noqa: F401 - initializes backend import paths
from backend.documents.docx_bid_context_service import enrich_context_with_filtered_bidders


def test_bid_context_service_builds_winner_and_rejection_lists():
    context = {
        "goi_thau": {"nha_thau_trung_thau_id": "nt-1"},
        "nha_thau": [
            {
                "nha_thau_id": "nt-1", "ma_nha_thau": "VN01",
                "ten_nha_thau": "Nhà thầu A", "gia_du_thau": 1250000,
                "danh_gia_ket_luan": "Trúng thầu",
            },
            {
                "nha_thau_id": "nt-2", "ma_nha_thau": "VN02",
                "ten_nha_thau": "Nhà thầu B", "gia_du_thau": 1500000,
                "danh_gia_ky_thuat": "Không đạt",
            },
            {
                "nha_thau_id": "ld-1", "ma_nha_thau": "VN03",
                "ten_nha_thau": "Liên danh QL8A", "loai_nha_thau": "Liên danh",
                "gia_du_thau": 1600000, "danh_gia_ket_luan": "Không đạt",
            },
        ],
    }

    enrich_context_with_filtered_bidders(context)

    assert context["tong_so_nha_thau_tham_du"] == 3
    assert context["so_nha_thau_trung_thau"] == 1
    assert context["so_nha_thau_khong_dat"] == 2
    assert context["ds_nha_thau_trung_thau"][0]["ten_nha_thau"] == "Nhà thầu A"
    assert "1.250.000" in str(context["ds_nha_thau_trung_thau"][0]["gia_du_thau"])
    assert any(
        bid["ten_nha_thau"] == "Liên danh QL8A"
        for bid in context["ds_nha_thau_tham_du"]
    )
