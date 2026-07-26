"""Build a stable Word context for detailed bid-evaluation reports."""

from __future__ import annotations

import json
from typing import Any, Mapping


_GROUPS = {
    "validity": ("hop_le", "Hợp lệ"),
    "capacity": ("nang_luc", "Năng lực và kinh nghiệm"),
    "technical": ("ky_thuat", "Kỹ thuật"),
    "financial": ("tai_chinh", "Tài chính"),
}
_ROUND_LABELS = {
    "single": "Đánh giá một giai đoạn một túi hồ sơ",
    "technical": "Đánh giá kỹ thuật",
    "financial": "Đánh giá tài chính",
}
_ROUND_ORDER = {"single": 0, "technical": 1, "financial": 2}
_RESULT_LABELS = {
    "pending": "Chưa đánh giá",
    "pass": "Đạt",
    "fail": "Không đạt",
    "not_applicable": "Không áp dụng",
}


def _mapping(value: Any) -> dict[str, Any]:
    if isinstance(value, Mapping):
        return dict(value)
    if isinstance(value, str) and value.strip():
        try:
            parsed = json.loads(value)
        except (TypeError, ValueError, json.JSONDecodeError):
            return {}
        return dict(parsed) if isinstance(parsed, Mapping) else {}
    return {}


def _value(source: Mapping[str, Any], *keys: str, default=None):
    for key in keys:
        if key in source and source[key] is not None:
            return source[key]
    return default


def _group(value: Any) -> str:
    normalized = str(value or "technical").strip().lower().replace("-", "_")
    aliases = {
        "hop_le": "validity",
        "nang_luc": "capacity",
        "nang_luc_kinh_nghiem": "capacity",
        "ky_thuat": "technical",
        "tai_chinh": "financial",
    }
    return aliases.get(normalized, normalized if normalized in _GROUPS else "technical")


def _result(value: Any) -> str:
    normalized = str(value or "pending").strip().lower()
    return normalized if normalized in _RESULT_LABELS else "pending"


def _mark(result: str, expected: str) -> str:
    return "x" if result == expected else ""


def _criteria_for_round(metadata: Mapping[str, Any], round_type: str) -> list[dict]:
    block = metadata if round_type == "single" else _mapping(metadata.get(round_type))
    criteria = block.get("criteria") if isinstance(block, Mapping) else None
    return [dict(item) for item in (criteria or []) if isinstance(item, Mapping)]


def _build_row(
    bid: Mapping[str, Any],
    report: Mapping[str, Any],
    criterion: Mapping[str, Any],
    detail: Mapping[str, Any],
    fallback_order: int,
) -> dict[str, Any]:
    group = _group(_value(criterion, "group", "nhom_danh_gia"))
    _group_key, group_label = _GROUPS[group]
    round_type = str(_value(report, "loai_vong", "loaiVong", default="single") or "single")
    expert_result = _result(_value(detail, "ket_qua", "ketQua"))
    extension = _mapping(detail.get("extension"))
    automatic_result = _result(_value(
        extension,
        "ketQuaTuDong",
        "ket_qua_tu_dong",
        default=_value(detail, "ket_qua_tu_dong", "ketQuaTuDong"),
    ))
    criterion_id = str(_value(
        detail,
        "tieu_chi_danh_gia_id",
        "tieuChiDanhGiaId",
        default=_value(criterion, "id", default=""),
    ) or "")
    return {
        "bao_cao_id": str(_value(report, "id", default="") or ""),
        "thong_tin_mo_thau_id": str(_value(bid, "id", default="") or ""),
        "nha_thau_id": str(_value(bid, "nha_thau_id", "nhaThauId", default="") or ""),
        "ten_nha_thau": str(_value(bid, "ten_nha_thau", "tenNhaThau", default="") or ""),
        "loai_nha_thau": str(_value(bid, "loai_nha_thau", "loaiNhaThau", default="") or ""),
        "ma_phan_lo": str(_value(bid, "ma_phan_lo", "maPhanLo", default="") or ""),
        "ten_phan_lo": str(_value(bid, "ten_phan_lo", "tenPhanLo", default="") or ""),
        "vong_danh_gia_id": str(_value(report, "vong_danh_gia_id", "vongDanhGiaId", default="") or ""),
        "loai_vong": round_type,
        "ten_vong": _ROUND_LABELS.get(round_type, round_type),
        "trang_thai_bao_cao": str(_value(report, "trang_thai", "trangThai", default="draft") or "draft"),
        "ket_luan_bao_cao": str(_value(report, "ket_luan", "ketLuan", default="") or ""),
        "hoan_thanh_luc": _value(report, "hoan_thanh_luc", "hoanThanhLuc", default="") or "",
        "tieu_chi_danh_gia_id": criterion_id,
        "stt": str(_value(criterion, "stt", default=fallback_order + 1) or fallback_order + 1),
        "ma_tieu_chi": str(_value(criterion, "code", "ma_tieu_chi", default="") or ""),
        "ten_tieu_chi": str(_value(criterion, "name", "ten_tieu_chi", default=criterion_id) or criterion_id),
        "yeu_cau": str(_value(criterion, "requirement", "yeu_cau", default="") or ""),
        "nhom_danh_gia": group,
        "ten_nhom_danh_gia": group_label,
        "loai_ket_qua": str(_value(criterion, "resultType", "loai_ket_qua", default="pass_fail") or "pass_fail"),
        "bat_buoc": bool(_value(criterion, "required", "bat_buoc", default=True)),
        "la_muc_lon": bool(_value(criterion, "isSection", "is_section", default=False)),
        "tieu_chi_cha_id": str(_value(criterion, "parentCriterionId", "tieu_chi_cha_id", default="") or ""),
        "thu_tu": int(_value(criterion, "order", "thu_tu", default=fallback_order) or 0),
        "diem_toi_da": _value(criterion, "maxScore", "diem_toi_da"),
        "diem_toi_thieu": _value(criterion, "minScore", "diem_toi_thieu"),
        "trong_so": _value(criterion, "weight", "trong_so"),
        "ket_qua_tu_dong": automatic_result,
        "ket_qua_tu_dong_hien_thi": _RESULT_LABELS[automatic_result],
        "ket_qua_tu_dong_dat": _mark(automatic_result, "pass"),
        "ket_qua_tu_dong_khong_dat": _mark(automatic_result, "fail"),
        "ket_qua_chuyen_gia": expert_result,
        "ket_qua_chuyen_gia_hien_thi": _RESULT_LABELS[expert_result],
        "ket_qua_chuyen_gia_dat": _mark(expert_result, "pass"),
        "ket_qua_chuyen_gia_khong_dat": _mark(expert_result, "fail"),
        "diem": _value(detail, "diem"),
        "noi_dung_hsdt": str(_value(detail, "noi_dung_hsdt", "noiDungHsdt", default="") or ""),
        "nhan_xet": str(_value(detail, "nhan_xet", "nhanXet", default="") or ""),
    }


