import hashlib
import uuid


RECORD_ID_PREFIXES = {
    "tai_khoan": "user-",
    "user": "user-",
    "to_chuc": "org-",
    "organization": "org-",
    "chu_dau_tu": "cdt-",
    "chudautu": "cdt-",
    "nha_thau": "nt-",
    "nhathau": "nt-",
    "chuyen_gia": "cg-",
    "chuyengia": "cg-",
    "ke_hoach_lcnt": "kh-",
    "kehoach": "kh-",
    "goi_thau": "gt-",
    "goithau": "gt-",
    "hop_dong": "hd-",
    "hopdong": "hd-",
    "thong_tin_mo_thau": "mt-",
    "thongtinmothau": "mt-",
    "phan_cong_nhan_su": "asg-",
    "assignments": "asg-",
    "trang_thai_ho_so_giay": "hsg-",
    "custompaperstatuses": "hsg-",
    "ma_tran_phan_quyen": "perm-",
    "permissionmatrix": "perm-",
    "ke_hoach_cong_viec": "khcv-",
    "goi_thau_phan_lo": "pl-",
    "lot": "pl-",
    "goi_thau_tuy_chon_mua_them": "tcmt-",
    "option": "tcmt-",
    "goi_thau_gia_han": "gh-",
    "extend": "gh-",
    "goi_thau_lam_ro": "lr-",
    "request": "lr-",
    "reply": "lr-",
    "nha_thau_lien_danh_thanh_vien": "ntld-",
    "thong_tin_mo_thau_lien_danh_thanh_vien": "mtld-",
    "member": "ldtv-",
    "da_thuc_hien": "khcv-",
    "khong_ap_dung": "khcv-",
    "chua_du_dieu_kien": "khcv-",
    "cau_hinh_bien_word": "wmp-",
}


def generate_record_id(record_type):
    prefix = RECORD_ID_PREFIXES.get(str(record_type or "").strip().lower(), "")
    return f"{prefix}{uuid.uuid4()}"


def stable_org_id(org_name):
    return (
        "org-"
        + hashlib.sha256(str(org_name or "").encode("utf-8")).hexdigest()[:16]
    )
