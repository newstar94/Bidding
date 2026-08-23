"""Allowlisted DTOs and manifests for DOCX rendering.

Database rows are intentionally projected before they cross the document
worker boundary.  Word mappings may add presentation aliases, but they cannot
make a field available unless that field is part of this export contract.
"""

from __future__ import annotations

import re
from dataclasses import dataclass, field
from datetime import date, datetime
from typing import Any, Mapping

from backend.documents.field_manifest import field_format
from backend.documents.word_defaults import WORD_SINGLE_SOURCES
from backend.shared.media_helper import (
    managed_image_path_matches_tenant,
    normalize_managed_image_path,
)


MANIFEST_VERSION = 1
REPORT_DOCUMENT_TYPES = frozenset(
    {"evaluation", "hsmt", "opening", "result", "contract", "liquidation"}
)
_SAFE_ROOT_RE = re.compile(r"^[a-z][a-z0-9_]{0,127}$")

_IMAGE_SOURCE_FIELDS = {
    ("nha_thau", "anh_dau"): "nha_thau",
    ("chuyen_gia", "anh_chung_chi"): "chuyen_gia",
    ("chuyen_gia", "anh_chu_ky"): "chuyen_gia",
}
BASE_IMAGE_FIELDS = {
    "anh_dau": "nha_thau",
    "anh_chung_chi": "chuyen_gia",
    "anh_chu_ky": "chuyen_gia",
}
SENSITIVE_FIELDS_BY_CAPABILITY = {
    "financial": frozenset({"so_tai_khoan", "noi_mo_tai_khoan", "ma_ngan_hang"}),
    "identity": frozenset({"so_cccd", "ngay_cap_cccd", "noi_cap_cccd"}),
    "signature": frozenset(
        {
            "anh_dau",
            "ten_anh_dau",
            "anh_chung_chi",
            "ten_anh_chung_chi",
            "anh_chu_ky",
            "ten_anh_chu_ky",
        }
    ),
}
_CAPABILITY_BY_SENSITIVE_FIELD = {
    field_name: capability_id
    for capability_id, field_names in SENSITIVE_FIELDS_BY_CAPABILITY.items()
    for field_name in field_names
}


@dataclass(frozen=True)
class EntitySpec:
    fields: frozenset[str]
    nested: Mapping[str, str] = field(default_factory=dict)


def _word_fields(table_name: str) -> set[str]:
    return set(WORD_SINGLE_SOURCES.get(table_name, ()))


