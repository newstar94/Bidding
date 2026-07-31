"""Versioned package lifecycle contract; backend is the canonical source."""

from __future__ import annotations

from backend.shared.domain_enums import PACKAGE_STATUS_CODES, PACKAGE_STATUS_LABELS


LIFECYCLE_CONTRACT_VERSION = 1
PACKAGE_TRANSITIONS = {
    "PREPARING": ("CANCELLED", "INVITED"),
    "INVITED": ("CANCELLED", "OPENED"),
    "OPENED": ("CANCELLED", "EVALUATING"),
    "EVALUATING": ("AWARDED", "CANCELLED", "PARTIALLY_AWARDED"),
    "PARTIALLY_AWARDED": ("AWARDED", "CANCELLED", "EVALUATING"),
    "AWARDED": ("CANCELLED", "EVALUATING", "PARTIALLY_AWARDED"),
    "CANCELLED": tuple(sorted(set(PACKAGE_STATUS_LABELS) - {"CANCELLED"})),
}
PACKAGE_PRESENTATION = {
    "PREPARING": {"label": "Chuẩn bị", "tone": "neutral", "icon": "clipboard-list"},
    "INVITED": {"label": "Đang mời thầu", "tone": "info", "icon": "send"},
    "OPENED": {"label": "Đã mở thầu", "tone": "warning", "icon": "folder-open"},
    "EVALUATING": {"label": "Đang chấm thầu", "tone": "info", "icon": "scale"},
    "PARTIALLY_AWARDED": {"label": "Đã có kết quả một phần", "tone": "success", "icon": "award"},
    "AWARDED": {"label": "Đã có kết quả", "tone": "success", "icon": "circle-check"},
    "CANCELLED": {"label": "Hủy thầu", "tone": "danger", "icon": "circle-x"},
}
LOCKED_AFTER_INVITATION = (
    "giaGoiThau", "hinhThucLuaChon", "keHoachId", "linhVuc", "loaiHopDong",
    "maGoiThau", "nguonVon", "phanLo", "phuongPhapDanhGia",
    "phuongThucLuaChon", "quaMang", "tenGoiThau", "trongNuocQuocTe",
    "tuyChonMuaThem",
)


def lifecycle_contract():
    return {
        "version": LIFECYCLE_CONTRACT_VERSION,
        "statuses": PACKAGE_PRESENTATION,
        "aliases": {**PACKAGE_STATUS_CODES, "Huỷ thầu": "CANCELLED"},
        "transitions": {key: list(value) for key, value in PACKAGE_TRANSITIONS.items()},
        "lockedAfterInvitation": list(LOCKED_AFTER_INVITATION),
    }
