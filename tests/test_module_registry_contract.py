from backend.shared.module_registry import (
    CANONICAL_PERMISSION_MODULES,
    TABLE_TO_MODULE,
    canonical_module,
    module_for_table,
)
from backend.sync.queries import TABLE_KEYS


def test_resource_aliases_share_one_canonical_permission_module():
    assert canonical_module("goithau") == "goithau"
    assert canonical_module("thongtinmothau") == "goithau"
    assert canonical_module("thong_tin_mo_thau") == "goithau"
    assert canonical_module("goi_thau_hang_hoa") == "goithau"
    assert canonical_module("unknown-module") is None
    assert module_for_table("thong_tin_mo_thau") == "goithau"


def test_sync_technical_tables_are_explicit_special_boundaries():
    technical = {
        TABLE_KEYS["assignments"],
        TABLE_KEYS["permissionmatrix"],
    }
    assert technical.isdisjoint(TABLE_TO_MODULE)
    assert technical == {"phan_cong_nhan_su", "ma_tran_phan_quyen"}
    assert set(TABLE_TO_MODULE.values()) == set(CANONICAL_PERMISSION_MODULES)
