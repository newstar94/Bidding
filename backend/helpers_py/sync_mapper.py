import json
import re

from .schema import SCHEMA_DINH_NGHIA
from .date_utils import normalize_datetime_value
from .id_utils import generate_record_id
from .text_utils import clean_id, safe_float, to_camel_case


def json_key_for_column(table_name, col):
    table_spec = SCHEMA_DINH_NGHIA.get(table_name, {})
    field_map = table_spec.get("field_map", {})
    return field_map.get(col) or ("rootId" if col == "id_goc" else to_camel_case(col))


def db_column_for_json_key(table_name, json_key):
    table_spec = SCHEMA_DINH_NGHIA.get(table_name, {})
    columns = table_spec.get("columns", {})
    for col in columns.keys():
        if json_key_for_column(table_name, col) == json_key:
            return col
    return re.sub(r'(?<!^)(?=[A-Z])', '_', json_key).lower()


def get_payload_value(table_name, item, col):
    json_key = json_key_for_column(table_name, col)
    return item.get(json_key)


def canonicalize_payload_item(table_name, item):
    if not isinstance(item, dict):
        return {}
    table_spec = SCHEMA_DINH_NGHIA.get(table_name, {})
    columns = table_spec.get("columns", {})
    schema_keys = set(columns.keys())
    normalized = {key: value for key, value in item.items() if key not in schema_keys}
    for col in columns.keys():
        json_key = json_key_for_column(table_name, col)
        if json_key in item:
            normalized[json_key] = item.get(json_key)
        elif col in item:
            normalized[json_key] = item.get(col)
    return normalized


def map_db_to_json(table_name, row_dict):
    item = {}
    table_spec = SCHEMA_DINH_NGHIA[table_name]
    explicit_json_fields = set(table_spec.get("json_fields", []))
    for col in table_spec["columns"].keys():
        json_key = json_key_for_column(table_name, col)
        val = row_dict.get(col)
        is_json_field = (
            col in explicit_json_fields
            or col.endswith("_list")
            or col.startswith("cv_")
        )
        if is_json_field:
            if val:
                try:
                    val = json.loads(val)
                except Exception:
                    val = []
            else:
                val = []
        item[json_key] = val
    return item


PLAN_CHILD_LISTS = {
    "cvDaThucHienList": ("da_thuc_hien", "cv_da_thuc_hien"),
    "cvKhongApDungList": ("khong_ap_dung", "cv_khong_ap_dung"),
    "cvChuaDuDieuKienList": ("chua_du_dieu_kien", "cv_chua_du_dieu_kien"),
}

CHILD_MEMBER_KEY = "thanhVienLienDanh"


def _parse_child_list(value):
    if value is None:
        return []
    if isinstance(value, list):
        return [item for item in value if isinstance(item, dict)]
    if isinstance(value, str) and value.strip():
        try:
            parsed = json.loads(value)
            if isinstance(parsed, list):
                return [item for item in parsed if isinstance(item, dict)]
        except Exception:
            return []
    return []


def _dedupe_child_items(items, key_fn):
    unique = []
    seen = set()
    for item in items:
        key = key_fn(item)
        if not key or key in seen:
            continue
        seen.add(key)
        unique.append(item)
    return unique


def _norm_child_key(value):
    return re.sub(r"\s+", " ", str(value or "").strip()).lower()


def _has_child_key(item, key):
    return isinstance(item, dict) and key in item


def _first_value(item, *keys, default=None):
    for key in keys:
        if isinstance(item, dict) and key in item:
            return item.get(key)
    return default


def _child_row_id(parent_id, prefix, index, raw_id=None):
    return clean_id(raw_id) or generate_record_id(prefix)


def _child_number(value):
    parsed = safe_float(value)
    return parsed if parsed is not None else 0