_PLAN_WORK_FIELDS = frozenset(
    {"id", "ten_cong_viec", "gia_tri", "don_vi_thuc_hien", "van_ban_phe_duyet"}
)
_LOT_FIELDS = frozenset(
    {
        "id",
        "ma_phan_lo",
        "ten_phan_lo",
        "gia_tri_phan_lo",
        "bao_dam_du_thau",
        "thoi_gian_thuc_hien",
        "nha_thau_trung_thau_id",
        "gia_trung_thau",
        "thoi_gian_goi_thau",
        "thoi_gian_hop_dong",
    }
)
_OPTION_FIELDS = frozenset(
    {"id", "hang_muc", "don_vi", "so_luong", "ty_le", "gia_tri_uoc_tinh"}
)
_EXTENSION_FIELDS = frozenset({"id", "thoi_gian_dong_thau", "ly_do_gia_han"})
_REQUEST_FIELDS = frozenset({"id", "thoi_gian_yeu_cau", "noi_dung_yeu_cau"})
_REPLY_FIELDS = frozenset({"id", "thoi_gian_tra_loi", "noi_dung_tra_loi"})
_MEMBER_FIELDS = frozenset(
    {
        "id",
        "thanh_vien_nha_thau_id",
        "ten_nha_thau",
        "ma_nha_thau",
        "ma_so_thue",
        "vai_tro",
        "nguoi_dai_dien",
        "danh_xung",
        "so_dien_thoai",
        "email",
        "dia_chi",
        "dia_chi_goc",
        "so_tai_khoan",
        "noi_mo_tai_khoan",
        "ma_ngan_hang",
    }
)
_TIMELINE_ITEM_FIELDS = frozenset(
    {
        "id",
        "ma_nhom",
        "ten_nhom",
        "ma_moc",
        "cong_viec",
        "don_vi_ban_hanh",
        "so_van_ban",
        "ngay_du_kien",
        "ngay_thuc_te",
        "ghi_chu",
        "source_key",
        "source_mode",
        "is_optional",
        "trang_thai",
        "sort_order",
        "template_version",
        "display_code",
        "display_date",
        "is_planned_date",
        "is_overdue",
    }
)
_LOT_SUMMARY_FIELDS = frozenset(
    set(_LOT_FIELDS)
    | {
        "ten_nha_thau_trung",
        "ds_nha_thau_tham_du",
        "ds_nha_thau_trung_thau",
        "ds_nha_thau_truot_thau",
        "so_nha_thau_tham_du",
        "co_nha_thau_tham_du",
        "co_nha_thau_trung",
        "ds_ten_nha_thau_tham_du",
        "ly_do_khong_trung",
    }
)
_WINNER_GROUP_FIELDS = frozenset(
    {
        "nha_thau_id",
        "ma_nha_thau",
        "ten_nha_thau",
        "so_phan_lo_trung",
        "tong_gia_tri_trung_thau",
        "ds_phan_lo",
    }
)
_DETAILED_EVALUATION_ROW_FIELDS = frozenset(
    {
        "bao_cao_id", "thong_tin_mo_thau_id", "nha_thau_id",
        "ten_nha_thau", "loai_nha_thau", "ma_phan_lo", "ten_phan_lo",
        "vong_danh_gia_id", "loai_vong", "ten_vong",
        "trang_thai_bao_cao", "ket_luan_bao_cao", "hoan_thanh_luc",
        "tieu_chi_danh_gia_id", "stt", "ma_tieu_chi", "ten_tieu_chi",
        "yeu_cau", "nhom_danh_gia", "ten_nhom_danh_gia",
        "loai_ket_qua", "bat_buoc", "la_muc_lon", "tieu_chi_cha_id",
        "thu_tu", "diem_toi_da", "diem_toi_thieu", "trong_so",
        "ket_qua_tu_dong", "ket_qua_tu_dong_hien_thi",
        "ket_qua_tu_dong_dat", "ket_qua_tu_dong_khong_dat",
        "ket_qua_chuyen_gia", "ket_qua_chuyen_gia_hien_thi",
        "ket_qua_chuyen_gia_dat", "ket_qua_chuyen_gia_khong_dat",
        "diem", "noi_dung_hsdt", "nhan_xet",
    }
)
_DETAILED_EVALUATION_REPORT_FIELDS = frozenset(
    {
        "id", "thong_tin_mo_thau_id", "nha_thau_id", "ten_nha_thau",
        "loai_nha_thau", "ma_phan_lo", "ten_phan_lo",
        "vong_danh_gia_id", "loai_vong", "ten_vong", "trang_thai",
        "ket_luan", "hoan_thanh_luc", "ds_tieu_chi", "ds_hop_le",
        "ds_nang_luc", "ds_ky_thuat", "ds_tai_chinh",
    }
)

_PLAN_FIELDS = frozenset(
    _word_fields("ke_hoach_lcnt")
    | {
        "id",
        "chu_dau_tu_id",
        "cv_da_thuc_hien",
        "cv_khong_ap_dung",
        "cv_chua_du_dieu_kien",
    }
)
_PACKAGE_FIELDS = frozenset(
    _word_fields("goi_thau")
    | {
        "id",
        "ke_hoach_id",
        "nha_thau_trung_thau_id",
        "quy_trinh_danh_gia",
        "ngay_moi_doi_chieu",
        "ngay_doi_chieu",
        "phan_lo_list",
        "awarded_phan_lo_list",
        "tuy_chon_mua_them_list",
        "gia_han_list",
        "yeu_cau_lam_ro_list",
        "tra_loi_lam_ro_list",
        "timeline_items",
    }
)
_CONTRACTOR_FIELDS = frozenset(
    _word_fields("nha_thau") | {"id", "thanh_vien_lien_danh"}
)
_BID_FIELDS = frozenset(
    _word_fields("thong_tin_mo_thau")
    | _word_fields("nha_thau")
    | {
        "id",
        "nha_thau_id",
        "ten_nha_thau_mt",
        "xep_hang",
        "diem_danh_gia",
        "thanh_vien_lien_danh",
        "gia_trung_thau",
        "thoi_gian_hop_dong",
    }
)
_EXPERT_FIELDS = frozenset(
    _word_fields("chuyen_gia") | {"id", "chuc_vu", "cong_viec"}
)
_CONTRACT_FIELDS = frozenset(
    _word_fields("hop_dong") | {"id", "goi_thau_ids"}
)
_USER_FIELDS = frozenset(
    {
        "ten_dang_nhap",
        "ho_ten",
        "vai_tro",
        "email",
        "anh_dai_dien",
        "da_xac_minh",
    }
)


