import json
import re

from backend.db.schema import MONEY_COLUMNS, SCHEMA_DINH_NGHIA
from backend.shared.numeric_utils import money_json_value, parse_vnd_amount
from backend.shared.domain_enums import enum_label
from backend.shared.date_utils import normalize_datetime_value
from backend.db.id_utils import generate_record_id
from backend.sync.evaluation_metadata import dump_evaluation_metadata, parse_evaluation_metadata
from backend.shared.text_utils import (
    clean_id,
    normalize_business_identifier,
    normalize_organization_name,
    normalize_person_name,
    safe_float,
    to_camel_case,
)


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
    business_key_fields = {
        "chu_dau_tu": (("maChuDauTu", False), ("maSoThue", True)),
        "ke_hoach_lcnt": (("maKeHoach", False),),
        "goi_thau": (("maGoiThau", False),),
        "nha_thau": (("maNhaThau", False), ("maSoThue", True)),
        "chuyen_gia": (("soCCCD", True),),
        "hop_dong": (("soHopDong", False),),
    }
    for field_name, digits_only in business_key_fields.get(table_name, ()):
        if field_name in normalized and normalized.get(field_name) not in (None, ""):
            normalized[field_name] = normalize_business_identifier(
                normalized[field_name], digits_only=digits_only
            )
    if table_name == "chu_dau_tu" and normalized.get("tenChuDauTu"):
        normalized["tenChuDauTu"] = normalize_organization_name(normalized["tenChuDauTu"])
    elif table_name == "nha_thau" and normalized.get("tenNhaThau"):
        normalized["tenNhaThau"] = normalize_organization_name(normalized["tenNhaThau"])
    elif table_name == "goi_thau" and str(normalized.get("hinhThucLuaChon") or "").strip().lower() == "chào hàng cạnh tranh":
        normalized["yeuCauThamDinhHsmt"] = "Không"
        normalized["soBaoCaoThamDinhHsmt"] = ""
        normalized["ngayBaoCaoThamDinhHsmt"] = ""
        normalized["toThamDinh"] = []
        raw_metadata = normalized.get("danhGiaHsdtMetadata")
        try:
            metadata = json.loads(raw_metadata) if isinstance(raw_metadata, str) and raw_metadata.strip() else raw_metadata
        except (TypeError, ValueError, json.JSONDecodeError):
            metadata = None
        if isinstance(metadata, dict):
            if isinstance(metadata.get("technical"), dict):
                metadata["technical"].pop("soBctdKt", None)
                metadata["technical"].pop("ngayBctdKt", None)
            if isinstance(metadata.get("result"), dict):
                metadata["result"].pop("soBctdKetQua", None)
                metadata["result"].pop("ngayBctdKetQua", None)
            normalized["danhGiaHsdtMetadata"] = json.dumps(metadata, ensure_ascii=False) if isinstance(raw_metadata, str) else metadata
    return normalized


def map_db_to_json(table_name, row_dict):
    item = {}
    table_spec = SCHEMA_DINH_NGHIA[table_name]
    explicit_json_fields = set(table_spec.get("json_fields", []))
    for col in table_spec["columns"].keys():
        json_key = json_key_for_column(table_name, col)
        val = enum_label(table_name, col, row_dict.get(col))
        if (
            (table_name == "chu_dau_tu" and col == "dai_dien_cdt")
            or (table_name == "nha_thau" and col == "nguoi_dai_dien")
        ):
            val = normalize_person_name(val)
        elif table_name == "chu_dau_tu" and col == "ten_chu_dau_tu":
            val = normalize_organization_name(val)
        elif table_name == "nha_thau" and col == "ten_nha_thau":
            val = normalize_organization_name(val)
        if (table_name, col) in MONEY_COLUMNS:
            val = money_json_value(val)
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


def _child_money(value):
    parsed = parse_vnd_amount(value)
    return parsed if parsed is not None else 0


def save_child_payloads(cursor, table_name, item, organization_id, owner_type, sync_version, updated_at, actor_user_id=None):
    parent_id = clean_id(item.get("id"))
    if not parent_id:
        return
    if table_name == "ke_hoach_lcnt":
        _save_plan_children(cursor, parent_id, item, organization_id, owner_type, sync_version, updated_at)
    elif table_name == "goi_thau":
        _save_package_children(cursor, parent_id, item, organization_id, owner_type, sync_version, updated_at)
        _save_package_expert_relations(cursor, parent_id, item, organization_id, owner_type)
        _save_evaluation_rounds(cursor, parent_id, item, organization_id, owner_type, sync_version, updated_at, actor_user_id)
    elif table_name == "nha_thau":
        _save_member_children(cursor, "nha_thau_lien_danh_thanh_vien", "nha_thau_id", parent_id, item, organization_id, owner_type, sync_version, updated_at)
    elif table_name == "thong_tin_mo_thau":
        _save_member_children(cursor, "thong_tin_mo_thau_lien_danh_thanh_vien", "thong_tin_mo_thau_id", parent_id, item, organization_id, owner_type, sync_version, updated_at)
        _save_opening_participant_registry(cursor, parent_id, item, organization_id, owner_type)
        _save_bid_evaluation_result(cursor, parent_id, item, organization_id, owner_type, sync_version, updated_at, actor_user_id)