def save_child_payloads(cursor, table_name, item, owner_id, owner_type, sync_version, updated_at):
    parent_id = clean_id(item.get("id"))
    if not parent_id:
        return
    if table_name == "ke_hoach_lcnt":
        _save_plan_children(cursor, parent_id, item, owner_id, owner_type, sync_version, updated_at)
    elif table_name == "goi_thau":
        _save_package_children(cursor, parent_id, item, owner_id, owner_type, sync_version, updated_at)
        _save_package_expert_relations(cursor, parent_id, item, owner_id, owner_type)
    elif table_name == "nha_thau":
        _save_member_children(cursor, "nha_thau_lien_danh_thanh_vien", "nha_thau_id", parent_id, item, owner_id, owner_type, sync_version, updated_at)
    elif table_name == "thong_tin_mo_thau":
        _save_member_children(cursor, "thong_tin_mo_thau_lien_danh_thanh_vien", "thong_tin_mo_thau_id", parent_id, item, owner_id, owner_type, sync_version, updated_at)


def _save_plan_children(cursor, parent_id, item, owner_id, owner_type, sync_version, updated_at):
    rows = []
    for camel_key, (kind, _snake_key) in PLAN_CHILD_LISTS.items():
        if not _has_child_key(item, camel_key):
            continue
        cursor.execute(
            "DELETE FROM ke_hoach_cong_viec WHERE owner_id = ? AND ke_hoach_id = ? AND loai = ?",
            (owner_id, parent_id, kind),
        )
        for index, row in enumerate(_parse_child_list(item.get(camel_key))):
            rows.append((
                _child_row_id(parent_id, kind, index, _first_value(row, "id")),
                owner_id,
                owner_type,
                parent_id,
                kind,
                _first_value(row, "tenCongViec", "ten_cong_viec", default=""),
                _child_number(_first_value(row, "giaTri", "gia_tri")),
                _first_value(row, "donViThucHien", "don_vi_thuc_hien", default=""),
                _first_value(row, "vanBanPheDuyet", "van_ban_phe_duyet", default=""),
                index,
                sync_version,
                updated_at,
            ))
    if rows:
        cursor.executemany("""
            INSERT INTO ke_hoach_cong_viec (
                id, owner_id, owner_type, ke_hoach_id, loai, ten_cong_viec, gia_tri,
                don_vi_thuc_hien, van_ban_phe_duyet, sort_order, sync_version, updated_at
            ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        """, rows)


def _save_package_children(cursor, parent_id, item, owner_id, owner_type, sync_version, updated_at):
    if _has_child_key(item, "phanLoList") or _has_child_key(item, "awardedPhanLoList"):
        lots = _parse_child_list(item.get("phanLoList")) if _has_child_key(item, "phanLoList") else _fetch_lots(cursor, parent_id, owner_id)
        awards = _parse_child_list(item.get("awardedPhanLoList")) if _has_child_key(item, "awardedPhanLoList") else _fetch_awards(cursor, parent_id, owner_id)
        _save_lots(cursor, parent_id, lots, awards, owner_id, owner_type, sync_version, updated_at)
    if _has_child_key(item, "tuyChonMuaThemList"):
        _save_options(cursor, parent_id, item.get("tuyChonMuaThemList"), owner_id, owner_type, sync_version, updated_at)
    if _has_child_key(item, "giaHanList"):
        _save_extensions(cursor, parent_id, item.get("giaHanList"), owner_id, owner_type, sync_version, updated_at)
    _save_clarifications(cursor, parent_id, item, owner_id, owner_type, sync_version, updated_at)


def _save_package_expert_relations(cursor, parent_id, item, owner_id, owner_type):
    relation_specs = [
        ("toChuyenGia", "chuyen_gia"),
        ("toThamDinh", "tham_dinh"),
    ]
    for payload_key, relation_type in relation_specs:
        if not _has_child_key(item, payload_key):
            continue
        cursor.execute(
            "DELETE FROM goi_thau_chuyen_gia WHERE owner_id = ? AND goi_thau_id = ? AND loai = ?",
            (owner_id, parent_id, relation_type),
        )
        rows = []
        for row in _parse_child_list(item.get(payload_key)):
            expert_id = clean_id(_first_value(row, "chuyenGiaId", "chuyen_gia_id", "id"))
            if not expert_id:
                continue
            cursor.execute(
                "SELECT 1 FROM chuyen_gia WHERE owner_id = ? AND id = ? LIMIT 1",
                (owner_id, expert_id),
            )
            if not cursor.fetchone():
                raise ValueError(f"Chuyen gia {expert_id} khong thuoc owner hien tai.")
            rows.append((
                owner_id,
                owner_type,
                parent_id,
                expert_id,
                relation_type,
                _first_value(row, "chucVu", "chuc_vu", default="Tổ viên") or "Tổ viên",
                _first_value(row, "congViec", "cong_viec", default="") or "",
            ))
        if rows:
            cursor.executemany("""
                INSERT OR REPLACE INTO goi_thau_chuyen_gia (
                    owner_id, owner_type, goi_thau_id, chuyen_gia_id, loai, chuc_vu, cong_viec
                ) VALUES (?, ?, ?, ?, ?, ?, ?)
            """, rows)


