"""Canonical ownership and snapshot disposition for package relations."""

from __future__ import annotations

from dataclasses import dataclass


@dataclass(frozen=True)
class PackageRelationPolicy:
    table_name: str
    payload_key: str | None
    nested_field: str | None
    disposition: str
    stable_order: tuple[str, ...]
    external_reference: bool = False


PACKAGE_RELATION_REGISTRY = (
    PackageRelationPolicy("goi_thau_phan_lo", None, "phanLoList", "clone", ("ma_phan_lo", "id")),
    PackageRelationPolicy("goi_thau_hang_hoa", "goithauhanghoa", None, "clone", ("goi_thau_id", "ma_hang_hoa", "id")),
    PackageRelationPolicy("thong_tin_mo_thau", "thongtinmothau", None, "clone", ("goi_thau_id", "nha_thau_id", "ma_phan_lo", "id")),
    PackageRelationPolicy("vong_danh_gia", None, "danhGiaHsdtMetadata", "clone", ("loai_vong", "id")),
    PackageRelationPolicy("tieu_chi_danh_gia", None, "danhGiaHsdtMetadata", "clone", ("thu_tu", "ma_tieu_chi", "id")),
    PackageRelationPolicy("ket_qua_danh_gia_nha_thau", None, "baoCaoDanhGiaChiTietList", "clone", ("vong_danh_gia_id", "thong_tin_mo_thau_id", "id")),
    PackageRelationPolicy("bao_cao_danh_gia_nha_thau", None, "baoCaoDanhGiaChiTietList", "clone", ("vong_danh_gia_id", "id")),
    PackageRelationPolicy("chi_tiet_danh_gia_nha_thau", None, "chiTietList", "clone", ("tieu_chi_danh_gia_id", "id")),
    PackageRelationPolicy("thong_tin_mo_thau_lien_danh_thanh_vien", None, "thanhVienLienDanh", "clone", ("sort_order", "id")),
    PackageRelationPolicy("hang_hoa_du_thau_nha_thau", "hanghoaduthaunhathau", None, "clone", ("goi_thau_id", "thong_tin_mo_thau_id", "id")),
    PackageRelationPolicy("goi_thau_tuy_chon_mua_them", None, "tuyChonMuaThemList", "clone", ("sort_order", "id")),
    PackageRelationPolicy("goi_thau_gia_han", None, "giaHanList", "clone", ("thoi_gian_dong_thau", "id")),
    PackageRelationPolicy("goi_thau_lam_ro", None, "yeuCauLamRoList", "clone", ("thoi_gian", "id")),
    PackageRelationPolicy("goi_thau_lam_ro", None, "traLoiLamRoList", "clone", ("thoi_gian", "id")),
    PackageRelationPolicy("goi_thau_moc_tien_do", None, "timelineItems", "clone", ("sort_order", "ma_moc", "id")),
    PackageRelationPolicy("goi_thau_dieu_chinh_hsmt", None, "ehsmtAdjustments", "clone", ("sequence", "id")),
    PackageRelationPolicy("phan_cong_nhan_su", "assignments", None, "clone", ("id_muc_tieu", "id_nhan_vien", "id")),
    PackageRelationPolicy("goi_thau_chuyen_gia", None, "toChuyenGia", "clone", ("loai", "chuyen_gia_id"), True),
    PackageRelationPolicy("goi_thau_chuyen_gia", None, "toThamDinh", "clone", ("loai", "chuyen_gia_id"), True),
    PackageRelationPolicy("nha_thau_tham_du_mo_thau", None, None, "derived", ("thong_tin_mo_thau_id", "nha_thau_goc_id"), True),
    PackageRelationPolicy("contractor_violation_checks", None, None, "retain", ("checked_at", "id"), True),
    PackageRelationPolicy("dot_xu_ly_phan_lo", None, None, "retain", ("sequence_no", "id")),
    PackageRelationPolicy("dot_xu_ly_phan_lo_chi_tiet", None, None, "retain", ("batch_id", "lot_id")),
    PackageRelationPolicy("nhom_phu_thuoc_phan_lo", None, None, "retain", ("dependency_kind", "id")),
    PackageRelationPolicy("nhom_phu_thuoc_phan_lo_thanh_vien", None, None, "retain", ("group_id", "lot_id")),
    PackageRelationPolicy("ho_so_nghiep_vu_lcnt", None, None, "retain", ("created_at", "id")),
    PackageRelationPolicy("ho_so_nghiep_vu_lcnt_phan_lo", None, None, "retain", ("document_id", "lot_id")),
    PackageRelationPolicy("tai_lieu_goi_thau", None, None, "retain", ("uploaded_at", "id")),
    PackageRelationPolicy("hop_dong_goi_thau", None, None, "retain", ("hop_dong_id", "goi_thau_id")),
    PackageRelationPolicy("package_legal_binding", None, None, "retain", ("binding_revision", "id")),
    PackageRelationPolicy("package_legal_binding_head", None, None, "retain", ("binding_revision", "package_id")),
)


def relation_tables(disposition):
    return tuple(
        policy.table_name
        for policy in PACKAGE_RELATION_REGISTRY
        if policy.disposition == disposition
    )


def cloned_nested_fields():
    return tuple(dict.fromkeys(
        policy.nested_field
        for policy in PACKAGE_RELATION_REGISTRY
        if (
            policy.disposition == "clone"
            and policy.nested_field
            and not policy.external_reference
        )
    ))
