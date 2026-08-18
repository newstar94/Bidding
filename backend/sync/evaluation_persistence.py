"""Persistence for normalized package and bidder evaluation data.

The sync mapper keeps compatibility aliases for legacy callers.  New code
should use the two persistence entry points exposed by this module.
"""

from backend.shared.date_utils import normalize_date_value
from backend.shared.numeric_utils import parse_vnd_amount
from backend.shared.text_utils import clean_id, safe_float
from backend.sync.evaluation_metadata import (
    dump_evaluation_metadata,
    parse_evaluation_metadata,
)


def _optional_boolean(value):
    if value in (True, 1, "1", "true", "True"):
        return 1
    if value in (False, 0, "0", "false", "False"):
        return 0
    return None


def save_evaluation_rounds(
    cursor,
    package_id,
    item,
    organization_id,
    owner_type,
    sync_version,
    updated_at,
):
    """Persist package evaluation rounds when metadata is present."""
    if "danhGiaHsdtMetadata" not in item:
        return
    metadata = parse_evaluation_metadata(
        item.get("danhGiaHsdtMetadata"),
        require_version=False,
    )
    is_two_envelope = bool(metadata.get("is1G2T"))
    if is_two_envelope:
        technical_block = dict(metadata.get("technical") or {})
        if isinstance(metadata.get("resultEdit"), dict):
            technical_block["resultEdit"] = metadata["resultEdit"]
        blocks = [
            ("technical", technical_block),
            ("financial", metadata.get("financial") or {}),
        ]
    else:
        blocks = [("single", metadata)]
    for order, (round_type, raw_block) in enumerate(blocks):
        block = raw_block if isinstance(raw_block, dict) else {}
        extension = {
            key: value for key, value in block.items()
            if key not in {
                "saved",
                "qualifiedSaved",
                "soBaoCao",
                "ngayBaoCao",
                "criteria",
                "schemaVersion",
            }
        }
        extension["schemaVersion"] = 1
        round_id = f"evaluation-round:{package_id}:{round_type}"
        saved = 1 if block.get("saved") else 0
        cursor.execute(
            """INSERT INTO vong_danh_gia (
                id, organization_id, owner_type, goi_thau_id, loai_vong, thu_tu,
                trang_thai, so_bao_cao, ngay_bao_cao, da_luu_danh_sach_dat,
                hoan_thanh_luc, extension_json, sync_version, updated_at
            ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
            ON CONFLICT(organization_id, goi_thau_id, loai_vong) DO UPDATE SET
                trang_thai=excluded.trang_thai, so_bao_cao=excluded.so_bao_cao,
                ngay_bao_cao=excluded.ngay_bao_cao,
                da_luu_danh_sach_dat=excluded.da_luu_danh_sach_dat,
                hoan_thanh_luc=excluded.hoan_thanh_luc,
                extension_json=excluded.extension_json,
                sync_version=excluded.sync_version, updated_at=excluded.updated_at""",
            (
                round_id,
                organization_id,
                owner_type,
                package_id,
                round_type,
                order,
                "completed" if saved else "draft",
                block.get("soBaoCao") or "",
                normalize_date_value(block.get("ngayBaoCao")),
                1 if block.get("qualifiedSaved") else 0,
                updated_at if saved else None,
                dump_evaluation_metadata(extension),
                sync_version,
                updated_at,
            ),
        )
        criteria_payload = block.get("criteria")
        if not isinstance(criteria_payload, list):
            # Legacy package metadata may not carry criteria at all. Keep the
            # normalized criteria (and their detailed child rows) untouched.
            continue
        existing_criteria = cursor.execute(
            """SELECT id, ma_tieu_chi FROM tieu_chi_danh_gia
               WHERE organization_id = ? AND vong_danh_gia_id = ?""",
            (organization_id, round_id),
        ).fetchall()
        existing_ids_by_code = {
            str(row.get("ma_tieu_chi") or "").strip(): clean_id(row.get("id"))
            for row in existing_criteria
            if row.get("ma_tieu_chi") and row.get("id")
        }
        retained_criterion_ids = []
        for criterion_order, criterion in enumerate(criteria_payload):
            if not isinstance(criterion, dict):
                continue
            code = str(
                criterion.get("code") or criterion.get("maTieuChi") or ""
            ).strip()
            name = str(
                criterion.get("name") or criterion.get("tenTieuChi") or ""
            ).strip()
            if not code or not name:
                continue
            criterion_id = (
                existing_ids_by_code.get(code)
                or clean_id(criterion.get("id"))
                or f"evaluation-criterion:{round_id}:{code}"
            )
            retained_criterion_ids.append(criterion_id)
            criterion_extension = {
                key: value for key, value in criterion.items()
                if key not in {
                    "id",
                    "code",
                    "maTieuChi",
                    "name",
                    "tenTieuChi",
                    "maxScore",
                    "diemToiDa",
                    "weight",
                    "trongSo",
                    "group",
                    "nhomDanhGia",
                    "resultType",
                    "loaiKetQua",
                    "required",
                    "batBuoc",
                    "parentCriterionId",
                    "tieuChiChaId",
                }
            }
            criterion_extension["schemaVersion"] = 1
            group = str(
                criterion.get("group")
                or criterion.get("nhomDanhGia")
                or "technical"
            )
            result_type = str(
                criterion.get("resultType")
                or criterion.get("loaiKetQua")
                or "pass_fail"
            )
            required = criterion.get("required", criterion.get("batBuoc", True))
            cursor.execute(
                """INSERT INTO tieu_chi_danh_gia (
                    id, organization_id, owner_type, vong_danh_gia_id, ma_tieu_chi,
                    ten_tieu_chi, diem_toi_da, trong_so, nhom_danh_gia,
                    loai_ket_qua, bat_buoc, tieu_chi_cha_id, thu_tu,
                    extension_json, updated_at
                ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
                ON CONFLICT(organization_id, vong_danh_gia_id, ma_tieu_chi)
                DO UPDATE SET owner_type=excluded.owner_type,
                    ten_tieu_chi=excluded.ten_tieu_chi,
                    diem_toi_da=excluded.diem_toi_da,
                    trong_so=excluded.trong_so,
                    nhom_danh_gia=excluded.nhom_danh_gia,
                    loai_ket_qua=excluded.loai_ket_qua,
                    bat_buoc=excluded.bat_buoc,
                    tieu_chi_cha_id=excluded.tieu_chi_cha_id,
                    thu_tu=excluded.thu_tu,
                    extension_json=excluded.extension_json,
                    updated_at=excluded.updated_at""",
                (
                    criterion_id,
                    organization_id,
                    owner_type,
                    round_id,
                    code,
                    name,
                    safe_float(
                        criterion.get("maxScore", criterion.get("diemToiDa"))
                    ),
                    safe_float(criterion.get("weight", criterion.get("trongSo"))),
                    group,
                    result_type,
                    1 if required not in (False, 0, "0") else 0,
                    clean_id(
                        criterion.get("parentCriterionId")
                        or criterion.get("tieuChiChaId")
                    ),
                    criterion_order,
                    dump_evaluation_metadata(criterion_extension),
                    updated_at,
                ),
            )
        delete_criteria_sql = (
            "DELETE FROM tieu_chi_danh_gia "
            "WHERE organization_id = ? AND vong_danh_gia_id = ?"
        )
        delete_criteria_params = [organization_id, round_id]
        if retained_criterion_ids:
            delete_criteria_sql += " AND id NOT IN ({})".format(
                ", ".join("?" for _ in retained_criterion_ids)
            )
            delete_criteria_params.extend(retained_criterion_ids)
        cursor.execute(delete_criteria_sql, tuple(delete_criteria_params))