def _lot_match_key(row):
    return str(_first_value(row, "maPhanLo", "ma_phan_lo", "tenPhanLo", "ten_phan_lo", default="")).strip().lower()


def _save_lots(cursor, parent_id, lots, awards, owner_id, owner_type, sync_version, updated_at):
    merged_by_key = {}
    ordered = []
    for index, row in enumerate(lots):
        key = _lot_match_key(row) or f"idx:{index}"
        merged = dict(row)
        merged_by_key[key] = merged
        ordered.append(merged)
    for award in awards:
        key = _lot_match_key(award)
        target = merged_by_key.get(key)
        if target is None:
            target = {
                "id": _first_value(award, "id"),
                "maPhanLo": _first_value(award, "maPhanLo", "ma_phan_lo", default=""),
                "tenPhanLo": _first_value(award, "tenPhanLo", "ten_phan_lo", default=""),
            }
            merged_by_key[key or f"award:{len(ordered)}"] = target
            ordered.append(target)
        target["nhaThauTrungThauId"] = _first_value(award, "nhaThauTrungThauId", "nha_thau_trung_thau_id", default="")
        target["giaTrungThau"] = _first_value(award, "giaTrungThau", "gia_trung_thau", default=0)
        target["thoiGianGoiThau"] = _first_value(award, "thoiGianGoiThau", "thoi_gian_goi_thau", default="")
        target["thoiGianHopDong"] = _first_value(award, "thoiGianHopDong", "thoi_gian_hop_dong", default="")

    cursor.execute("DELETE FROM goi_thau_phan_lo WHERE owner_id = ? AND goi_thau_id = ?", (owner_id, parent_id))
    rows = []
    for index, row in enumerate(ordered):
        rows.append((
            _child_row_id(parent_id, "lot", index, _first_value(row, "id")),
            owner_id,
            owner_type,
            parent_id,
            _first_value(row, "maPhanLo", "ma_phan_lo", default=""),
            _first_value(row, "tenPhanLo", "ten_phan_lo", default=""),
            _child_number(_first_value(row, "giaTriPhanLo", "gia_tri_phan_lo")),
            _child_number(_first_value(row, "baoDamDuThau", "bao_dam_du_thau")),
            _first_value(row, "thoiGianThucHien", "thoi_gian_thuc_hien", default=""),
            clean_id(_first_value(row, "nhaThauTrungThauId", "nha_thau_trung_thau_id")),
            _child_number(_first_value(row, "giaTrungThau", "gia_trung_thau")),
            _first_value(row, "thoiGianGoiThau", "thoi_gian_goi_thau", default=""),
            _first_value(row, "thoiGianHopDong", "thoi_gian_hop_dong", default=""),
            index,
            sync_version,
            updated_at,
        ))
    if rows:
        cursor.executemany("""
            INSERT INTO goi_thau_phan_lo (
                id, owner_id, owner_type, goi_thau_id, ma_phan_lo, ten_phan_lo,
                gia_tri_phan_lo, bao_dam_du_thau, thoi_gian_thuc_hien,
                nha_thau_trung_thau_id, gia_trung_thau, thoi_gian_goi_thau,
                thoi_gian_hop_dong, sort_order, sync_version, updated_at
            ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        """, rows)


