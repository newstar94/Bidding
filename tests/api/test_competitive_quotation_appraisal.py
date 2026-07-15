import json

from backend.app import app  # noqa: F401 - initializes backend import paths
from backend.documents.docx_service import clear_competitive_quotation_appraisal
from backend.sync.mapper import canonicalize_payload_item


def test_word_context_clears_competitive_quotation_appraisal_data():
    package = {
        "hinh_thuc_lua_chon": "Chào hàng cạnh tranh",
        "yeu_cau_tham_dinh_hsmt": "Có",
        "so_bao_cao_tham_dinh_hsmt": "12/BC-TĐ",
        "ngay_bao_cao_tham_dinh_hsmt": "2026-07-12",
        "to_tham_dinh": [{"id": "cg-1"}],
        "danh_gia_hsdt_metadata": json.dumps({
            "technical": {"soBctdKt": "1", "qualifiedSaved": True},
            "result": {"ngayBctdKetQua": "2026-07-13", "approved": True},
        }),
    }

    clear_competitive_quotation_appraisal(package)

    assert package["yeu_cau_tham_dinh_hsmt"] == "Không"
    assert package["so_bao_cao_tham_dinh_hsmt"] == ""
    assert package["ngay_bao_cao_tham_dinh_hsmt"] == ""
    assert package["to_tham_dinh"] == []
    metadata = json.loads(package["danh_gia_hsdt_metadata"])
    assert metadata["technical"] == {"qualifiedSaved": True}
    assert metadata["result"] == {"approved": True}


def test_word_context_keeps_appraisal_data_for_other_methods():
    package = {
        "hinh_thuc_lua_chon": "Đấu thầu rộng rãi",
        "yeu_cau_tham_dinh_hsmt": "Có",
    }

    clear_competitive_quotation_appraisal(package)

    assert package["yeu_cau_tham_dinh_hsmt"] == "Có"


def test_sync_clears_competitive_quotation_appraisal_before_sqlite_write():
    payload = {
        "id": "gt-1",
        "hinhThucLuaChon": "Chào hàng cạnh tranh",
        "yeuCauThamDinhHsmt": "Có",
        "soBaoCaoThamDinhHsmt": "12/BC-TĐ",
        "ngayBaoCaoThamDinhHsmt": "2026-07-12",
        "toThamDinh": [{"chuyenGiaId": "cg-1"}],
    }

    normalized = canonicalize_payload_item("goi_thau", payload)

    assert normalized["yeuCauThamDinhHsmt"] == "Không"
    assert normalized["soBaoCaoThamDinhHsmt"] == ""
    assert normalized["ngayBaoCaoThamDinhHsmt"] == ""
    assert normalized["toThamDinh"] == []