def save_bid_evaluation_result(
    cursor,
    opening_id,
    item,
    organization_id,
    owner_type,
    sync_version,
    updated_at,
):
    """Upsert the normalized evaluation result for one opening record."""
    evaluation_keys = {
        "danhGiaHopLe",
        "danhGiaNangLuc",
        "danhGiaKyThuat",
        "danhGiaTaiChinh",
        "giaXepHang",
        "giaDeNghiTrungThau",
        "chapThuanGiaDeNghiTrungThauDuoi50",
        "danhGiaKetLuan",
        "diemDanhGia",
        "lyDoTruot",
        "nguyenNhanKhongDatHopLe",
        "nguyenNhanKhongDatNangLuc",
        "nguyenNhanKhongDatKyThuat",
        "lamRoHopLe",
        "lamRoNangLuc",
        "lamRoKyThuat",
        "lamRoTaiChinh",
    }
    if not any(key in item for key in evaluation_keys):
        return
    exclusion_reason_keys = (
        "lyDoTruot",
        "nguyenNhanKhongDatHopLe",
        "nguyenNhanKhongDatNangLuc",
        "nguyenNhanKhongDatKyThuat",
    )
    exclusion_reason = next(
        (
            str(item.get(key) or "").strip()
            for key in exclusion_reason_keys
            if str(item.get(key) or "").strip()
        ),
        "",
    )
    cursor.execute(
        """INSERT INTO ket_qua_danh_gia_nha_thau (
            id, organization_id, owner_type, goi_thau_id, thong_tin_mo_thau_id,
            danh_gia_hop_le, danh_gia_nang_luc, danh_gia_ky_thuat,
            danh_gia_tai_chinh, gia_xep_hang, gia_de_nghi_trung_thau,
            chap_thuan_gia_de_nghi_trung_thau_duoi_50,
            danh_gia_ket_luan, diem, ly_do_loai,
            lam_ro_hop_le, lam_ro_nang_luc, lam_ro_ky_thuat, lam_ro_tai_chinh,
            nguyen_nhan_khong_dat_hop_le, nguyen_nhan_khong_dat_nang_luc,
            nguyen_nhan_khong_dat_ky_thuat,
            danh_gia_luc, sync_version, updated_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        ON CONFLICT(organization_id, thong_tin_mo_thau_id) DO UPDATE SET
            danh_gia_hop_le=CASE WHEN ? THEN excluded.danh_gia_hop_le ELSE ket_qua_danh_gia_nha_thau.danh_gia_hop_le END,
            danh_gia_nang_luc=CASE WHEN ? THEN excluded.danh_gia_nang_luc ELSE ket_qua_danh_gia_nha_thau.danh_gia_nang_luc END,
            danh_gia_ky_thuat=CASE WHEN ? THEN excluded.danh_gia_ky_thuat ELSE ket_qua_danh_gia_nha_thau.danh_gia_ky_thuat END,
            danh_gia_tai_chinh=CASE WHEN ? THEN excluded.danh_gia_tai_chinh ELSE ket_qua_danh_gia_nha_thau.danh_gia_tai_chinh END,
            gia_xep_hang=CASE WHEN ? THEN excluded.gia_xep_hang ELSE ket_qua_danh_gia_nha_thau.gia_xep_hang END,
            gia_de_nghi_trung_thau=CASE WHEN ? THEN excluded.gia_de_nghi_trung_thau ELSE ket_qua_danh_gia_nha_thau.gia_de_nghi_trung_thau END,
            chap_thuan_gia_de_nghi_trung_thau_duoi_50=CASE WHEN ? THEN excluded.chap_thuan_gia_de_nghi_trung_thau_duoi_50 ELSE ket_qua_danh_gia_nha_thau.chap_thuan_gia_de_nghi_trung_thau_duoi_50 END,
            danh_gia_ket_luan=CASE WHEN ? THEN excluded.danh_gia_ket_luan ELSE ket_qua_danh_gia_nha_thau.danh_gia_ket_luan END,
            diem=CASE WHEN ? THEN excluded.diem ELSE ket_qua_danh_gia_nha_thau.diem END,
            ly_do_loai=CASE WHEN ? THEN excluded.ly_do_loai ELSE ket_qua_danh_gia_nha_thau.ly_do_loai END,
            lam_ro_hop_le=CASE WHEN ? THEN excluded.lam_ro_hop_le ELSE ket_qua_danh_gia_nha_thau.lam_ro_hop_le END,
            lam_ro_nang_luc=CASE WHEN ? THEN excluded.lam_ro_nang_luc ELSE ket_qua_danh_gia_nha_thau.lam_ro_nang_luc END,
            lam_ro_ky_thuat=CASE WHEN ? THEN excluded.lam_ro_ky_thuat ELSE ket_qua_danh_gia_nha_thau.lam_ro_ky_thuat END,
            lam_ro_tai_chinh=CASE WHEN ? THEN excluded.lam_ro_tai_chinh ELSE ket_qua_danh_gia_nha_thau.lam_ro_tai_chinh END,
            nguyen_nhan_khong_dat_hop_le=CASE WHEN ? THEN excluded.nguyen_nhan_khong_dat_hop_le ELSE ket_qua_danh_gia_nha_thau.nguyen_nhan_khong_dat_hop_le END,
            nguyen_nhan_khong_dat_nang_luc=CASE WHEN ? THEN excluded.nguyen_nhan_khong_dat_nang_luc ELSE ket_qua_danh_gia_nha_thau.nguyen_nhan_khong_dat_nang_luc END,
            nguyen_nhan_khong_dat_ky_thuat=CASE WHEN ? THEN excluded.nguyen_nhan_khong_dat_ky_thuat ELSE ket_qua_danh_gia_nha_thau.nguyen_nhan_khong_dat_ky_thuat END,
            danh_gia_luc=excluded.danh_gia_luc,
            sync_version=excluded.sync_version, updated_at=excluded.updated_at""",
        (
            f"bid-evaluation:{opening_id}",
            organization_id,
            owner_type,
            clean_id(item.get("goiThauId")),
            opening_id,
            item.get("danhGiaHopLe") or "",
            item.get("danhGiaNangLuc") or "",
            item.get("danhGiaKyThuat") or "",
            item.get("danhGiaTaiChinh") or "",
            parse_vnd_amount(item.get("giaXepHang")),
            parse_vnd_amount(item.get("giaDeNghiTrungThau")),
            _optional_boolean(item.get("chapThuanGiaDeNghiTrungThauDuoi50")),
            item.get("danhGiaKetLuan") or "",
            safe_float(item.get("diemDanhGia")),
            exclusion_reason,
            item.get("lamRoHopLe") or "",
            item.get("lamRoNangLuc") or "",
            item.get("lamRoKyThuat") or "",
            item.get("lamRoTaiChinh") or "",
            item.get("nguyenNhanKhongDatHopLe") or "",
            item.get("nguyenNhanKhongDatNangLuc") or "",
            item.get("nguyenNhanKhongDatKyThuat") or "",
            updated_at,
            sync_version,
            updated_at,
            "danhGiaHopLe" in item,
            "danhGiaNangLuc" in item,
            "danhGiaKyThuat" in item,
            "danhGiaTaiChinh" in item,
            "giaXepHang" in item,
            "giaDeNghiTrungThau" in item,
            "chapThuanGiaDeNghiTrungThauDuoi50" in item,
            "danhGiaKetLuan" in item,
            "diemDanhGia" in item,
            any(key in item for key in exclusion_reason_keys),
            "lamRoHopLe" in item,
            "lamRoNangLuc" in item,
            "lamRoKyThuat" in item,
            "lamRoTaiChinh" in item,
            "nguyenNhanKhongDatHopLe" in item,
            "nguyenNhanKhongDatNangLuc" in item,
            "nguyenNhanKhongDatKyThuat" in item,
        ),
    )