def _save_options(cursor, parent_id, value, owner_id, owner_type, sync_version, updated_at):
    cursor.execute("DELETE FROM goi_thau_tuy_chon_mua_them WHERE owner_id = ? AND goi_thau_id = ?", (owner_id, parent_id))
    rows = []
    for index, row in enumerate(_parse_child_list(value)):
        rows.append((
            _child_row_id(parent_id, "option", index, _first_value(row, "id")),
            owner_id,
            owner_type,
            parent_id,
            _first_value(row, "hangMuc", "hang_muc", default=""),
            _first_value(row, "donVi", "don_vi", default=""),
            _child_number(_first_value(row, "soLuong", "so_luong")),
            _child_number(_first_value(row, "tyLe", "ty_le")),
            _child_number(_first_value(row, "giaTriUocTinh", "gia_tri_uoc_tinh")),
            index,
            sync_version,
            updated_at,
        ))
    if rows:
        cursor.executemany("""
            INSERT INTO goi_thau_tuy_chon_mua_them (
                id, owner_id, owner_type, goi_thau_id, hang_muc, don_vi, so_luong,
                ty_le, gia_tri_uoc_tinh, sort_order, sync_version, updated_at
            ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        """, rows)


def _save_extensions(cursor, parent_id, value, owner_id, owner_type, sync_version, updated_at):
    cursor.execute("DELETE FROM goi_thau_gia_han WHERE owner_id = ? AND goi_thau_id = ?", (owner_id, parent_id))
    rows = []
    items = _dedupe_child_items(
        _parse_child_list(value),
        lambda row: f"{_norm_child_key(_first_value(row, 'thoiGianDongThau', 'thoi_gian_dong_thau'))}|{_norm_child_key(_first_value(row, 'lyDoGiaHan', 'ly_do_gia_han'))}"
    )
    for index, row in enumerate(items):
        rows.append((
            _child_row_id(parent_id, "extend", index, _first_value(row, "id")),
            owner_id,
            owner_type,
            parent_id,
            normalize_datetime_value(_first_value(row, "thoiGianDongThau", "thoi_gian_dong_thau", default="")),
            _first_value(row, "lyDoGiaHan", "ly_do_gia_han", default=""),
            index,
            sync_version,
            updated_at,
        ))
    if rows:
        cursor.executemany("""
            INSERT INTO goi_thau_gia_han (
                id, owner_id, owner_type, goi_thau_id, thoi_gian_dong_thau,
                ly_do_gia_han, sort_order, sync_version, updated_at
            ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
        """, rows)


def _save_clarifications(cursor, parent_id, item, owner_id, owner_type, sync_version, updated_at):
    mapping = [
        ("yeuCauLamRoList", "yeu_cau", "request", "thoiGianYeuCau", "noiDungYeuCau"),
        ("traLoiLamRoList", "tra_loi", "reply", "thoiGianTraLoi", "noiDungTraLoi"),
    ]
    rows = []
    for key, kind, prefix, time_key, content_key in mapping:
        if not _has_child_key(item, key):
            continue
        cursor.execute(
            "DELETE FROM goi_thau_lam_ro WHERE owner_id = ? AND goi_thau_id = ? AND loai = ?",
            (owner_id, parent_id, kind),
        )
        items = _dedupe_child_items(
            _parse_child_list(item.get(key)),
            lambda row, tk=time_key, ck=content_key: f"{_norm_child_key(_first_value(row, tk))}|{_norm_child_key(_first_value(row, ck))}"
        )
        for index, row in enumerate(items):
            rows.append((
                _child_row_id(parent_id, prefix, index, _first_value(row, "id")),
                owner_id,
                owner_type,
                parent_id,
                kind,
                normalize_datetime_value(_first_value(row, time_key, default="")),
                _first_value(row, content_key, default=""),
                index,
                sync_version,
                updated_at,
            ))
    if rows:
        cursor.executemany("""
            INSERT INTO goi_thau_lam_ro (
                id, owner_id, owner_type, goi_thau_id, loai, thoi_gian,
                noi_dung, sort_order, sync_version, updated_at
            ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        """, rows)