ENTITY_SPECS = {
    "plan": EntitySpec(
        _PLAN_FIELDS,
        {
            "cv_da_thuc_hien": "plan_work",
            "cv_khong_ap_dung": "plan_work",
            "cv_chua_du_dieu_kien": "plan_work",
        },
    ),
    "package": EntitySpec(
        _PACKAGE_FIELDS,
        {
            "phan_lo_list": "lot",
            "awarded_phan_lo_list": "lot",
            "tuy_chon_mua_them_list": "option",
            "gia_han_list": "extension",
            "yeu_cau_lam_ro_list": "request",
            "tra_loi_lam_ro_list": "reply",
            "timeline_items": "timeline_item",
        },
    ),
    "investor": EntitySpec(frozenset(_word_fields("chu_dau_tu"))),
    "contractor": EntitySpec(
        _CONTRACTOR_FIELDS, {"thanh_vien_lien_danh": "member"}
    ),
    "bid": EntitySpec(_BID_FIELDS, {"thanh_vien_lien_danh": "member"}),
    "expert": EntitySpec(_EXPERT_FIELDS),
    "contract": EntitySpec(_CONTRACT_FIELDS, {"goi_thau_ids": "scalar_list"}),
    "user": EntitySpec(_USER_FIELDS),
    "organization": EntitySpec(frozenset(_word_fields("to_chuc"))),
    "service_package": EntitySpec(frozenset(_word_fields("goi_dich_vu"))),
    "plan_work": EntitySpec(_PLAN_WORK_FIELDS),
    "lot": EntitySpec(_LOT_FIELDS),
    "option": EntitySpec(_OPTION_FIELDS),
    "extension": EntitySpec(_EXTENSION_FIELDS),
    "request": EntitySpec(_REQUEST_FIELDS),
    "reply": EntitySpec(_REPLY_FIELDS),
    "member": EntitySpec(_MEMBER_FIELDS),
    "timeline_item": EntitySpec(_TIMELINE_ITEM_FIELDS),
    "timeline_section": EntitySpec(
        frozenset({"code", "title", "items"}), {"items": "timeline_item"}
    ),
    "lot_summary": EntitySpec(
        _LOT_SUMMARY_FIELDS,
        {
            "ds_nha_thau_tham_du": "bid",
            "ds_nha_thau_trung_thau": "bid",
            "ds_nha_thau_truot_thau": "bid",
        },
    ),
    "winner_group": EntitySpec(
        _WINNER_GROUP_FIELDS, {"ds_phan_lo": "lot"}
    ),
    "detailed_evaluation_row": EntitySpec(_DETAILED_EVALUATION_ROW_FIELDS),
    "detailed_evaluation_report": EntitySpec(
        _DETAILED_EVALUATION_REPORT_FIELDS,
        {
            "ds_tieu_chi": "detailed_evaluation_row",
            "ds_hop_le": "detailed_evaluation_row",
            "ds_nang_luc": "detailed_evaluation_row",
            "ds_ky_thuat": "detailed_evaluation_row",
            "ds_tai_chinh": "detailed_evaluation_row",
        },
    ),
}


_COMMON_SCALAR_ROOTS = {
    "investor_name",
    "investor_address",
    "current_time",
    "today",
}
_REPORT_DERIVED_SCALARS = {
    "tong_so_nha_thau_tham_du",
    "so_nha_thau_trung_thau",
    "so_nha_thau_truot_thau",
    "so_nha_thau_khong_dat",
    "so_nha_thau_dat_khong_xep_hang_1",
    "so_nha_thau_khong_duoc_danh_gia",
    "tong_so_phan_lo",
    "so_phan_lo_co_nha_thau_tham_du",
    "so_phan_lo_khong_co_nha_thau_tham_du",
    "so_phan_lo_co_nha_thau_trung",
    "so_phan_lo_tham_du_khong_trung",
}
_REPORT_BID_LIST_ROOTS = {
    "nha_thau",
    "ds_nha_thau_tham_du",
    "ds_nha_thau_trung_thau",
    "ds_nha_thau_truot_thau",
    "ds_nha_thau_khong_dat",
    "ds_nha_thau_dat_khong_xep_hang_1",
    "ds_nha_thau_khong_duoc_danh_gia",
}
_REPORT_LOT_ROOTS = {
    "ds_phan_lo",
    "ds_phan_lo_co_nha_thau_tham_du",
    "ds_phan_lo_khong_co_nha_thau_tham_du",
    "ds_phan_lo_co_nha_thau_trung",
    "ds_phan_lo_co_nha_thau_tham_du_khong_trung",
    "ds_nha_thau_trung_theo_phan_lo",
}
_DETAILED_EVALUATION_ROW_ROOTS = {
    "detailed_evaluation_rows",
    "detailed_evaluation_validity_rows",
    "detailed_evaluation_capacity_rows",
    "detailed_evaluation_technical_rows",
    "detailed_evaluation_financial_rows",
}