def _save_evaluation_rounds(cursor, package_id, item, organization_id, owner_type, sync_version, updated_at, actor_user_id):
    if "danhGiaHsdtMetadata" not in item:
        return
    metadata = parse_evaluation_metadata(item.get("danhGiaHsdtMetadata"), require_version=False)
    is_two_envelope = bool(metadata.get("is1G2T"))
    blocks = (
        [("technical", metadata.get("technical") or {}), ("financial", metadata.get("financial") or {})]
        if is_two_envelope else [("single", metadata)]
    )
    for order, (round_type, raw_block) in enumerate(blocks):
        block = raw_block if isinstance(raw_block, dict) else {}
        extension = {
            key: value for key, value in block.items()
            if key not in {"saved", "qualifiedSaved", "soBaoCao", "ngayBaoCao", "criteria", "schemaVersion"}
        }
        extension["schemaVersion"] = 1
        round_id = f"evaluation-round:{package_id}:{round_type}"
        saved = 1 if block.get("saved") else 0
        cursor.execute(
            """INSERT INTO vong_danh_gia (
                id, organization_id, owner_type, goi_thau_id, loai_vong, thu_tu,
                trang_thai, so_bao_cao, ngay_bao_cao, da_luu_danh_sach_dat,
                nguoi_cham_id, hoan_thanh_luc, extension_json, sync_version, updated_at
            ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
            ON CONFLICT(organization_id, goi_thau_id, loai_vong) DO UPDATE SET
                trang_thai=excluded.trang_thai, so_bao_cao=excluded.so_bao_cao,
                ngay_bao_cao=excluded.ngay_bao_cao,
                da_luu_danh_sach_dat=excluded.da_luu_danh_sach_dat,
                nguoi_cham_id=excluded.nguoi_cham_id,
                hoan_thanh_luc=excluded.hoan_thanh_luc,
                extension_json=excluded.extension_json,
                sync_version=excluded.sync_version, updated_at=excluded.updated_at""",
            (
                round_id, organization_id, owner_type, package_id, round_type, order,
                "completed" if saved else "draft", block.get("soBaoCao") or "",
                block.get("ngayBaoCao") or "", 1 if block.get("qualifiedSaved") else 0,
                actor_user_id if saved else None, updated_at if saved else None,
                dump_evaluation_metadata(extension), sync_version, updated_at,
            ),
        )
        cursor.execute(
            "DELETE FROM tieu_chi_danh_gia WHERE organization_id = ? AND vong_danh_gia_id = ?",
            (organization_id, round_id),
        )
        for criterion_order, criterion in enumerate(block.get("criteria") or []):
            if not isinstance(criterion, dict):
                continue
            code = str(criterion.get("code") or criterion.get("maTieuChi") or "").strip()
            name = str(criterion.get("name") or criterion.get("tenTieuChi") or "").strip()
            if not code or not name:
                continue
            criterion_extension = {
                key: value for key, value in criterion.items()
                if key not in {"id", "code", "maTieuChi", "name", "tenTieuChi", "maxScore", "diemToiDa", "weight", "trongSo"}
            }
            criterion_extension["schemaVersion"] = 1
            cursor.execute(
                """INSERT INTO tieu_chi_danh_gia (
                    id, organization_id, owner_type, vong_danh_gia_id, ma_tieu_chi,
                    ten_tieu_chi, diem_toi_da, trong_so, thu_tu, extension_json, updated_at
                ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)""",
                (
                    clean_id(criterion.get("id")) or f"evaluation-criterion:{round_id}:{code}",
                    organization_id, owner_type, round_id, code, name,
                    safe_float(criterion.get("maxScore", criterion.get("diemToiDa"))),
                    safe_float(criterion.get("weight", criterion.get("trongSo"))),
                    criterion_order, dump_evaluation_metadata(criterion_extension), updated_at,
                ),
            )


def _save_bid_evaluation_result(cursor, opening_id, item, organization_id, owner_type, sync_version, updated_at, actor_user_id):
    evaluation_keys = {
        "danhGiaHopLe", "danhGiaNangLuc", "danhGiaKyThuat", "danhGiaTaiChinh",
        "danhGiaKetLuan", "diemDanhGia", "lyDoTruot", "nguyenNhanKhongDatHopLe",
        "nguyenNhanKhongDatNangLuc", "nguyenNhanKhongDatKyThuat", "lamRoHopLe",
        "lamRoNangLuc", "lamRoKyThuat", "lamRoTaiChinh",
    }
    if not any(key in item for key in evaluation_keys):
        return
    exclusion_reason = next((
        str(item.get(key) or "").strip() for key in (
            "lyDoTruot", "nguyenNhanKhongDatHopLe", "nguyenNhanKhongDatNangLuc",
            "nguyenNhanKhongDatKyThuat"
        ) if str(item.get(key) or "").strip()
    ), "")
    cursor.execute(
        """INSERT INTO ket_qua_danh_gia_nha_thau (
            id, organization_id, owner_type, goi_thau_id, thong_tin_mo_thau_id,
            danh_gia_hop_le, danh_gia_nang_luc, danh_gia_ky_thuat,
            danh_gia_tai_chinh, danh_gia_ket_luan, diem, ly_do_loai,
            lam_ro_hop_le, lam_ro_nang_luc, lam_ro_ky_thuat, lam_ro_tai_chinh,
            nguyen_nhan_khong_dat_hop_le, nguyen_nhan_khong_dat_nang_luc,
            nguyen_nhan_khong_dat_ky_thuat,
            nguoi_cham_id, danh_gia_luc, sync_version, updated_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        ON CONFLICT(organization_id, thong_tin_mo_thau_id) DO UPDATE SET
            danh_gia_hop_le=excluded.danh_gia_hop_le,
            danh_gia_nang_luc=excluded.danh_gia_nang_luc,
            danh_gia_ky_thuat=excluded.danh_gia_ky_thuat,
            danh_gia_tai_chinh=excluded.danh_gia_tai_chinh,
            danh_gia_ket_luan=excluded.danh_gia_ket_luan,
            diem=excluded.diem, ly_do_loai=excluded.ly_do_loai,
            lam_ro_hop_le=excluded.lam_ro_hop_le,
            lam_ro_nang_luc=excluded.lam_ro_nang_luc,
            lam_ro_ky_thuat=excluded.lam_ro_ky_thuat,
            lam_ro_tai_chinh=excluded.lam_ro_tai_chinh,
            nguyen_nhan_khong_dat_hop_le=excluded.nguyen_nhan_khong_dat_hop_le,
            nguyen_nhan_khong_dat_nang_luc=excluded.nguyen_nhan_khong_dat_nang_luc,
            nguyen_nhan_khong_dat_ky_thuat=excluded.nguyen_nhan_khong_dat_ky_thuat,
            nguoi_cham_id=excluded.nguoi_cham_id, danh_gia_luc=excluded.danh_gia_luc,
            sync_version=excluded.sync_version, updated_at=excluded.updated_at""",
        (
            f"bid-evaluation:{opening_id}", organization_id, owner_type,
            clean_id(item.get("goiThauId")), opening_id,
            item.get("danhGiaHopLe") or "", item.get("danhGiaNangLuc") or "",
            item.get("danhGiaKyThuat") or "", item.get("danhGiaTaiChinh") or "",
            item.get("danhGiaKetLuan") or "", safe_float(item.get("diemDanhGia")),
            exclusion_reason, item.get("lamRoHopLe") or "", item.get("lamRoNangLuc") or "",
            item.get("lamRoKyThuat") or "", item.get("lamRoTaiChinh") or "",
            item.get("nguyenNhanKhongDatHopLe") or "",
            item.get("nguyenNhanKhongDatNangLuc") or "",
            item.get("nguyenNhanKhongDatKyThuat") or "",
            actor_user_id, updated_at, sync_version, updated_at,
        ),
    )