def _save_member_children(cursor, child_table, parent_col, parent_id, item, owner_id, owner_type, sync_version, updated_at):
    if not _has_child_key(item, CHILD_MEMBER_KEY):
        return
    cursor.execute(f"DELETE FROM {child_table} WHERE owner_id = ? AND {parent_col} = ?", (owner_id, parent_id))
    rows = []
    for index, row in enumerate(_parse_child_list(item.get(CHILD_MEMBER_KEY))):
        rows.append((
            _child_row_id(parent_id, "member", index, _first_value(row, "id")),
            owner_id,
            owner_type,
            parent_id,
            _first_value(row, "tenNhaThau", "ten_nha_thau", default=""),
            _first_value(row, "maSoThue", "ma_so_thue", default=""),
            _first_value(row, "vaiTro", "vai_tro", default=""),
            _first_value(row, "nguoiDaiDien", "nguoi_dai_dien", default=""),
            _first_value(row, "danhXung", "danh_xung", default=""),
            _first_value(row, "soDienThoai", "so_dien_thoai", default=""),
            _first_value(row, "email", default=""),
            _first_value(row, "diaChi", "dia_chi", default=""),
            _first_value(row, "diaChiGoc", "dia_chi_goc", default=""),
            _first_value(row, "soTaiKhoan", "so_tai_khoan", default=""),
            _first_value(row, "noiMoTaiKhoan", "noi_mo_tai_khoan", default=""),
            _first_value(row, "maNganHang", "ma_ngan_hang", default=""),
            index,
            sync_version,
            updated_at,
        ))
    if rows:
        cursor.executemany(f"""
            INSERT INTO {child_table} (
                id, owner_id, owner_type, {parent_col}, ten_nha_thau, ma_so_thue,
                vai_tro, nguoi_dai_dien, danh_xung, so_dien_thoai, email, dia_chi, dia_chi_goc,
                so_tai_khoan, noi_mo_tai_khoan, ma_ngan_hang, sort_order,
                sync_version, updated_at
            ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        """, rows)


def attach_child_rows(cursor, table_name, item, owner_id=None, naming="camel"):
    attach_child_rows_to_items(cursor, table_name, [item], owner_id=owner_id, naming=naming)
    return item


def attach_child_rows_to_items(cursor, table_name, items, owner_id=None, naming="camel"):
    if not items:
        return items
    parent_ids = [clean_id(item.get("id")) for item in items if isinstance(item, dict) and item.get("id")]
    parent_ids = [parent_id for parent_id in parent_ids if parent_id]
    if not parent_ids:
        return items

    by_id = {clean_id(item.get("id")): item for item in items if isinstance(item, dict)}
    if table_name == "ke_hoach_lcnt":
        _attach_plan_children(cursor, by_id, parent_ids, owner_id, naming)
    elif table_name == "goi_thau":
        _attach_package_children(cursor, by_id, parent_ids, owner_id, naming)
    elif table_name == "nha_thau":
        _attach_members(cursor, by_id, parent_ids, "nha_thau_lien_danh_thanh_vien", "nha_thau_id", owner_id, naming)
    elif table_name == "thong_tin_mo_thau":
        _attach_members(cursor, by_id, parent_ids, "thong_tin_mo_thau_lien_danh_thanh_vien", "thong_tin_mo_thau_id", owner_id, naming)
    return items


def fetch_package_lot_codes(cursor, goi_thau_id, owner_id):
    cursor.execute("""
        SELECT ma_phan_lo
        FROM goi_thau_phan_lo
        WHERE goi_thau_id = ? AND owner_id = ? AND COALESCE(ma_phan_lo, '') != ''
        ORDER BY sort_order, id
    """, (goi_thau_id, owner_id))
    return [row[0] for row in cursor.fetchall()]


def _select_children(cursor, table, parent_col, parent_ids, owner_id=None, extra_order="sort_order, id"):
    placeholders = ", ".join(["?"] * len(parent_ids))
    params = list(parent_ids)
    owner_filter = ""
    if owner_id is not None:
        owner_filter = " AND owner_id = ?"
        params.append(owner_id)
    cursor.execute(
        f"SELECT * FROM {table} WHERE {parent_col} IN ({placeholders}){owner_filter} ORDER BY {parent_col}, {extra_order}",
        params,
    )
    return [dict(row) for row in cursor.fetchall()]


