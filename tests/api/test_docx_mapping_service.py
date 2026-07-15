from backend.app import app  # noqa: F401 - initializes backend import paths
from backend.documents.docx_mapping_service import apply_custom_mappings


def test_word_mapping_service_maps_scalar_context_and_list_fields():
    context = {
        "goi_thau": {"ten_goi_thau": "Gói A", "gia_goi_thau": 1250000},
        "ds_nha_thau_tham_du": [{"ten_nha_thau": "Nhà thầu A"}],
    }
    mappings = [
        ("ten_gt_tuy_chinh", "goi_thau", "ten_goi_thau"),
        ("gia_gt_tuy_chinh", "goi_thau", "gia_goi_thau"),
        ("ds_nt", "ds_nha_thau_tham_du", ""),
        ("ten_nt_tuy_chinh", "ds_nha_thau_tham_du", "ten_nha_thau"),
    ]

    apply_custom_mappings(context, mappings)

    assert context["ten_gt_tuy_chinh"] == "Gói A"
    assert "1.250.000" in str(context["gia_gt_tuy_chinh"])
    assert context["ds_nt"][0]["ten_nt_tuy_chinh"] == "Nhà thầu A"
    assert context["ten_nt_tuy_chinh"] == "Nhà thầu A"