PLAN_ROOT_SPECS = {
    "ke_hoach": "plan",
    "ke_hoach_versions": "plan_list",
    "user": "user",
    "to_chuc": "organization",
    "goi_dich_vu": "service_package",
    "goi_thau": "package_list",
    "goi_thau_trong_ke_hoach": "package_list",
    "chu_dau_tu": "investor",
    **{key: "scalar" for key in _COMMON_SCALAR_ROOTS},
}
REPORT_ROOT_SPECS = {
    "goi_thau": "package",
    "goi_thau_versions": "package_list",
    "ke_hoach": "plan",
    "ke_hoach_versions": "plan_list",
    "user": "user",
    "to_chuc": "organization",
    "goi_dich_vu": "service_package",
    "to_chuyen_gia": "expert_list",
    "to_tham_dinh": "expert_list",
    "chu_dau_tu": "investor",
    **{key: "bid_list" for key in _REPORT_BID_LIST_ROOTS},
    **{
        key: "winner_group_list"
        if key == "ds_nha_thau_trung_theo_phan_lo"
        else "lot_summary_list"
        for key in _REPORT_LOT_ROOTS
    },
    "detailed_evaluation_reports": "detailed_evaluation_report_list",
    # Composite package templates may be explicitly assigned to any package
    # publication.  Contracts remain tenant/record-authorized by the package
    # context and are exposed as a list without changing the primary report
    # investor or bidder bindings.
    "hop_dong_list": "contract_list",
    **{
        key: "detailed_evaluation_row_list"
        for key in _DETAILED_EVALUATION_ROW_ROOTS
    },
    **{key: "scalar" for key in _COMMON_SCALAR_ROOTS | _REPORT_DERIVED_SCALARS},
}
CONTRACT_ROOT_SPECS = {
    **REPORT_ROOT_SPECS,
    "thong_tin_mo_thau": "bid_list",
    "hop_dong": "contract",
}
TIMELINE_ROOT_SPECS = {
    "goi_thau": "package",
    "ke_hoach": "plan",
    "chu_dau_tu": "investor",
    "to_chuc": "organization",
    "timeline_sections": "timeline_section_list",
    "generated_date": "scalar",
    "planned_date_note": "scalar",
}


ROOT_SPECS_BY_DOCUMENT_TYPE = {
    "plan": PLAN_ROOT_SPECS,
    "timeline": TIMELINE_ROOT_SPECS,
    "evaluation": REPORT_ROOT_SPECS,
    "hsmt": REPORT_ROOT_SPECS,
    "opening": REPORT_ROOT_SPECS,
    "result": REPORT_ROOT_SPECS,
    "contract": CONTRACT_ROOT_SPECS,
    "liquidation": CONTRACT_ROOT_SPECS,
}


_SOURCE_FIELDS = {
    "ke_hoach_lcnt": _PLAN_FIELDS,
    "goi_thau": _PACKAGE_FIELDS,
    "nha_thau": _BID_FIELDS,
    "thong_tin_mo_thau": _BID_FIELDS,
    "chuyen_gia": _EXPERT_FIELDS,
    "to_chuyen_gia": _EXPERT_FIELDS,
    "to_tham_dinh": _EXPERT_FIELDS,
    "chu_dau_tu": ENTITY_SPECS["investor"].fields,
    "hop_dong": _CONTRACT_FIELDS,
    "hop_dong_list": _CONTRACT_FIELDS,
    "tai_khoan": _USER_FIELDS,
    "to_chuc": ENTITY_SPECS["organization"].fields,
    "goi_dich_vu": ENTITY_SPECS["service_package"].fields,
    "phan_lo": _LOT_FIELDS,
    "phan_lo_list": _LOT_FIELDS,
    "awarded_phan_lo_list": _LOT_FIELDS,
    "tuy_chon_mua_them": _OPTION_FIELDS,
    "tuy_chon_mua_them_list": _OPTION_FIELDS,
    "gia_han": _EXTENSION_FIELDS,
    "gia_han_list": _EXTENSION_FIELDS,
    "yeu_cau_lam_ro": _REQUEST_FIELDS,
    "yeu_cau_lam_ro_list": _REQUEST_FIELDS,
    "tra_loi_lam_ro": _REPLY_FIELDS,
    "tra_loi_lam_ro_list": _REPLY_FIELDS,
    "thanh_vien_lien_danh": _MEMBER_FIELDS,
    "cv_da_thuc_hien": _PLAN_WORK_FIELDS,
    "cv_da_thuc_hien_list": _PLAN_WORK_FIELDS,
    "cv_khong_ap_dung": _PLAN_WORK_FIELDS,
    "cv_khong_ap_dung_list": _PLAN_WORK_FIELDS,
    "cv_chua_du_dieu_kien": _PLAN_WORK_FIELDS,
    "cv_chua_du_dieu_kien_list": _PLAN_WORK_FIELDS,
}
_LIST_ONLY_SOURCES = {
    "ke_hoach_versions",
    "goi_thau_trong_ke_hoach",
    "goi_thau_versions",
    "ds_nha_thau_tham_du",
    "ds_nha_thau_trung_thau",
    "ds_nha_thau_truot_thau",
    "ds_nha_thau_khong_dat",
    "ds_nha_thau_dat_khong_xep_hang_1",
    "ds_nha_thau_khong_duoc_danh_gia",
    "ds_nha_thau_trung_theo_phan_lo",
    "ds_phan_lo",
    "ds_phan_lo_co_nha_thau_tham_du",
    "ds_phan_lo_khong_co_nha_thau_tham_du",
    "ds_phan_lo_co_nha_thau_trung",
    "ds_phan_lo_co_nha_thau_tham_du_khong_trung",
    "detailed_evaluation_reports",
    "hop_dong_list",
    *_DETAILED_EVALUATION_ROW_ROOTS,
}
_CONTEXT_SOURCE_FIELDS = _COMMON_SCALAR_ROOTS | _REPORT_DERIVED_SCALARS
_PLAN_MAPPING_SOURCES = {
    "ke_hoach_lcnt",
    "ke_hoach_versions",
    "goi_thau",
    "goi_thau_trong_ke_hoach",
    "chu_dau_tu",
    "tai_khoan",
    "to_chuc",
    "goi_dich_vu",
    "cv_da_thuc_hien",
    "cv_da_thuc_hien_list",
    "cv_khong_ap_dung",
    "cv_khong_ap_dung_list",
    "cv_chua_du_dieu_kien",
    "cv_chua_du_dieu_kien_list",
}