def _attach_plan_children(cursor, by_id, parent_ids, owner_id, naming):
    defaults = (
        {camel: [] for camel in PLAN_CHILD_LISTS}
        if naming == "camel"
        else {snake: [] for _camel, (_kind, snake) in PLAN_CHILD_LISTS.items()}
    )
    for item in by_id.values():
        item.update({key: [] for key in defaults})

    kind_to_key = {
        kind: camel if naming == "camel" else snake
        for camel, (kind, snake) in PLAN_CHILD_LISTS.items()
    }
    for row in _select_children(cursor, "ke_hoach_cong_viec", "ke_hoach_id", parent_ids, owner_id):
        item = by_id.get(row.get("ke_hoach_id"))
        key = kind_to_key.get(row.get("loai"))
        if item and key:
            item[key].append(_format_plan_child(row, naming))


def _attach_package_children(cursor, by_id, parent_ids, owner_id, naming):
    defaults = {
        "camel": ["phanLoList", "awardedPhanLoList", "tuyChonMuaThemList", "giaHanList", "yeuCauLamRoList", "traLoiLamRoList"],
        "snake": ["phan_lo_list", "awarded_phan_lo_list", "tuy_chon_mua_them_list", "gia_han_list", "yeu_cau_lam_ro_list", "tra_loi_lam_ro_list"],
    }[naming]
    for item in by_id.values():
        item.update({key: [] for key in defaults})

    for row in _select_children(cursor, "goi_thau_phan_lo", "goi_thau_id", parent_ids, owner_id):
        item = by_id.get(row.get("goi_thau_id"))
        if not item:
            continue
        item["phanLoList" if naming == "camel" else "phan_lo_list"].append(_format_lot_child(row, naming))
        if _has_lot_award(row):
            item["awardedPhanLoList" if naming == "camel" else "awarded_phan_lo_list"].append(_format_award_child(row, naming))

    for row in _select_children(cursor, "goi_thau_tuy_chon_mua_them", "goi_thau_id", parent_ids, owner_id):
        item = by_id.get(row.get("goi_thau_id"))
        if item:
            item["tuyChonMuaThemList" if naming == "camel" else "tuy_chon_mua_them_list"].append(_format_option_child(row, naming))

    for row in _select_children(cursor, "goi_thau_gia_han", "goi_thau_id", parent_ids, owner_id):
        item = by_id.get(row.get("goi_thau_id"))
        if item:
            item["giaHanList" if naming == "camel" else "gia_han_list"].append(_format_extension_child(row, naming))

    for row in _select_children(cursor, "goi_thau_lam_ro", "goi_thau_id", parent_ids, owner_id):
        item = by_id.get(row.get("goi_thau_id"))
        if not item:
            continue
        if row.get("loai") == "yeu_cau":
            item["yeuCauLamRoList" if naming == "camel" else "yeu_cau_lam_ro_list"].append(_format_clarification_child(row, naming, True))
        elif row.get("loai") == "tra_loi":
            item["traLoiLamRoList" if naming == "camel" else "tra_loi_lam_ro_list"].append(_format_clarification_child(row, naming, False))


def _attach_members(cursor, by_id, parent_ids, child_table, parent_col, owner_id, naming):
    key = "thanhVienLienDanh" if naming == "camel" else "thanh_vien_lien_danh"
    for item in by_id.values():
        item[key] = []
    for row in _select_children(cursor, child_table, parent_col, parent_ids, owner_id):
        item = by_id.get(row.get(parent_col))
        if item:
            item[key].append(_format_member_child(row, naming))


def _fetch_lots(cursor, parent_id, owner_id):
    return [_format_lot_child(row, "camel") for row in _select_children(cursor, "goi_thau_phan_lo", "goi_thau_id", [parent_id], owner_id)]


def _fetch_awards(cursor, parent_id, owner_id):
    return [
        _format_award_child(row, "camel")
        for row in _select_children(cursor, "goi_thau_phan_lo", "goi_thau_id", [parent_id], owner_id)
        if _has_lot_award(row)
    ]


def _has_lot_award(row):
    return bool(
        row.get("nha_thau_trung_thau_id")
        or _child_number(row.get("gia_trung_thau")) > 0
        or row.get("thoi_gian_goi_thau")
        or row.get("thoi_gian_hop_dong")
    )