def build_detailed_evaluation_context(
    package: Mapping[str, Any] | None,
    bids: list[Mapping[str, Any]] | None,
) -> dict[str, list[dict[str, Any]]]:
    """Return report and flat group lists ready for the DOCX DTO seam."""

    package = package if isinstance(package, Mapping) else {}
    metadata = _mapping(_value(
        package,
        "danh_gia_hsdt_metadata",
        "danhGiaHsdtMetadata",
        default={},
    ))
    reports_out: list[dict[str, Any]] = []
    rows_out: list[dict[str, Any]] = []
    grouped = {group: [] for group in _GROUPS}

    for bid in bids or []:
        if not isinstance(bid, Mapping):
            continue
        reports = _value(
            bid,
            "bao_cao_danh_gia_chi_tiet_list",
            "baoCaoDanhGiaChiTietList",
            default=[],
        ) or []
        reports = sorted(
            (report for report in reports if isinstance(report, Mapping)),
            key=lambda report: (
                _ROUND_ORDER.get(str(_value(report, "loai_vong", "loaiVong", default="")), 99),
                str(_value(report, "id", default="")),
            ),
        )
        for report in reports:
            round_type = str(_value(report, "loai_vong", "loaiVong", default="single") or "single")
            criteria = _criteria_for_round(metadata, round_type)
            criteria_by_id = {
                str(_value(item, "id", default="")): item
                for item in criteria
                if _value(item, "id", default="")
            }
            details = _value(report, "chi_tiet_list", "chiTietList", default=[]) or []
            report_rows = []
            for index, detail in enumerate(details):
                if not isinstance(detail, Mapping):
                    continue
                criterion_id = str(_value(
                    detail,
                    "tieu_chi_danh_gia_id",
                    "tieuChiDanhGiaId",
                    default="",
                ) or "")
                criterion = criteria_by_id.get(criterion_id, {"id": criterion_id})
                row = _build_row(bid, report, criterion, detail, index)
                report_rows.append(row)
                rows_out.append(row)
                grouped[row["nhom_danh_gia"]].append(row)

            report_record = {
                "id": str(_value(report, "id", default="") or ""),
                "thong_tin_mo_thau_id": str(_value(bid, "id", default="") or ""),
                "nha_thau_id": str(_value(bid, "nha_thau_id", "nhaThauId", default="") or ""),
                "ten_nha_thau": str(_value(bid, "ten_nha_thau", "tenNhaThau", default="") or ""),
                "loai_nha_thau": str(_value(bid, "loai_nha_thau", "loaiNhaThau", default="") or ""),
                "ma_phan_lo": str(_value(bid, "ma_phan_lo", "maPhanLo", default="") or ""),
                "ten_phan_lo": str(_value(bid, "ten_phan_lo", "tenPhanLo", default="") or ""),
                "vong_danh_gia_id": str(_value(report, "vong_danh_gia_id", "vongDanhGiaId", default="") or ""),
                "loai_vong": round_type,
                "ten_vong": _ROUND_LABELS.get(round_type, round_type),
                "trang_thai": str(_value(report, "trang_thai", "trangThai", default="draft") or "draft"),
                "ket_luan": str(_value(report, "ket_luan", "ketLuan", default="") or ""),
                "hoan_thanh_luc": _value(report, "hoan_thanh_luc", "hoanThanhLuc", default="") or "",
                "ds_tieu_chi": report_rows,
                "ds_hop_le": [row for row in report_rows if row["nhom_danh_gia"] == "validity"],
                "ds_nang_luc": [row for row in report_rows if row["nhom_danh_gia"] == "capacity"],
                "ds_ky_thuat": [row for row in report_rows if row["nhom_danh_gia"] == "technical"],
                "ds_tai_chinh": [row for row in report_rows if row["nhom_danh_gia"] == "financial"],
            }
            reports_out.append(report_record)

    return {
        "detailed_evaluation_reports": reports_out,
        "detailed_evaluation_rows": rows_out,
        "detailed_evaluation_validity_rows": grouped["validity"],
        "detailed_evaluation_capacity_rows": grouped["capacity"],
        "detailed_evaluation_technical_rows": grouped["technical"],
        "detailed_evaluation_financial_rows": grouped["financial"],
    }
