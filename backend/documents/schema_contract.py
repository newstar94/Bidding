from backend.db.schema import SCHEMA_DINH_NGHIA
from backend.shared.text_utils import to_camel_case


CLIENT_TABLE_MAP = {
    "systempackages": "goi_dich_vu",
    "employees": "tai_khoan",
    "chudautu": "chu_dau_tu",
    "kehoach": "ke_hoach_lcnt",
    "nhathau": "nha_thau",
    "goithau": "goi_thau",
    "chuyengia": "chuyen_gia",
    "hopdong": "hop_dong",
    "assignments": "phan_cong_nhan_su",
    "customcontractstatuses": "danh_muc_trang_thai_hop_dong",
    "thongtinmothau": "thong_tin_mo_thau",
    "organizations": "to_chuc",
    "permissionmatrix": "ma_tran_phan_quyen",
}


def json_key_for_column(table_name, column_name):
    table_spec = SCHEMA_DINH_NGHIA.get(table_name, {})
    field_map = table_spec.get("field_map", {})
    return field_map.get(column_name) or ("rootId" if column_name == "id_goc" else to_camel_case(column_name))