_MAPPING_LIST_ENTITY_BY_SOURCE = {
    "ke_hoach_lcnt": "plan",
    "ke_hoach_versions": "plan",
    "goi_thau": "package",
    "goi_thau_trong_ke_hoach": "package",
    "goi_thau_versions": "package",
    "nha_thau": "bid",
    "thong_tin_mo_thau": "bid",
    "chuyen_gia": "expert",
    "to_chuyen_gia": "expert",
    "to_tham_dinh": "expert",
    "chu_dau_tu": "investor",
    "hop_dong": "contract",
    "hop_dong_list": "contract",
    "tai_khoan": "user",
    "to_chuc": "organization",
    "goi_dich_vu": "service_package",
    "phan_lo": "lot",
    "phan_lo_list": "lot",
    "awarded_phan_lo_list": "lot",
    "tuy_chon_mua_them": "option",
    "tuy_chon_mua_them_list": "option",
    "gia_han": "extension",
    "gia_han_list": "extension",
    "yeu_cau_lam_ro": "request",
    "yeu_cau_lam_ro_list": "request",
    "tra_loi_lam_ro": "reply",
    "tra_loi_lam_ro_list": "reply",
    "thanh_vien_lien_danh": "member",
    "cv_da_thuc_hien": "plan_work",
    "cv_da_thuc_hien_list": "plan_work",
    "cv_khong_ap_dung": "plan_work",
    "cv_khong_ap_dung_list": "plan_work",
    "cv_chua_du_dieu_kien": "plan_work",
    "cv_chua_du_dieu_kien_list": "plan_work",
    "detailed_evaluation_reports": "detailed_evaluation_report",
    **{
        key: "detailed_evaluation_row"
        for key in _DETAILED_EVALUATION_ROW_ROOTS
    },
    **{key: "bid" for key in _REPORT_BID_LIST_ROOTS},
    **{
        key: "winner_group"
        if key == "ds_nha_thau_trung_theo_phan_lo"
        else "lot_summary"
        for key in _REPORT_LOT_ROOTS
    },
}


def _is_scalar(value: Any) -> bool:
    return value is None or isinstance(value, (str, int, float, bool, date, datetime))


def _safe_scalar(value: Any) -> Any:
    if isinstance(value, (date, datetime)):
        return value.isoformat()
    return value if _is_scalar(value) else None


def _safe_clone(value: Any, *, depth: int = 0) -> Any:
    if depth > 8:
        return None
    if _is_scalar(value):
        return _safe_scalar(value)
    if isinstance(value, list):
        return [_safe_clone(item, depth=depth + 1) for item in value[:10_000]]
    if isinstance(value, dict):
        return {
            str(key): _safe_clone(child, depth=depth + 1)
            for key, child in list(value.items())[:2_000]
            if isinstance(key, str) and not key.startswith("_")
        }
    return None


def _sanitize_managed_image_path(
    value: Any,
    expected_subfolder: str | None,
    organization_id: str | None,
) -> Any:
    if not expected_subfolder or not isinstance(value, str):
        return value
    managed = normalize_managed_image_path(value)
    if not managed.startswith(f"images/{expected_subfolder}/"):
        return ""
    parts = managed.split("/")
    if len(parts) == 4:
        if not organization_id or not managed_image_path_matches_tenant(
            managed,
            organization_id,
        ):
            return ""
    elif len(parts) != 3:
        return ""
    return managed