def _save_plan_children(cursor, parent_id, item, organization_id, owner_type, sync_version, updated_at):
    rows = []
    for camel_key, (kind, _snake_key) in PLAN_CHILD_LISTS.items():
        if not _has_child_key(item, camel_key):
            continue
        cursor.execute(
            "DELETE FROM ke_hoach_cong_viec WHERE organization_id = ? AND ke_hoach_id = ? AND loai = ?",
            (organization_id, parent_id, kind),
        )
        for index, row in enumerate(_parse_child_list(item.get(camel_key))):
            rows.append((
                _child_row_id(parent_id, kind, index, _first_value(row, "id")),
                organization_id,
                owner_type,
                parent_id,
                kind,
                _first_value(row, "tenCongViec", "ten_cong_viec", default=""),
                _child_money(_first_value(row, "giaTri", "gia_tri")),
                _first_value(row, "donViThucHien", "don_vi_thuc_hien", default=""),
                _first_value(row, "vanBanPheDuyet", "van_ban_phe_duyet", default=""),
                index,
                sync_version,
                updated_at,
            ))
    if rows:
        cursor.executemany("""
            INSERT INTO ke_hoach_cong_viec (
                id, organization_id, owner_type, ke_hoach_id, loai, ten_cong_viec, gia_tri,
                don_vi_thuc_hien, van_ban_phe_duyet, sort_order, sync_version, updated_at
            ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        """, rows)


def _save_package_children(cursor, parent_id, item, organization_id, owner_type, sync_version, updated_at):
    if _has_child_key(item, "phanLoList") or _has_child_key(item, "awardedPhanLoList"):
        lots = _parse_child_list(item.get("phanLoList")) if _has_child_key(item, "phanLoList") else _fetch_lots(cursor, parent_id, organization_id)
        awards = _parse_child_list(item.get("awardedPhanLoList")) if _has_child_key(item, "awardedPhanLoList") else _fetch_awards(cursor, parent_id, organization_id)
        _save_lots(cursor, parent_id, lots, awards, organization_id, owner_type, sync_version, updated_at)
    if _has_child_key(item, "tuyChonMuaThemList"):
        _save_options(cursor, parent_id, item.get("tuyChonMuaThemList"), organization_id, owner_type, sync_version, updated_at)
    if _has_child_key(item, "giaHanList"):
        _save_extensions(cursor, parent_id, item.get("giaHanList"), organization_id, owner_type, sync_version, updated_at)
    _save_clarifications(cursor, parent_id, item, organization_id, owner_type, sync_version, updated_at)
    _save_timeline_items(cursor, parent_id, item, organization_id, owner_type, sync_version, updated_at)


def _save_timeline_items(cursor, parent_id, item, organization_id, owner_type, sync_version, updated_at):
    if not _has_child_key(item, "timelineItems"):
        return
    cursor.execute(
        "DELETE FROM goi_thau_moc_tien_do WHERE organization_id = ? AND goi_thau_id = ?",
        (organization_id, parent_id),
    )
    rows = []
    for index, row in enumerate(_parse_child_list(item.get("timelineItems"))):
        rows.append((
            _child_row_id(parent_id, "timeline", index, _first_value(row, "id")),
            organization_id,
            owner_type,
            parent_id,
            str(_first_value(row, "maNhom", "ma_nhom", default="") or "").strip(),
            str(_first_value(row, "tenNhom", "ten_nhom", default="") or "").strip(),
            str(_first_value(row, "maMoc", "ma_moc", default="") or "").strip(),
            str(_first_value(row, "congViec", "cong_viec", default="") or "").strip(),
            str(_first_value(row, "donViBanHanh", "don_vi_ban_hanh", default="") or "").strip(),
            str(_first_value(row, "soVanBan", "so_van_ban", default="") or "").strip(),
            _first_value(row, "ngayDuKien", "ngay_du_kien") or None,
            _first_value(row, "ngayThucTe", "ngay_thuc_te") or None,
            str(_first_value(row, "ghiChu", "ghi_chu", default="") or "").strip(),
            str(_first_value(row, "sourceKey", "source_key", default="") or "").strip(),
            str(_first_value(row, "sourceMode", "source_mode", default="MANUAL") or "MANUAL").upper(),
            1 if _first_value(row, "isOptional", "is_optional", default=False) in (True, 1, "1") else 0,
            str(_first_value(row, "trangThai", "trang_thai", default="PENDING") or "PENDING").upper(),
            int(_first_value(row, "sortOrder", "sort_order", default=index) or 0),
            int(_first_value(row, "templateVersion", "template_version", default=1) or 1),
            sync_version,
            updated_at,
        ))
    if rows:
        cursor.executemany(
            """INSERT INTO goi_thau_moc_tien_do (
                   id, organization_id, owner_type, goi_thau_id, ma_nhom, ten_nhom,
                   ma_moc, cong_viec, don_vi_ban_hanh, so_van_ban, ngay_du_kien,
                   ngay_thuc_te, ghi_chu, source_key, source_mode, is_optional,
                   trang_thai, sort_order, template_version, sync_version, updated_at
               ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)""",
            rows,
        )


