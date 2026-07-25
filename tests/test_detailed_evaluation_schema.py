from backend.db.schema import SCHEMA_DINH_NGHIA


def test_fresh_schema_contains_normalized_detailed_evaluations():
    criteria = SCHEMA_DINH_NGHIA["tieu_chi_danh_gia"]
    assert {
        "nhom_danh_gia",
        "loai_ket_qua",
        "bat_buoc",
        "tieu_chi_cha_id",
    }.issubset(criteria["columns"])

    report = SCHEMA_DINH_NGHIA["bao_cao_danh_gia_nha_thau"]
    detail = SCHEMA_DINH_NGHIA["chi_tiet_danh_gia_nha_thau"]
    assert report["primary_keys"] == ["organization_id", "id"]
    assert detail["primary_keys"] == ["organization_id", "id"]
    assert "UNIQUE(organization_id, vong_danh_gia_id, thong_tin_mo_thau_id)" in report["unique_constraints"]
    assert "UNIQUE(organization_id, bao_cao_danh_gia_nha_thau_id, tieu_chi_danh_gia_id)" in detail["unique_constraints"]
    assert any("vong_danh_gia(organization_id, id) ON DELETE CASCADE" in fk for fk in report["foreign_keys"])
    assert any("thong_tin_mo_thau(organization_id, id) ON DELETE CASCADE" in fk for fk in report["foreign_keys"])
    assert any("bao_cao_danh_gia_nha_thau(organization_id, id) ON DELETE CASCADE" in fk for fk in detail["foreign_keys"])
    assert any("tieu_chi_danh_gia(organization_id, id) ON DELETE CASCADE" in fk for fk in detail["foreign_keys"])
