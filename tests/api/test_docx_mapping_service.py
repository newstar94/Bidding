from backend.app import app  # noqa: F401 - initializes backend import paths
from backend.documents.docx_mapping_service import apply_custom_mappings, lowercase_partner_identity_codes


def test_word_export_lowercases_partner_codes_in_context_and_custom_aliases():
    context = {
        "chu_dau_tu": {"ma_chu_dau_tu": "VN3000166995"},
        "nha_thau": [{"ma_nha_thau": "VNP0109965278"}],
        "ma_cdt": "VN3000166995",
        "ma_nt_tuy_chinh": "VNP0109965278",
    }
    mappings = [
        ("ma_nt_tuy_chinh", "nha_thau", "ma_nha_thau"),
    ]

    lowercase_partner_identity_codes(context, mappings)

    assert context["chu_dau_tu"]["ma_chu_dau_tu"] == "vn3000166995"
    assert context["nha_thau"][0]["ma_nha_thau"] == "vnp0109965278"
    assert context["ma_cdt"] == "vn3000166995"
    assert context["ma_nt_tuy_chinh"] == "vnp0109965278"


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