def _save_package_expert_relations(cursor, parent_id, item, organization_id, owner_type):
    relation_specs = [
        ("toChuyenGia", "chuyen_gia"),
        ("toThamDinh", "tham_dinh"),
    ]
    for payload_key, relation_type in relation_specs:
        if not _has_child_key(item, payload_key):
            continue
        cursor.execute(
            "DELETE FROM goi_thau_chuyen_gia WHERE organization_id = ? AND goi_thau_id = ? AND loai = ?",
            (organization_id, parent_id, relation_type),
        )
        rows = []
        for row in _parse_child_list(item.get(payload_key)):
            expert_id = clean_id(_first_value(row, "chuyenGiaId", "chuyen_gia_id", "id"))
            if not expert_id:
                continue
            cursor.execute(
                "SELECT 1 FROM chuyen_gia WHERE organization_id = ? AND id = ? LIMIT 1",
                (organization_id, expert_id),
            )
            if not cursor.fetchone():
                raise ValueError(f"Chuyen gia {expert_id} khong thuoc owner hien tai.")
            rows.append((
                organization_id,
                owner_type,
                parent_id,
                expert_id,
                relation_type,
                _first_value(row, "chucVu", "chuc_vu", default="Tổ viên") or "Tổ viên",
                _first_value(row, "congViec", "cong_viec", default="") or "",
            ))
        if rows:
            cursor.executemany("""
                INSERT INTO goi_thau_chuyen_gia (
                    organization_id, owner_type, goi_thau_id, chuyen_gia_id, loai, chuc_vu, cong_viec
                ) VALUES (?, ?, ?, ?, ?, ?, ?)
                ON CONFLICT (organization_id, goi_thau_id, chuyen_gia_id, loai)
                DO UPDATE SET owner_type = EXCLUDED.owner_type,
                              chuc_vu = EXCLUDED.chuc_vu,
                              cong_viec = EXCLUDED.cong_viec,
                              updated_at = CURRENT_TIMESTAMP
            """, rows)


def _lot_match_key(row):
    return str(_first_value(row, "maPhanLo", "ma_phan_lo", "tenPhanLo", "ten_phan_lo", default="")).strip().lower()


def _save_lots(cursor, parent_id, lots, awards, organization_id, owner_type, sync_version, updated_at):
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

    cursor.execute("DELETE FROM goi_thau_phan_lo WHERE organization_id = ? AND goi_thau_id = ?", (organization_id, parent_id))
    rows = []
    for index, row in enumerate(ordered):
        rows.append((
            _child_row_id(parent_id, "lot", index, _first_value(row, "id")),
            organization_id,
            owner_type,
            parent_id,
            _first_value(row, "maPhanLo", "ma_phan_lo", default=""),
            _first_value(row, "tenPhanLo", "ten_phan_lo", default=""),
            _child_money(_first_value(row, "giaTriPhanLo", "gia_tri_phan_lo")),
            _child_money(_first_value(row, "baoDamDuThau", "bao_dam_du_thau")),
            _first_value(row, "thoiGianThucHien", "thoi_gian_thuc_hien", default=""),
            clean_id(_first_value(row, "nhaThauTrungThauId", "nha_thau_trung_thau_id")),
            _child_money(_first_value(row, "giaTrungThau", "gia_trung_thau")),
            _first_value(row, "thoiGianGoiThau", "thoi_gian_goi_thau", default=""),
            _first_value(row, "thoiGianHopDong", "thoi_gian_hop_dong", default=""),
            index,
            sync_version,
            updated_at,
        ))
    if rows:
        cursor.executemany("""
            INSERT INTO goi_thau_phan_lo (
                id, organization_id, owner_type, goi_thau_id, ma_phan_lo, ten_phan_lo,
                gia_tri_phan_lo, bao_dam_du_thau, thoi_gian_thuc_hien,
                nha_thau_trung_thau_id, gia_trung_thau, thoi_gian_goi_thau,
                thoi_gian_hop_dong, sort_order, sync_version, updated_at
            ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        """, rows)


def _save_options(cursor, parent_id, value, organization_id, owner_type, sync_version, updated_at):
    cursor.execute("DELETE FROM goi_thau_tuy_chon_mua_them WHERE organization_id = ? AND goi_thau_id = ?", (organization_id, parent_id))
    rows = []
    for index, row in enumerate(_parse_child_list(value)):
        rows.append((
            _child_row_id(parent_id, "option", index, _first_value(row, "id")),
            organization_id,
            owner_type,
            parent_id,
            _first_value(row, "hangMuc", "hang_muc", default=""),
            _first_value(row, "donVi", "don_vi", default=""),
            _child_number(_first_value(row, "soLuong", "so_luong")),
            _child_number(_first_value(row, "tyLe", "ty_le")),
            _child_money(_first_value(row, "giaTriUocTinh", "gia_tri_uoc_tinh")),
            index,
            sync_version,
            updated_at,
        ))
    if rows:
        cursor.executemany("""
            INSERT INTO goi_thau_tuy_chon_mua_them (
                id, organization_id, owner_type, goi_thau_id, hang_muc, don_vi, so_luong,
                ty_le, gia_tri_uoc_tinh, sort_order, sync_version, updated_at
            ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        """, rows)