def _sanitize_image_value(
    field_name: str,
    value: Any,
    organization_id: str | None = None,
) -> Any:
    return _sanitize_managed_image_path(
        value,
        BASE_IMAGE_FIELDS.get(field_name),
        organization_id,
    )


def _capability_enabled(capabilities: Any, capability_id: str) -> bool:
    if capabilities is None:
        return False
    if isinstance(capabilities, Mapping):
        return capabilities.get(capability_id) is True
    return getattr(capabilities, capability_id, False) is True


def _field_is_allowed(field_name: str, capabilities: Any) -> bool:
    capability_id = _CAPABILITY_BY_SENSITIVE_FIELD.get(field_name)
    return capability_id is None or _capability_enabled(capabilities, capability_id)


def project_entity(
    entity_name: str,
    value: Any,
    capabilities: Any = None,
    organization_id: str | None = None,
) -> dict[str, Any]:
    """Return an allowlisted, JSON-safe copy of one export entity."""
    spec = ENTITY_SPECS[entity_name]
    if not isinstance(value, dict):
        return {}
    result: dict[str, Any] = {}
    for key in spec.fields:
        if key not in value or not _field_is_allowed(key, capabilities):
            continue
        child_spec = spec.nested.get(key)
        child = value[key]
        if child_spec == "scalar_list":
            result[key] = [
                _safe_scalar(item) for item in (child or []) if _is_scalar(item)
            ]
        elif child_spec:
            result[key] = [
                project_entity(
                    child_spec,
                    item,
                    capabilities,
                    organization_id,
                )
                for item in (child or [])
                if isinstance(item, dict)
            ]
        elif _is_scalar(child):
            result[key] = _sanitize_image_value(
                key,
                _safe_scalar(child),
                organization_id,
            )
    return result


def _project_root(
    spec_name: str,
    value: Any,
    capabilities: Any = None,
    organization_id: str | None = None,
) -> Any:
    if spec_name == "scalar":
        return _safe_scalar(value)
    if spec_name == "safe_list":
        return _safe_clone(value) if isinstance(value, list) else []
    if spec_name.endswith("_list"):
        entity_name = spec_name.removesuffix("_list")
        return [
            project_entity(entity_name, item, capabilities, organization_id)
            for item in (value or [])
            if isinstance(item, dict)
        ]
    return project_entity(spec_name, value, capabilities, organization_id)


def project_docx_context(
    document_type: str,
    context: Mapping[str, Any],
    capabilities: Any = None,
    *,
    organization_id: str | None = None,
) -> dict[str, Any]:
    """Project fixed context roots according to the requested document type."""
    root_specs = ROOT_SPECS_BY_DOCUMENT_TYPE.get(document_type)
    if root_specs is None:
        raise ValueError("Loại tài liệu Word không được hỗ trợ.")
    if not isinstance(context, Mapping):
        raise ValueError("Ngữ cảnh tài liệu Word không hợp lệ.")
    return {
        key: _project_root(
            spec_name,
            context[key],
            capabilities,
            organization_id,
        )
        for key, spec_name in root_specs.items()
        if key in context
    }


def validate_mapping_definition(
    variable_name: str,
    source_table: str,
    source_column: str,
    *,
    document_type: str | None = None,
) -> None:
    """Reject mappings that can escape the DOCX DTO contract."""
    name = str(variable_name or "").strip().lower()
    table = str(source_table or "").strip()
    column = str(source_column or "").strip()
    if not _SAFE_ROOT_RE.fullmatch(name):
        raise ValueError("Tên biến Word không hợp lệ.")

    all_reserved_roots = {
        key for root_specs in ROOT_SPECS_BY_DOCUMENT_TYPE.values() for key in root_specs
    }
    if name in all_reserved_roots:
        raise ValueError("Tên biến Word trùng với khóa ngữ cảnh hệ thống.")

    if document_type == "plan" and table not in _PLAN_MAPPING_SOURCES | {
        "__computed__",
        "__context__",
    }:
        raise ValueError("Nguồn dữ liệu không thuộc phạm vi tài liệu này.")

    if table == "__computed__":
        if not column:
            raise ValueError("Công thức Word không được để trống.")
        return
    if table == "__context__":
        if column not in _CONTEXT_SOURCE_FIELDS:
            raise ValueError("Khóa ngữ cảnh Word không được phép ánh xạ.")
        return
    if table in _LIST_ONLY_SOURCES:
        if column:
            raise ValueError("Nguồn danh sách Word không hỗ trợ cột trực tiếp.")
        return
    if table == "ke_hoach_lcnt" and not column:
        raise ValueError(
            "Kế hoạch LCNT hiện tại là thực thể đơn, không phải danh sách."
        )
    allowed_fields = _SOURCE_FIELDS.get(table)
    if allowed_fields is None:
        raise ValueError("Bảng nguồn Word không được phép.")
    if column and column not in allowed_fields:
        raise ValueError("Cột nguồn Word không nằm trong DTO xuất tài liệu.")


