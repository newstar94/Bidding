"""Pure read-side projection for sync child rows.

The sync mapper retains its long-standing private aliases, while this module
owns conversion from database-shaped child rows to camelCase or snake_case
payloads.  No persistence, query, version, or authorization policy lives
here, so callers can verify the serialization contract independently.
"""

from __future__ import annotations

from collections.abc import Iterable, Mapping

from backend.shared.numeric_utils import money_json_value
from backend.shared.text_utils import normalize_person_name
from backend.domain.plan_basis_parser import derive_ten_can_cu


def shape_child(
    row: Mapping[str, object],
    naming: str,
    fields: Iterable[tuple[str, str]],
) -> dict[str, object]:
    shaped: dict[str, object] = {}
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


def format_plan_child(row: Mapping[str, object], naming: str) -> dict[str, object]:
    return shape_child(
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


def format_plan_basis_child(
    row: Mapping[str, object],
    naming: str,
) -> dict[str, object]:
    """Project nullable parser fields without turning missing values into authority."""

    reasons = row.get("parse_reasons")
    if isinstance(reasons, str):
        try:
            import json

            parsed_reasons = json.loads(reasons)
            reasons = parsed_reasons if isinstance(parsed_reasons, list) else []
        except (TypeError, ValueError):
            reasons = []
    elif not isinstance(reasons, list):
        reasons = []
    values = {
        "id": row.get("id"),
        "id_goc": row.get("id_goc"),
        "noi_dung_goc": row.get("noi_dung_goc") or "",
        "ten_van_ban": row.get("ten_van_ban"),
        "so_van_ban": row.get("so_van_ban"),
        "ngay_ban_hanh": row.get("ngay_ban_hanh"),
        "don_vi_ban_hanh": row.get("don_vi_ban_hanh"),
        "trich_yeu": row.get("trich_yeu"),
        "parse_status": row.get("parse_status") or "UNPARSED",
        "parse_version": row.get("parse_version") or "",
        "parse_reasons": reasons,
        "sort_order": int(row.get("sort_order") or 0),
    }
    values["ten_can_cu"] = derive_ten_can_cu(
        values["ten_van_ban"], values["trich_yeu"]
    )
    if naming == "snake":
        return values
    return {
        "id": values["id"],
        "rootId": values["id_goc"],
        "noiDungGoc": values["noi_dung_goc"],
        "tenVanBan": values["ten_van_ban"],
        "soVanBan": values["so_van_ban"],
        "ngayBanHanh": values["ngay_ban_hanh"],
        "donViBanHanh": values["don_vi_ban_hanh"],
        "trichYeu": values["trich_yeu"],
        "tenCanCu": values["ten_can_cu"],
        "parseStatus": values["parse_status"],
        "parseVersion": values["parse_version"],
        "parseReasons": values["parse_reasons"],
        "sortOrder": values["sort_order"],
    }


def format_lot_child(row: Mapping[str, object], naming: str) -> dict[str, object]:
    return shape_child(
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


def format_award_child(row: Mapping[str, object], naming: str) -> dict[str, object]:
    return shape_child(
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


def format_option_child(row: Mapping[str, object], naming: str) -> dict[str, object]:
    return shape_child(
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


def format_extension_child(row: Mapping[str, object], naming: str) -> dict[str, object]:
    return shape_child(
        row,
        naming,
        [
            ("id", "id"),
            ("thoi_gian_dong_thau", "thoiGianDongThau"),
            ("ly_do_gia_han", "lyDoGiaHan"),
        ],
    )


def format_clarification_child(
    row: Mapping[str, object],
    naming: str,
    is_request: bool,
) -> dict[str, object]:
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


def format_timeline_child(row: Mapping[str, object], naming: str) -> dict[str, object]:
    fields = [
        ("id", "id"),
        ("milestone_key", "milestoneKey"),
        ("instance_key", "instanceKey"),
        ("source_entity_id", "sourceEntityId"),
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
    shaped: dict[str, object] = {}
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


def format_ehsmt_adjustment_child(
    row: Mapping[str, object],
    naming: str,
) -> dict[str, object]:
    return shape_child(
        row,
        naming,
        [
            ("id", "id"),
            ("sequence", "sequence"),
            ("reason", "reason"),
            ("submission_number", "submissionNumber"),
            ("submission_date", "submissionDate"),
            ("appraisal_report_number", "appraisalReportNumber"),
            ("appraisal_report_date", "appraisalReportDate"),
            ("approval_decision_number", "approvalDecisionNumber"),
            ("approval_decision_date", "approvalDecisionDate"),
            ("published_at", "publishedAt"),
            ("archived_at", "archivedAt"),
            ("row_version", "rowVersion"),
        ],
    )


def format_member_child(row: Mapping[str, object], naming: str) -> dict[str, object]:
    shaped = shape_child(
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
            ("violation_status", "violationStatus"),
            ("violation_bid_closing_at", "violationBidClosingAt"),
            ("violation_checked_at", "violationCheckedAt"),
        ],
    )
    representative_key = "nguoi_dai_dien" if naming == "snake" else "nguoiDaiDien"
    shaped[representative_key] = normalize_person_name(shaped.get(representative_key))
    return shaped