def _format_plan_child(row, naming):
    return _shape_child(
        row,
        naming,
        [
            ("id", "id"),
            ("ten_cong_viec", "tenCongViec"),
            ("gia_tri", "giaTri"),
            ("don_vi_thuc_hien", "donViThucHien"),
            ("van_ban_phe_duyet", "vanBanPheDuyet"),
        ],
    )


def _format_lot_child(row, naming):
    return _shape_child(
        row,
        naming,
        [
            ("id", "id"),
            ("ma_phan_lo", "maPhanLo"),
            ("ten_phan_lo", "tenPhanLo"),
            ("gia_tri_phan_lo", "giaTriPhanLo"),
            ("bao_dam_du_thau", "baoDamDuThau"),
            ("thoi_gian_thuc_hien", "thoiGianThucHien"),
            ("nha_thau_trung_thau_id", "nhaThauTrungThauId"),
            ("gia_trung_thau", "giaTrungThau"),
            ("thoi_gian_goi_thau", "thoiGianGoiThau"),
            ("thoi_gian_hop_dong", "thoiGianHopDong"),
        ],
    )


def _format_award_child(row, naming):
    return _shape_child(
        row,
        naming,
        [
            ("id", "id"),
            ("ma_phan_lo", "maPhanLo"),
            ("ten_phan_lo", "tenPhanLo"),
            ("nha_thau_trung_thau_id", "nhaThauTrungThauId"),
            ("gia_trung_thau", "giaTrungThau"),
            ("thoi_gian_goi_thau", "thoiGianGoiThau"),
            ("thoi_gian_hop_dong", "thoiGianHopDong"),
        ],
    )


def _format_option_child(row, naming):
    return _shape_child(
        row,
        naming,
        [
            ("id", "id"),
            ("hang_muc", "hangMuc"),
            ("don_vi", "donVi"),
            ("so_luong", "soLuong"),
            ("ty_le", "tyLe"),
            ("gia_tri_uoc_tinh", "giaTriUocTinh"),
        ],
    )


def _format_extension_child(row, naming):
    return _shape_child(row, naming, [("id", "id"), ("thoi_gian_dong_thau", "thoiGianDongThau"), ("ly_do_gia_han", "lyDoGiaHan")])


def _format_clarification_child(row, naming, is_request):
    if naming == "snake":
        return {
            "id": row.get("id"),
            ("thoi_gian_yeu_cau" if is_request else "thoi_gian_tra_loi"): row.get("thoi_gian") or "",
            ("noi_dung_yeu_cau" if is_request else "noi_dung_tra_loi"): row.get("noi_dung") or "",
        }
    return {
        "id": row.get("id"),
        ("thoiGianYeuCau" if is_request else "thoiGianTraLoi"): row.get("thoi_gian") or "",
        ("noiDungYeuCau" if is_request else "noiDungTraLoi"): row.get("noi_dung") or "",
    }


def _format_member_child(row, naming):
    return _shape_child(
        row,
        naming,
        [
            ("id", "id"),
            ("ten_nha_thau", "tenNhaThau"),
            ("ma_so_thue", "maSoThue"),
            ("vai_tro", "vaiTro"),
            ("nguoi_dai_dien", "nguoiDaiDien"),
            ("danh_xung", "danhXung"),
            ("so_dien_thoai", "soDienThoai"),
            ("email", "email"),
            ("dia_chi", "diaChi"),
            ("dia_chi_goc", "diaChiGoc"),
            ("so_tai_khoan", "soTaiKhoan"),
            ("noi_mo_tai_khoan", "noiMoTaiKhoan"),
            ("ma_ngan_hang", "maNganHang"),
        ],
    )


def _shape_child(row, naming, fields):
    shaped = {}
    for snake_key, camel_key in fields:
        key = snake_key if naming == "snake" else camel_key
        value = row.get(snake_key)
        if snake_key == "id":
            shaped[key] = value
        elif snake_key.startswith("gia_") or snake_key in {"bao_dam_du_thau", "so_luong", "ty_le"}:
            shaped[key] = value or 0
        else:
            shaped[key] = value or ""
    return shaped