def filter_mapping_rows(mapping_rows, document_type: str, capabilities: Any = None):
    """Return only legacy/current mappings that satisfy the active policy."""
    safe_rows = []
    for row in mapping_rows or ():
        if len(row) < 3:
            continue
        if isinstance(row, Mapping) and {
            "ten_bien", "source_table", "source_column"
        }.issubset(row.keys()):
            variable_name = row.get("ten_bien")
            source_table = row.get("source_table")
            source_column = row.get("source_column")
        else:
            try:
                variable_name, source_table, source_column = row[0], row[1], row[2]
            except (IndexError, KeyError, TypeError):
                continue
        try:
            validate_mapping_definition(
                variable_name,
                source_table,
                source_column,
                document_type=document_type,
            )
        except ValueError:
            continue
        capability_id = _CAPABILITY_BY_SENSITIVE_FIELD.get(
            str(source_column or "").strip()
        )
        if capability_id and not _capability_enabled(capabilities, capability_id):
            continue
        safe_rows.append(
            (
                str(variable_name or "").strip().lower(),
                str(source_table or "").strip(),
                str(source_column or "").strip(),
            )
        )
    return safe_rows


def _project_custom_mapping_value(
    value,
    source_table: str,
    source_column: str,
    capabilities: Any = None,
    organization_id: str | None = None,
):
    """Project one mapping result according to its declared source contract."""
    if source_table in {"__computed__", "__context__"} or source_column:
        if not _field_is_allowed(source_column, capabilities):
            return None
        scalar = _safe_scalar(value)
        return _sanitize_image_value(source_column, scalar, organization_id)

    entity_name = _MAPPING_LIST_ENTITY_BY_SOURCE.get(source_table)
    if entity_name is None:
        return []
    return [
        project_entity(entity_name, item, capabilities, organization_id)
        for item in (value or [])
        if isinstance(item, dict)
    ]


def seal_docx_context(
    document_type: str,
    context,
    mapping_rows=(),
    capabilities: Any = None,
    *,
    organization_id: str | None = None,
):
    """Return the final DTO and a worker-verifiable rendering manifest."""
    safe_context = project_docx_context(
        document_type,
        context,
        capabilities,
        organization_id=organization_id,
    )
    safe_mappings = filter_mapping_rows(mapping_rows, document_type, capabilities)
    custom_roots = []
    datetime_roots = []
    date_roots = []
    money_roots = []
    image_fields = (
        dict(BASE_IMAGE_FIELDS)
        if _capability_enabled(capabilities, "signature")
        else {}
    )
    for variable_name, source_table, source_column in safe_mappings:
        if variable_name not in context:
            continue
        safe_context[variable_name] = _project_custom_mapping_value(
            context[variable_name],
            source_table,
            source_column,
            capabilities,
            organization_id,
        )
        custom_roots.append(variable_name)
        mapping_format = field_format(source_column)
        if mapping_format == "datetime":
            datetime_roots.append(variable_name)
        if mapping_format in {"date", "datetime"}:
            date_roots.append(variable_name)
        if mapping_format == "currency":
            money_roots.append(variable_name)
        image_subfolder = _IMAGE_SOURCE_FIELDS.get((source_table, source_column))
        if image_subfolder:
            image_fields[variable_name] = image_subfolder

    manifest = {
        "version": MANIFEST_VERSION,
        "document_type": document_type,
        "root_keys": sorted(safe_context),
        "custom_root_keys": sorted(set(custom_roots)),
        "datetime_root_keys": sorted(set(datetime_roots)),
        "date_root_keys": sorted(set(date_roots)),
        "money_root_keys": sorted(set(money_roots)),
        "image_fields": image_fields,
        "media_organization_id": str(organization_id or "").strip(),
    }
    validate_docx_context_manifest(safe_context, manifest)
    return safe_context, manifest


def sensitive_capability_groups_present(context: Any) -> set[str]:
    """Return capability IDs represented by non-empty values, never the values."""
    present: set[str] = set()

    def visit(value: Any, depth: int = 0) -> None:
        if depth > 10:
            return
        if isinstance(value, Mapping):
            for key, child in value.items():
                capability_id = _CAPABILITY_BY_SENSITIVE_FIELD.get(str(key))
                if capability_id and child not in (None, "", [], {}):
                    present.add(capability_id)
                visit(child, depth + 1)
        elif isinstance(value, list):
            for child in value[:10_000]:
                visit(child, depth + 1)

    visit(context)
    return present


