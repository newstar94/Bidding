"""Explicit semantic type mapping for the clean PostgreSQL baseline."""


BOOLEAN_COLUMNS = frozenset(
    {
        "da_xac_minh",
        "username_da_dat",
        "remember_me",
        "is_latest",
        "is_tong_muc_tu_dong",
        "is_thuoc",
        "is_rebid",
        "co_qd_chi_dinh",
        "da_luu_danh_sach_dat",
        "is_optional",
        "financial",
        "identity",
        "signature",
    }
)

DATE_COLUMNS = frozenset(
    {
        "ngay_ap_dung",
        "ngay_phe_duyet",
        "ngay_qd_phe_duyet_du_an",
        "ngay_trinh_du_toan",
        "ngay_phe_duyet_du_toan",
        "ngay_trinh_ke_hoach",
        "ngay_quyet_dinh",
        "ngay_quyet_dinh_ket_qua",
        "ngay_bao_cao_tham_dinh_hsmt",
        "ngay_trinh_hsmt",
        "ngay_cap_chung_chi",
        "ngay_cap_cccd",
        "ngay_ky",
        "ngay_thanh_ly",
        "ngay_qd_chi_dinh",
        "ngay_bao_cao",
        "ngay_du_kien",
        "ngay_thuc_te",
    }
)

TIMESTAMP_COLUMNS = frozenset({"created_at", "updated_at", "archived_at", "deleted_at"})

EPOCH_COLUMNS = frozenset(
    {
        "last_seen_at",
        "idle_expires_at",
        "absolute_expires_at",
        "revoked_at",
        "privileged_reauth_at",
        "expires_at",
        "used_at",
        "window_started_at",
        "starts_at",
        "requested_at",
        "verified_at",
    }
)