def _save_extensions(cursor, parent_id, value, organization_id, owner_type, sync_version, updated_at):
    cursor.execute("DELETE FROM goi_thau_gia_han WHERE organization_id = ? AND goi_thau_id = ?", (organization_id, parent_id))
    rows = []
    items = _dedupe_child_items(
        _parse_child_list(value),
        lambda row: f"{_norm_child_key(_first_value(row, 'thoiGianDongThau', 'thoi_gian_dong_thau'))}|{_norm_child_key(_first_value(row, 'lyDoGiaHan', 'ly_do_gia_han'))}"
    )
    for index, row in enumerate(items):
        rows.append((
            _child_row_id(parent_id, "extend", index, _first_value(row, "id")),
            organization_id,
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
                id, organization_id, owner_type, goi_thau_id, thoi_gian_dong_thau,
                ly_do_gia_han, sort_order, sync_version, updated_at
            ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
        """, rows)


def _save_clarifications(cursor, parent_id, item, organization_id, owner_type, sync_version, updated_at):
    mapping = [
        ("yeuCauLamRoList", "yeu_cau", "request", "thoiGianYeuCau", "noiDungYeuCau"),
        ("traLoiLamRoList", "tra_loi", "reply", "thoiGianTraLoi", "noiDungTraLoi"),
    ]
    rows = []
    for key, kind, prefix, time_key, content_key in mapping:
        if not _has_child_key(item, key):
            continue
        cursor.execute(
            "DELETE FROM goi_thau_lam_ro WHERE organization_id = ? AND goi_thau_id = ? AND loai = ?",
            (organization_id, parent_id, kind),
        )
        items = _dedupe_child_items(
            _parse_child_list(item.get(key)),
            lambda row, tk=time_key, ck=content_key: f"{_norm_child_key(_first_value(row, tk))}|{_norm_child_key(_first_value(row, ck))}"
        )
        for index, row in enumerate(items):
            rows.append((
                _child_row_id(parent_id, prefix, index, _first_value(row, "id")),
                organization_id,
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
                id, organization_id, owner_type, goi_thau_id, loai, thoi_gian,
                noi_dung, sort_order, sync_version, updated_at
            ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        """, rows)


def _save_member_children(cursor, child_table, parent_col, parent_id, item, organization_id, owner_type, sync_version, updated_at):
    if not _has_child_key(item, CHILD_MEMBER_KEY):
        return
    cursor.execute(f"DELETE FROM {child_table} WHERE organization_id = ? AND {parent_col} = ?", (organization_id, parent_id))
    rows = []
    for index, row in enumerate(_parse_child_list(item.get(CHILD_MEMBER_KEY))):
        rows.append((
            _child_row_id(parent_id, "member", index, _first_value(row, "id")),
            organization_id,
            owner_type,
            parent_id,
            clean_id(_first_value(row, "thanhVienNhaThauId", "thanh_vien_nha_thau_id", "nhaThauId")),
            _first_value(row, "tenNhaThau", "ten_nha_thau", default=""),
            _first_value(row, "maNhaThau", "ma_nha_thau", default=""),
            _first_value(row, "maSoThue", "ma_so_thue", default=""),
            _first_value(row, "vaiTro", "vai_tro", default=""),
            normalize_person_name(_first_value(row, "nguoiDaiDien", "nguoi_dai_dien", default="")),
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
                id, organization_id, owner_type, {parent_col}, thanh_vien_nha_thau_id,
                ten_nha_thau, ma_nha_thau, ma_so_thue,
                vai_tro, nguoi_dai_dien, danh_xung, so_dien_thoai, email, dia_chi, dia_chi_goc,
                so_tai_khoan, noi_mo_tai_khoan, ma_ngan_hang, sort_order,
                sync_version, updated_at
            ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        """, rows)


def _save_opening_participant_registry(cursor, opening_id, item, organization_id, owner_type):
    """Materialize bidder identities so the database enforces scope uniqueness."""
    cursor.execute(
        "DELETE FROM nha_thau_tham_du_mo_thau WHERE organization_id = ? AND thong_tin_mo_thau_id = ?",
        (organization_id, opening_id),
    )
    stored_bid = cursor.execute(
        """SELECT goi_thau_id, nha_thau_id, ma_phan_lo, loai_nha_thau
           FROM thong_tin_mo_thau
           WHERE organization_id = ? AND id = ?""",
        (organization_id, opening_id),
    ).fetchone()
    if not stored_bid:
        return
    is_joint_venture = str(stored_bid[3] or "").strip().casefold() == "liên danh"
    if is_joint_venture and not _has_child_key(item, CHILD_MEMBER_KEY):
        member_values = [
            {"thanhVienNhaThauId": row[0]}
            for row in cursor.execute(
                """SELECT thanh_vien_nha_thau_id
                   FROM thong_tin_mo_thau_lien_danh_thanh_vien
                   WHERE organization_id = ? AND thong_tin_mo_thau_id = ?
                   ORDER BY sort_order, id""",
                (organization_id, opening_id),
            ).fetchall()
        ]
    else:
        member_values = _parse_child_list(item.get(CHILD_MEMBER_KEY))
    participant_ids = (
        [
            clean_id(_first_value(member, "thanhVienNhaThauId", "thanh_vien_nha_thau_id", "nhaThauId"))
            for member in member_values
        ]
        if is_joint_venture
        else [clean_id(stored_bid[1])]
    )
    participant_ids = list(dict.fromkeys(value for value in participant_ids if value))
    if not participant_ids:
        return
    placeholders = ", ".join("?" for _ in participant_ids)
    roots = {
        str(row[0]): str(row[1])
        for row in cursor.execute(
            f"""SELECT id, COALESCE(NULLIF(id_goc, ''), id)
                FROM nha_thau
                WHERE organization_id = ? AND id IN ({placeholders})""",
            (organization_id, *participant_ids),
        ).fetchall()
    }
    package_id = clean_id(stored_bid[0])
    lot_scope = " ".join(str(stored_bid[2] or "").strip().casefold().split()) or "__PACKAGE__"
    rows = []
    for participant_id in participant_ids:
        root_id = roots.get(participant_id)
        if not root_id:
            continue
        rows.append((
            f"opening-participant:{opening_id}:{root_id}",
            organization_id,
            owner_type,
            opening_id,
            package_id,
            lot_scope,
            root_id,
            participant_id,
        ))
    if rows:
        cursor.executemany(
            """INSERT INTO nha_thau_tham_du_mo_thau (
                   id, organization_id, owner_type, thong_tin_mo_thau_id,
                   goi_thau_id, lot_scope, nha_thau_goc_id, nha_thau_phien_ban_id
               ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)""",
            rows,
        )


def attach_child_rows(cursor, table_name, item, organization_id=None, naming="camel"):
    attach_child_rows_to_items(cursor, table_name, [item], organization_id=organization_id, naming=naming)
    return item


def attach_child_rows_to_items(cursor, table_name, items, organization_id=None, naming="camel"):
    if not items:
        return items
    parent_ids = [clean_id(item.get("id")) for item in items if isinstance(item, dict) and item.get("id")]
    parent_ids = [parent_id for parent_id in parent_ids if parent_id]
    if not parent_ids:
        return items

    by_id = {clean_id(item.get("id")): item for item in items if isinstance(item, dict)}
    if table_name == "ke_hoach_lcnt":
        _attach_plan_children(cursor, by_id, parent_ids, organization_id, naming)
    elif table_name == "goi_thau":
        _attach_package_children(cursor, by_id, parent_ids, organization_id, naming)
    elif table_name == "nha_thau":
        _attach_members(cursor, by_id, parent_ids, "nha_thau_lien_danh_thanh_vien", "nha_thau_id", organization_id, naming)
    elif table_name == "thong_tin_mo_thau":
        _attach_members(cursor, by_id, parent_ids, "thong_tin_mo_thau_lien_danh_thanh_vien", "thong_tin_mo_thau_id", organization_id, naming)
        _attach_bid_evaluation_results(cursor, by_id, parent_ids, organization_id, naming)
        _enrich_opening_bid_contractor_versions(cursor, by_id, organization_id, naming)
    return items


def fetch_package_lot_codes(cursor, goi_thau_id, organization_id):
    cursor.execute("""
        SELECT ma_phan_lo
        FROM goi_thau_phan_lo
        WHERE goi_thau_id = ? AND organization_id = ? AND COALESCE(ma_phan_lo, '') != ''
        ORDER BY sort_order, id
    """, (goi_thau_id, organization_id))
    return [row[0] for row in cursor.fetchall()]


def _select_children(cursor, table, parent_col, parent_ids, organization_id=None, extra_order="sort_order, id"):
    placeholders = ", ".join(["?"] * len(parent_ids))
    params = list(parent_ids)
    owner_filter = ""
    if organization_id is not None:
        owner_filter = " AND organization_id = ?"
        params.append(organization_id)
    cursor.execute(
        f"SELECT * FROM {table} WHERE {parent_col} IN ({placeholders}){owner_filter} ORDER BY {parent_col}, {extra_order}",
        params,
    )
    return [dict(row) for row in cursor.fetchall()]


def _table_exists(cursor, table_name):
    return cursor.execute(
        """SELECT 1 FROM information_schema.tables
           WHERE table_schema = current_schema() AND table_name = ?""",
        (table_name,),
    ).fetchone() is not None


def _attach_plan_children(cursor, by_id, parent_ids, organization_id, naming):
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
    for row in _select_children(cursor, "ke_hoach_cong_viec", "ke_hoach_id", parent_ids, organization_id):
        item = by_id.get(row.get("ke_hoach_id"))
        key = kind_to_key.get(row.get("loai"))
        if item and key:
            item[key].append(_format_plan_child(row, naming))


def _attach_package_children(cursor, by_id, parent_ids, organization_id, naming):
    defaults = {
        "camel": ["phanLoList", "awardedPhanLoList", "tuyChonMuaThemList", "giaHanList", "yeuCauLamRoList", "traLoiLamRoList", "timelineItems"],
        "snake": ["phan_lo_list", "awarded_phan_lo_list", "tuy_chon_mua_them_list", "gia_han_list", "yeu_cau_lam_ro_list", "tra_loi_lam_ro_list", "timeline_items"],
    }[naming]
    for item in by_id.values():
        item.update({key: [] for key in defaults})

    for row in _select_children(cursor, "goi_thau_phan_lo", "goi_thau_id", parent_ids, organization_id):
        item = by_id.get(row.get("goi_thau_id"))
        if not item:
            continue
        item["phanLoList" if naming == "camel" else "phan_lo_list"].append(_format_lot_child(row, naming))
        if _has_lot_award(row):
            item["awardedPhanLoList" if naming == "camel" else "awarded_phan_lo_list"].append(_format_award_child(row, naming))

    for row in _select_children(cursor, "goi_thau_tuy_chon_mua_them", "goi_thau_id", parent_ids, organization_id):
        item = by_id.get(row.get("goi_thau_id"))
        if item:
            item["tuyChonMuaThemList" if naming == "camel" else "tuy_chon_mua_them_list"].append(_format_option_child(row, naming))

    for row in _select_children(cursor, "goi_thau_gia_han", "goi_thau_id", parent_ids, organization_id):
        item = by_id.get(row.get("goi_thau_id"))
        if item:
            item["giaHanList" if naming == "camel" else "gia_han_list"].append(_format_extension_child(row, naming))

    for row in _select_children(cursor, "goi_thau_lam_ro", "goi_thau_id", parent_ids, organization_id):
        item = by_id.get(row.get("goi_thau_id"))
        if not item:
            continue
        if row.get("loai") == "yeu_cau":
            item["yeuCauLamRoList" if naming == "camel" else "yeu_cau_lam_ro_list"].append(_format_clarification_child(row, naming, True))
        elif row.get("loai") == "tra_loi":
            item["traLoiLamRoList" if naming == "camel" else "tra_loi_lam_ro_list"].append(_format_clarification_child(row, naming, False))
    if _table_exists(cursor, "goi_thau_moc_tien_do"):
        for row in _select_children(cursor, "goi_thau_moc_tien_do", "goi_thau_id", parent_ids, organization_id):
            item = by_id.get(row.get("goi_thau_id"))
            if item:
                item["timelineItems" if naming == "camel" else "timeline_items"].append(
                    _format_timeline_child(row, naming)
                )
    _attach_evaluation_rounds(cursor, by_id, parent_ids, organization_id, naming)


def _attach_evaluation_rounds(cursor, by_id, parent_ids, organization_id, naming):
    metadata_key = "danhGiaHsdtMetadata" if naming == "camel" else "danh_gia_hsdt_metadata"
    criteria_by_round = {}
    rounds = _select_children(
        cursor, "vong_danh_gia", "goi_thau_id", parent_ids, organization_id,
        extra_order="thu_tu, id",
    )
    round_ids = [row["id"] for row in rounds]
    if round_ids:
        for criterion in _select_children(
            cursor, "tieu_chi_danh_gia", "vong_danh_gia_id", round_ids, organization_id,
            extra_order="thu_tu, id",
        ):
            criteria_by_round.setdefault(criterion["vong_danh_gia_id"], []).append({
                "id": criterion["id"],
                "code": criterion["ma_tieu_chi"],
                "name": criterion["ten_tieu_chi"],
                "maxScore": criterion["diem_toi_da"],
                "weight": criterion["trong_so"],
            })
    rounds_by_package = {}
    for row in rounds:
        rounds_by_package.setdefault(row["goi_thau_id"], []).append(row)
    for package_id, item in by_id.items():
        metadata = parse_evaluation_metadata(item.get(metadata_key), require_version=False)
        package_rounds = rounds_by_package.get(package_id, [])
        if any(row["loai_vong"] in {"technical", "financial"} for row in package_rounds):
            metadata["is1G2T"] = True
        for row in package_rounds:
            try:
                block = parse_evaluation_metadata(row.get("extension_json"), require_version=True)
            except ValueError:
                block = {"schemaVersion": 1}
            block.update({
                "saved": row.get("trang_thai") in {"completed", "approved"},
                "qualifiedSaved": bool(row.get("da_luu_danh_sach_dat")),
                "soBaoCao": row.get("so_bao_cao") or "",
                "ngayBaoCao": row.get("ngay_bao_cao") or "",
                "criteria": criteria_by_round.get(row["id"], []),
            })
            if row["loai_vong"] == "single":
                metadata.update(block)
            else:
                metadata[row["loai_vong"]] = block
        item[metadata_key] = dump_evaluation_metadata(metadata)


def _attach_bid_evaluation_results(cursor, by_id, parent_ids, organization_id, naming):
    rows = _select_children(
        cursor, "ket_qua_danh_gia_nha_thau", "thong_tin_mo_thau_id",
        parent_ids, organization_id, extra_order="id",
    )
    field_pairs = [
        ("danh_gia_hop_le", "danhGiaHopLe"),
        ("danh_gia_nang_luc", "danhGiaNangLuc"),
        ("danh_gia_ky_thuat", "danhGiaKyThuat"),
        ("danh_gia_tai_chinh", "danhGiaTaiChinh"),
        ("danh_gia_ket_luan", "danhGiaKetLuan"),
        ("diem", "diemDanhGia"),
        ("ly_do_loai", "lyDoTruot"),
        ("lam_ro_hop_le", "lamRoHopLe"),
        ("lam_ro_nang_luc", "lamRoNangLuc"),
        ("lam_ro_ky_thuat", "lamRoKyThuat"),
        ("lam_ro_tai_chinh", "lamRoTaiChinh"),
        ("nguyen_nhan_khong_dat_hop_le", "nguyenNhanKhongDatHopLe"),
        ("nguyen_nhan_khong_dat_nang_luc", "nguyenNhanKhongDatNangLuc"),
        ("nguyen_nhan_khong_dat_ky_thuat", "nguyenNhanKhongDatKyThuat"),
    ]
    for row in rows:
        item = by_id.get(row["thong_tin_mo_thau_id"])
        if not item:
            continue
        for snake_key, camel_key in field_pairs:
            item[camel_key if naming == "camel" else snake_key] = row.get(snake_key)


def _attach_members(cursor, by_id, parent_ids, child_table, parent_col, organization_id, naming):
    key = "thanhVienLienDanh" if naming == "camel" else "thanh_vien_lien_danh"
    for item in by_id.values():
        item[key] = []
    for row in _select_children(cursor, child_table, parent_col, parent_ids, organization_id):
        item = by_id.get(row.get(parent_col))
        if item:
            item[key].append(_format_member_child(row, naming))


def _enrich_opening_bid_contractor_versions(cursor, by_id, organization_id, naming):
    member_key = "thanhVienLienDanh" if naming == "camel" else "thanh_vien_lien_danh"
    bid_contractor_key = "nhaThauId" if naming == "camel" else "nha_thau_id"
    bid_type_key = "loaiNhaThau" if naming == "camel" else "loai_nha_thau"
    bid_name_key = "tenNhaThau" if naming == "camel" else "ten_nha_thau"
    member_contractor_key = "thanhVienNhaThauId" if naming == "camel" else "thanh_vien_nha_thau_id"
    contractor_ids = set()
    for bid in by_id.values():
        contractor_id = clean_id(bid.get(bid_contractor_key))
        if contractor_id:
            contractor_ids.add(contractor_id)
        for member in bid.get(member_key) or []:
            member_id = clean_id(member.get(member_contractor_key))
            if member_id:
                contractor_ids.add(member_id)
    if not contractor_ids:
        return

    placeholders = ", ".join(["?"] * len(contractor_ids))
    params = list(contractor_ids)
    owner_filter = ""
    if organization_id is not None:
        owner_filter = " AND organization_id = ?"
        params.append(organization_id)
    cursor.execute(
        f"SELECT * FROM nha_thau WHERE id IN ({placeholders}){owner_filter}",
        params,
    )
    contractors = {clean_id(row["id"]): dict(row) for row in cursor.fetchall()}

    member_fields = [
        ("ten_nha_thau", "tenNhaThau"),
        ("ma_nha_thau", "maNhaThau"),
        ("ma_so_thue", "maSoThue"),
        ("nguoi_dai_dien", "nguoiDaiDien"),
        ("danh_xung", "danhXung"),
        ("so_dien_thoai", "soDienThoai"),
        ("email", "email"),
        ("dia_chi", "diaChi"),
        ("dia_chi_goc", "diaChiGoc"),
        ("so_tai_khoan", "soTaiKhoan"),
        ("noi_mo_tai_khoan", "noiMoTaiKhoan"),
        ("ma_ngan_hang", "maNganHang"),
    ]
    for bid in by_id.values():
        contractor = contractors.get(clean_id(bid.get(bid_contractor_key)))
        is_joint_venture = str(bid.get(bid_type_key) or "").strip().lower() == "liên danh"
        if contractor and not is_joint_venture:
            bid[bid_name_key] = normalize_organization_name(contractor.get("ten_nha_thau") or "")
        for member in bid.get(member_key) or []:
            member_contractor = contractors.get(clean_id(member.get(member_contractor_key)))
            if not member_contractor:
                continue
            for snake_key, camel_key in member_fields:
                target_key = snake_key if naming == "snake" else camel_key
                value = member_contractor.get(snake_key)
                if snake_key == "ten_nha_thau":
                    value = normalize_organization_name(value)
                elif snake_key == "nguoi_dai_dien":
                    value = normalize_person_name(value)
                member[target_key] = value or ""


def _fetch_lots(cursor, parent_id, organization_id):
    return [_format_lot_child(row, "camel") for row in _select_children(cursor, "goi_thau_phan_lo", "goi_thau_id", [parent_id], organization_id)]


def _fetch_awards(cursor, parent_id, organization_id):
    return [
        _format_award_child(row, "camel")
        for row in _select_children(cursor, "goi_thau_phan_lo", "goi_thau_id", [parent_id], organization_id)
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


def _format_timeline_child(row, naming):
    fields = [
        ("id", "id"),
        ("ma_nhom", "maNhom"),
        ("ten_nhom", "tenNhom"),
        ("ma_moc", "maMoc"),
        ("cong_viec", "congViec"),
        ("don_vi_ban_hanh", "donViBanHanh"),
        ("so_van_ban", "soVanBan"),
        ("ngay_du_kien", "ngayDuKien"),
        ("ngay_thuc_te", "ngayThucTe"),
        ("ghi_chu", "ghiChu"),
        ("source_key", "sourceKey"),
        ("source_mode", "sourceMode"),
        ("is_optional", "isOptional"),
        ("trang_thai", "trangThai"),
        ("sort_order", "sortOrder"),
        ("template_version", "templateVersion"),
    ]
    shaped = {}
    for snake_key, camel_key in fields:
        key = snake_key if naming == "snake" else camel_key
        value = row.get(snake_key)
        if snake_key == "is_optional":
            shaped[key] = bool(value)
        elif snake_key in {"sort_order", "template_version"}:
            shaped[key] = int(value or 0)
        else:
            shaped[key] = value or ""
    return shaped


def _format_member_child(row, naming):
    shaped = _shape_child(
        row,
        naming,
        [
            ("id", "id"),
            ("thanh_vien_nha_thau_id", "thanhVienNhaThauId"),
            ("ten_nha_thau", "tenNhaThau"),
            ("ma_nha_thau", "maNhaThau"),
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
    representative_key = "nguoi_dai_dien" if naming == "snake" else "nguoiDaiDien"
    shaped[representative_key] = normalize_person_name(shaped.get(representative_key))
    return shaped


def _shape_child(row, naming, fields):
    shaped = {}
    for snake_key, camel_key in fields:
        key = snake_key if naming == "snake" else camel_key
        value = row.get(snake_key)
        if snake_key == "id":
            shaped[key] = value
        elif snake_key.startswith("gia_") or snake_key in {"bao_dam_du_thau"}:
            shaped[key] = money_json_value(value or 0)
        elif snake_key in {"so_luong", "ty_le"}:
            shaped[key] = value or 0
        else:
            shaped[key] = value or ""
    return shaped