def validate_docx_context_manifest(context, manifest):
    """Validate an exact context/manifest pair inside the document worker."""
    if not isinstance(context, dict) or not isinstance(manifest, dict):
        raise ValueError("Manifest ngữ cảnh Word không hợp lệ.")
    if manifest.get("version") != MANIFEST_VERSION:
        raise ValueError("Phiên bản manifest Word không được hỗ trợ.")
    document_type = manifest.get("document_type")
    root_specs = ROOT_SPECS_BY_DOCUMENT_TYPE.get(document_type)
    if root_specs is None:
        raise ValueError("Loại tài liệu trong manifest Word không hợp lệ.")

    declared_roots = manifest.get("root_keys")
    custom_roots = manifest.get("custom_root_keys")
    if not isinstance(declared_roots, list) or not isinstance(custom_roots, list):
        raise ValueError("Danh sách khóa manifest Word không hợp lệ.")
    declared_set = set(declared_roots)
    custom_set = set(custom_roots)
    if len(declared_set) != len(declared_roots) or len(custom_set) != len(custom_roots):
        raise ValueError("Manifest Word chứa khóa trùng lặp.")
    if any(not isinstance(key, str) or not _SAFE_ROOT_RE.fullmatch(key) for key in custom_set):
        raise ValueError("Manifest Word chứa biến tùy chỉnh không hợp lệ.")
    if custom_set & set(root_specs):
        raise ValueError("Biến tùy chỉnh Word ghi đè khóa hệ thống.")
    if declared_set != set(context):
        raise ValueError("Context Word không khớp manifest khóa gốc.")
    if not declared_set <= set(root_specs) | custom_set:
        raise ValueError("Context Word chứa khóa gốc không được phép.")

    def validated_format_roots(manifest_key, label):
        values = manifest.get(manifest_key, [])
        if not isinstance(values, list):
            raise ValueError(f"Danh sách biến {label} Word không hợp lệ.")
        value_set = set(values)
        if len(value_set) != len(values):
            raise ValueError(f"Manifest Word chứa biến {label} trùng lặp.")
        if any(
            not isinstance(key, str) or not _SAFE_ROOT_RE.fullmatch(key)
            for key in value_set
        ):
            raise ValueError(f"Manifest Word chứa biến {label} không hợp lệ.")
        if not value_set <= declared_set:
            raise ValueError(
                f"Manifest Word khai báo biến {label} ngoài ngữ cảnh."
            )
        return value_set

    datetime_set = validated_format_roots(
        "datetime_root_keys",
        "ngày giờ",
    )
    date_set = validated_format_roots("date_root_keys", "ngày")
    money_set = validated_format_roots("money_root_keys", "tiền")
    if not datetime_set <= date_set:
        raise ValueError("Biến ngày giờ Word phải thuộc danh sách biến ngày.")

    derived_root_keys = {
        derived
        for root in money_set
        for derived in (f"bangchu_{root}", f"BangChu_{root}")
    } | {
        derived
        for root in date_set
        for derived in (f"S_{root}", f"s_{root}")
    }

    image_fields = manifest.get("image_fields")
    if not isinstance(image_fields, dict):
        raise ValueError("Manifest ảnh Word không hợp lệ.")
    for key, subfolder in image_fields.items():
        if not isinstance(key, str) or not _SAFE_ROOT_RE.fullmatch(key):
            raise ValueError("Manifest ảnh Word chứa tên trường không hợp lệ.")
        if subfolder not in {"nha_thau", "chuyen_gia"}:
            raise ValueError("Manifest ảnh Word chứa thư mục không được phép.")
        if key not in BASE_IMAGE_FIELDS and key not in custom_set:
            raise ValueError("Manifest ảnh Word cấp quyền cho trường không được phép.")

    media_organization_id = str(
        manifest.get("media_organization_id") or ""
    ).strip()
    if len(media_organization_id) > 160:
        raise ValueError("Phạm vi tổ chức của ảnh Word không hợp lệ.")

    def validate_images(value: Any, depth: int = 0) -> None:
        if depth > 10:
            return
        if isinstance(value, Mapping):
            for key, child in value.items():
                expected_subfolder = image_fields.get(str(key))
                if expected_subfolder and isinstance(child, str) and child:
                    normalized = normalize_managed_image_path(child)
                    sanitized = _sanitize_managed_image_path(
                        child,
                        expected_subfolder,
                        media_organization_id or None,
                    )
                    if not normalized or sanitized != normalized:
                        raise ValueError("Ảnh Word không thuộc tổ chức hiện tại.")
                validate_images(child, depth + 1)
        elif isinstance(value, list):
            for child in value[:10_000]:
                validate_images(child, depth + 1)

    validate_images(context)

    return {
        "document_type": document_type,
        "allowed_root_keys": declared_set | derived_root_keys,
        "allowed_image_fields": dict(image_fields),
        "datetime_root_keys": datetime_set,
        "date_root_keys": date_set,
        "money_root_keys": money_set,
        "media_organization_id": media_organization_id,
    }
