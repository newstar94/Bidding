"""Canonical authorization modules for every business resource alias.

Persistence table names and browser payload keys are resource identities, not
permission identities.  Callers must resolve them here before authorization so
the permission matrix has one stable key per business module.
"""

from __future__ import annotations


CANONICAL_PERMISSION_MODULES = frozenset(
    {
        "chudautu",
        "kehoach",
        "goithau",
        "chuyengia",
        "nhathau",
        "hopdong",
    }
)

TABLE_TO_MODULE = {
    "chu_dau_tu": "chudautu",
    "ke_hoach_lcnt": "kehoach",
    "goi_thau": "goithau",
    "chuyen_gia": "chuyengia",
    "nha_thau": "nhathau",
    "hop_dong": "hopdong",
    "thong_tin_mo_thau": "goithau",
    "nha_thau_tham_du_mo_thau": "goithau",
    "goi_thau_hang_hoa": "goithau",
    "hang_hoa_du_thau_nha_thau": "goithau",
    "danh_muc_trang_thai_hop_dong": "hopdong",
}

RESOURCE_TO_MODULE = {
    "chudautu": "chudautu",
    "kehoach": "kehoach",
    "goithau": "goithau",
    "chuyengia": "chuyengia",
    "nhathau": "nhathau",
    "hopdong": "hopdong",
    "thongtinmothau": "goithau",
    "goithauhanghoa": "goithau",
    "hanghoaduthaunhathau": "goithau",
    **TABLE_TO_MODULE,
}


def canonical_module(value: object) -> str | None:
    """Return one permission-matrix key, or ``None`` for an unknown resource."""

    key = str(value or "").strip().lower()
    if not key:
        return None
    return RESOURCE_TO_MODULE.get(key)


def module_for_table(table_name: object) -> str | None:
    """Resolve a database table to its owning authorization module."""

    return TABLE_TO_MODULE.get(str(table_name or "").strip().lower())
